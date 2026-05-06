"""
Churn Pattern Explorer - Pattern Explorer tab data for Churn Diagnostics page.
Mirrors the EDA logic from Copper_Churn_v3 notebook cells 3 & 4.

Computes:
  - monthlyTrend   : per-snapshot-month churn count + revenue lost
  - tenureCohorts  : retention/churn % per tenure bucket (stacked bar + cohort details)

Usage (called by python-executor.ts):
    python churn_pattern_explorer.py <input_json_file> <output_json_file>

Input JSON fields:
    cwd        : working directory of the Node server (used to locate the data file)
    dataPath   : (optional) absolute path to the CSV/XLSX data file

Output JSON:
    { monthlyTrend: [...], tenureCohorts: [...] }
"""

import sys
import os
import json

# Fix Windows encoding
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import pandas as pd
import numpy as np


# ---------------------------------------------------------------------------
# Data file resolution
# ---------------------------------------------------------------------------
CSV_FILENAME = "Brightspeed_Synthetic_Churn_KPI_Monthly_AllColumns (1).csv"
XLSX_CANDIDATES = [
    "Brightspeed_Synthetic_Churn_KPI_Monthly_AllColumns (1).xlsx",
]


def find_data_file(explicit_path: str, cwd: str) -> str:
    """Return the first data file found, checking explicit path first."""
    search_roots = [
        cwd,
        os.path.dirname(os.path.abspath(__file__)),                        # server/python-ml/
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."),  # project root
        os.getcwd(),
    ]

    if explicit_path and os.path.exists(explicit_path):
        return explicit_path

    for root in search_roots:
        for name in [CSV_FILENAME, *XLSX_CANDIDATES]:
            candidate = os.path.normpath(os.path.join(root, name))
            if os.path.exists(candidate):
                return candidate

    raise FileNotFoundError(
        f"Cannot locate data file. Searched for '{CSV_FILENAME}' in: "
        + ", ".join(search_roots)
    )


def load_dataframe(file_path: str) -> pd.DataFrame:
    if file_path.lower().endswith(".csv"):
        return pd.read_csv(file_path, low_memory=False)
    return pd.read_excel(file_path)


# ---------------------------------------------------------------------------
# Computation helpers
# ---------------------------------------------------------------------------

def compute_monthly_trend(df: pd.DataFrame) -> list:
    """
    Cell 3 logic: count of churned rows + sum of bill_amount per snapshot_month.
    Churn flag = lifecycle_stage != 'Active'.
    Returns list of {month, count, revenue} sorted ascending by month.
    """
    df = df.copy()
    df["churn_flag"] = (df["lifecycle_stage"] != "Active").astype(int)
    df["snapshot_period"] = df["snapshot_month"].dt.to_period("M")

    churned = df[df["churn_flag"] == 1]

    agg = (
        churned
        .groupby("snapshot_period")
        .agg(count=("churn_flag", "sum"), revenue=("bill_amount", "sum"))
        .reset_index()
    )
    agg["month"] = agg["snapshot_period"].astype(str)
    agg = agg.sort_values("month")

    return [
        {
            "month": row["month"],
            "count": int(row["count"]),
            "revenue": round(float(row["revenue"]), 2),
        }
        for _, row in agg.iterrows()
    ]


def compute_tenure_cohorts(df: pd.DataFrame) -> list:
    """
    Cell 4 logic: one-row-per-customer tenure bucket analysis.
    Returns list of {bucket, total, churned, churnRate, retentionRate}.
    """
    df = df.copy()
    df["churn_flag"] = (df["lifecycle_stage"] != "Active").astype(int)

    # Fix activation_date to earliest per customer
    df["activation_date"] = df.groupby("account_number")["activation_date"].transform("min")

    df["tenure_months"] = (
        df["snapshot_month"].dt.to_period("M") - df["activation_date"].dt.to_period("M")
    ).apply(lambda x: x.n if hasattr(x, "n") else 0)

    def _bucket(t):
        if t <= 6:   return "0-6 mo"
        if t <= 12:  return "6-12 mo"
        if t <= 24:  return "12-24 mo"
        if t <= 48:  return "24-48 mo"
        return "48+ mo"

    df["tenure_bucket"] = df["tenure_months"].apply(_bucket)
    bucket_order = ["0-6 mo", "6-12 mo", "12-24 mo", "24-48 mo", "48+ mo"]

    # One row per customer: first churn OR latest snapshot (active)
    churn_events = (
        df[df["churn_flag"] == 1]
        .sort_values(["account_number", "snapshot_month"])
        .groupby("account_number", as_index=False)
        .first()
    )
    latest_snapshot = (
        df.sort_values(["account_number", "snapshot_month"])
        .groupby("account_number", as_index=False)
        .last()
    )
    active_only = latest_snapshot[latest_snapshot["churn_flag"] == 0]
    cohort_df = pd.concat([churn_events, active_only], ignore_index=True)

    cohort = (
        cohort_df
        .groupby("tenure_bucket")
        .agg(total=("account_number", "count"), churned=("churn_flag", "sum"))
        .reindex(bucket_order)
        .fillna(0)
        .reset_index()
    )

    cohort["churnRate"] = (cohort["churned"] / cohort["total"].clip(lower=1) * 100).round(1)
    cohort["retentionRate"] = (100 - cohort["churnRate"]).round(1)

    return [
        {
            "bucket": row["tenure_bucket"],
            "total": int(row["total"]),
            "churned": int(row["churned"]),
            "churnRate": float(row["churnRate"]),
            "retentionRate": float(row["retentionRate"]),
        }
        for _, row in cohort.iterrows()
        if row["total"] > 0
    ]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: churn_pattern_explorer.py <input_json> <output_json>", file=sys.stderr)
        sys.exit(1)

    input_file, output_file = sys.argv[1], sys.argv[2]

    with open(input_file, "r", encoding="utf-8") as fh:
        params = json.load(fh)

    cwd = params.get("cwd", os.getcwd())
    explicit_path = params.get("dataPath", "")

    print(f"[churn_pattern_explorer] Locating data file (cwd={cwd})", file=sys.stderr)
    data_file = find_data_file(explicit_path, cwd)
    print(f"[churn_pattern_explorer] Using: {data_file}", file=sys.stderr)

    df = load_dataframe(data_file)
    df["snapshot_month"] = pd.to_datetime(df["snapshot_month"], errors="coerce")
    df["activation_date"] = pd.to_datetime(df["activation_date"], errors="coerce")
    df = df.dropna(subset=["snapshot_month", "activation_date", "lifecycle_stage"])

    result = {
        "success": True,
        "monthlyTrend": compute_monthly_trend(df),
        "tenureCohorts": compute_tenure_cohorts(df),
    }

    with open(output_file, "w", encoding="utf-8") as fh:
        json.dump(result, fh)

    print(
        f"[churn_pattern_explorer] Done — {len(result['monthlyTrend'])} months,"
        f" {len(result['tenureCohorts'])} cohorts",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
