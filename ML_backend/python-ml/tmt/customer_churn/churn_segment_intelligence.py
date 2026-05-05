"""
Churn Segment Intelligence - Segment Intelligence tab data for Churn Diagnostics page.
Mirrors the EDA logic from Copper_Churn_v3 notebook cell 5.

Column mappings (CSV → frontend):
  loyalty_status          → byValueTier  (value_tier also used as fallback)
  service_type            → byBundle
  geographic_market       → byRegion
  commitment_end_date     → byContract (null="Month-to-Month", else "Under Contract")
  fiber_available_at_prem → segmentComparisons.fiberVsNonFiber
  bill_amount             → avgRevenue

Computes (one-row-per-customer — latest snapshot):
  byValueTier   : [{ name, total, churned, churnRate, avgRevenue }]
  byBundle      : [{ name, total, churned, churnRate, avgRevenue }]
  byRegion      : [{ name, total, churned, avgRevenue }]
  byContract    : [{ name, total, churned, churnRate, avgRevenue }]
  segmentComparisons.fiberVsNonFiber.fiber/nonFiber : { total, churned, churnRate }

Usage (called by python-executor.ts):
    python churn_segment_intelligence.py <input_json_file> <output_json_file>
"""

import sys
import os
import json

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import pandas as pd
import numpy as np


# ---------------------------------------------------------------------------
# Data file resolution (same logic as churn_pattern_explorer.py)
# ---------------------------------------------------------------------------
CSV_FILENAME = "Brightspeed_Synthetic_Churn_KPI_Monthly_AllColumns (1).csv"
XLSX_CANDIDATES = [
    "Brightspeed_Synthetic_Churn_KPI_Monthly_AllColumns (1).xlsx",
]


def find_data_file(explicit_path: str, cwd: str) -> str:
    search_roots = [
        cwd,
        os.path.dirname(os.path.abspath(__file__)),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."),
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
# Label helpers
# ---------------------------------------------------------------------------

def _normalize_label(val: str) -> str:
    """Convert snake_case / camelCase raw CSV values to readable labels."""
    return val.replace("_", " ").strip().title()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _agg_segment(df: pd.DataFrame, col: str, label_fn=None) -> list:
    """Aggregate one-row-per-customer df by a dimension column.
    Returns list of { name, total, churned, churnRate, avgRevenue }.
    Rows where the column value is null/empty are excluded."""
    df = df.copy()
    # Exclude empty/null values
    df = df[df[col].notna() & (df[col].astype(str).str.strip() != "")]
    if df.empty:
        return []
    grp = (
        df.groupby(col)
        .agg(
            total=(col, "count"),
            churned=("churn_flag", "sum"),
            avgRevenue=("bill_amount", "mean"),
        )
        .reset_index()
    )
    grp["churnRate"] = (grp["churned"] / grp["total"].clip(lower=1) * 100).round(1)
    grp["avgRevenue"] = grp["avgRevenue"].round(2)
    grp = grp.sort_values("total", ascending=False)
    fn = label_fn or _normalize_label
    return [
        {
            "name": fn(str(row[col])),
            "total": int(row["total"]),
            "churned": int(row["churned"]),
            "churnRate": float(row["churnRate"]),
            "avgRevenue": float(row["avgRevenue"]),
        }
        for _, row in grp.iterrows()
    ]


def _fiber_comparison(customer_df: pd.DataFrame) -> dict:
    """Compute fiber vs non-fiber churn stats."""
    col = "fiber_available_at_premises"
    if col not in customer_df.columns:
        return {}

    def _side(mask):
        sub = customer_df[mask]
        total = len(sub)
        churned = int(sub["churn_flag"].sum())
        churn_rate = round(churned / max(total, 1) * 100, 1)
        return {"total": total, "churned": churned, "churnRate": churn_rate}

    fiber_mask = customer_df[col].astype(str).str.lower().isin(["true", "1", "yes"])
    return {
        "fiber": _side(fiber_mask),
        "nonFiber": _side(~fiber_mask),
    }


# ---------------------------------------------------------------------------
# Main computation
# ---------------------------------------------------------------------------

def compute_segments(df: pd.DataFrame) -> dict:
    # Churn flag
    df = df.copy()
    df["churn_flag"] = (df["lifecycle_stage"] != "Active").astype(int)

    # One-row-per-customer: latest snapshot (cell 5 approach)
    customer_df = (
        df.sort_values(["account_number", "snapshot_month"])
        .groupby("account_number")
        .last()
        .reset_index()
    )

    # --- Value Tier: loyalty_status (notebook uses loyalty_status_y which is the
    #     merge-suffix version; raw CSV column is loyalty_status; fallback to value_tier)
    tier_col = (
        "loyalty_status_y" if "loyalty_status_y" in customer_df.columns
        else "value_tier" if "value_tier" in customer_df.columns
        else None
    )
    # loyalty_status values are already human-readable (Bronze/Gold/Silver); keep as-is
    by_value_tier = _agg_segment(customer_df, tier_col, label_fn=lambda v: v) if tier_col else []

    # --- Bundle Type: service_type (raw values like 'Copper_DSL' → 'Copper Dsl')
    by_bundle = (
        _agg_segment(customer_df, "service_type") if "service_type" in customer_df.columns else []
    )

    # --- Region: geographic_market (values like 'Metro' are already readable)
    by_region = (
        _agg_segment(customer_df, "geographic_market", label_fn=lambda v: v)
        if "geographic_market" in customer_df.columns else []
    )

    # --- Contract Status: classify from commitment_end_date compared to snapshot_month ---
    #   Month-to-Month : commitment_end_date is null/empty
    #   Expired        : commitment_end_date < snapshot_month (past)
    #   Renewal Due    : 0 < months_remaining <= 3
    #   Under Contract : months_remaining > 3
    if "commitment_end_date" in customer_df.columns:
        def _contract_bucket(row):
            ced = row["commitment_end_date"]
            snap = row["snapshot_month"]
            if pd.isna(ced):
                return "Month-to-Month"
            try:
                ced_p  = pd.Period(ced, freq="M")
                snap_p = pd.Period(snap, freq="M")
                diff   = (ced_p - snap_p).n          # months remaining
                if diff < 0:
                    return "Expired"
                if diff <= 3:
                    return "Renewal Due"
                return "Under Contract"
            except Exception:
                return "Month-to-Month"
        customer_df["contract_status"] = customer_df.apply(_contract_bucket, axis=1)
        by_contract = _agg_segment(customer_df, "contract_status", label_fn=lambda v: v)
    else:
        by_contract = []

    # --- Fiber vs Non-Fiber comparison
    fiber_comparison = _fiber_comparison(customer_df)

    return {
        "byValueTier": by_value_tier,
        "byBundle": by_bundle,
        "byRegion": by_region,
        "byContract": by_contract,
        "segmentComparisons": {
            "fiberVsNonFiber": fiber_comparison,
        },
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: churn_segment_intelligence.py <input_json> <output_json>", file=sys.stderr)
        sys.exit(1)

    input_file, output_file = sys.argv[1], sys.argv[2]

    with open(input_file, "r", encoding="utf-8") as fh:
        params = json.load(fh)

    cwd = params.get("cwd", os.getcwd())
    explicit_path = params.get("dataPath", "")

    print(f"[churn_segment_intelligence] Locating data file (cwd={cwd})", file=sys.stderr)
    data_file = find_data_file(explicit_path, cwd)
    print(f"[churn_segment_intelligence] Using: {data_file}", file=sys.stderr)

    df = load_dataframe(data_file)
    df["snapshot_month"] = pd.to_datetime(df["snapshot_month"], errors="coerce")
    df["commitment_end_date"] = pd.to_datetime(df.get("commitment_end_date"), errors="coerce") \
        if "commitment_end_date" in df.columns else pd.NaT
    df = df.dropna(subset=["snapshot_month", "lifecycle_stage"])

    result = compute_segments(df)
    result["success"] = True

    with open(output_file, "w", encoding="utf-8") as fh:
        json.dump(result, fh)

    print(
        f"[churn_segment_intelligence] Done — "
        f"valueTier={len(result['byValueTier'])}, "
        f"bundle={len(result['byBundle'])}, "
        f"region={len(result['byRegion'])}, "
        f"contract={len(result['byContract'])}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
