"""
Churn Financial Impact - Financial Impact tab for Churn Diagnostics page.

Computes (one-row-per-customer, latest snapshot):
  revenueLostByReason  : [{ name, value }]  churn_reason_code → annual bill_amount sum
  revenueLostBySegment : [{ name, value }]  loyalty_status    → annual bill_amount sum
  revenueLostByRegion  : [{ name, value }]  geographic_market → annual bill_amount sum
  kpis:
    totalAnnualRevenueLost : sum(bill_amount * 12) for churned customers
    avgRevenuePerChurned   : totalAnnualRevenueLost / count(churned)
    revenueAtRisk          : sum(bill_amount * 12) for active customers with ≥2 risk signals

Revenue at Risk signals (active customers):
  - fiber_available_at_premises == True
  - competitor_broadband_available_by_address == True
  - network_outage_events > 0
  - nps_score < 50
  - price_increase_flag == 1
  - billing_dispute_flag == 1
  - commitment_end_date is null (month-to-month)

Usage (called by python-executor.ts):
    python churn_financial_impact.py <input_json_file> <output_json_file>
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
# Data file resolution
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
# Helpers
# ---------------------------------------------------------------------------

def _to_bool(series: pd.Series) -> pd.Series:
    """Coerce a column that may contain True/False/'True'/'1'/1 to bool."""
    return series.fillna(0).astype(str).str.lower().isin(["1", "true", "yes"])


def _rev_by_dim(churned_df: pd.DataFrame, dim_col: str) -> list:
    """Sum annual revenue (bill_amount * 12) per dimension value.
    Returns [{ name, value }] sorted descending."""
    if dim_col not in churned_df.columns:
        return []
    agg = (
        churned_df.groupby(dim_col)["annual_revenue"]
        .sum()
        .reset_index()
        .rename(columns={dim_col: "name", "annual_revenue": "value"})
    )
    agg["name"]  = agg["name"].fillna("Unknown").astype(str)
    agg["value"] = agg["value"].round(0).astype(int)
    agg = agg[agg["value"] > 0].sort_values("value", ascending=False)
    return agg.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Primary driver classification (same logic as churn_driver_analysis.py)
# ---------------------------------------------------------------------------
_DRIVER_PRIORITY = [
    "Service Quality",
    "Pricing Pressure",
    "Competitive Threat",
    "Contract / Tenure",
    "Engagement Drop",
]


def _classify_primary_driver(customer_df: pd.DataFrame) -> pd.Series:
    """Return a Series of primary driver labels (one per row)."""
    df = customer_df

    def col(name):
        return df[name] if name in df.columns else pd.Series(0, index=df.index)

    service_q = (
        (col("network_outage_events").fillna(0) > 0)
        | (col("trouble_ticket_volume").fillna(0) > 0)
        | (col("repeat_issue_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("nps_score").fillna(999) < 50)
        | (col("csat_score").fillna(999) < 3.0)
    )
    pricing = (
        (col("price_increase_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("billing_dispute_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("promo_expiration_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
    )
    comp_threat = (
        (col("fiber_available_at_premises").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("competitor_broadband_available_by_address").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
    )
    contract = pd.Series(False, index=df.index)
    if "commitment_end_date" in df.columns:
        ced = pd.to_datetime(df["commitment_end_date"], errors="coerce")
        sm  = pd.to_datetime(df["snapshot_month"],     errors="coerce")
        months_left = ((ced.dt.to_period("M") - sm.dt.to_period("M"))
                       .apply(lambda x: x.n if hasattr(x, "n") else np.nan))
        contract = ced.isna() | (months_left <= 3)
    engagement = col("bandwidth_utilization_pct").fillna(100) < 40

    flags = {
        "Service Quality":    service_q,
        "Pricing Pressure":   pricing,
        "Competitive Threat": comp_threat,
        "Contract / Tenure":  contract,
        "Engagement Drop":    engagement,
    }
    primary = pd.Series("Other", index=df.index)
    for driver_name in reversed(_DRIVER_PRIORITY):
        primary = primary.where(~flags[driver_name], driver_name)
    return primary


def _count_risk_signals(df: pd.DataFrame) -> pd.Series:
    """Return a Series counting how many risk signals each active customer fires."""
    signals = pd.DataFrame(index=df.index)

    def flag(col):
        if col in df.columns:
            return _to_bool(df[col])
        return pd.Series(False, index=df.index)

    signals["fiber"]       = flag("fiber_available_at_premises")
    signals["competitor"]  = flag("competitor_broadband_available_by_address")
    signals["outage"]      = df["network_outage_events"].fillna(0) > 0 if "network_outage_events" in df.columns else pd.Series(False, index=df.index)
    signals["nps"]         = df["nps_score"].fillna(999) < 50 if "nps_score" in df.columns else pd.Series(False, index=df.index)
    signals["price_hike"]  = flag("price_increase_flag")
    signals["billing"]     = flag("billing_dispute_flag")
    signals["mtm"]         = (
        df["commitment_end_date"].isna()
        if "commitment_end_date" in df.columns
        else pd.Series(False, index=df.index)
    )

    return signals.sum(axis=1)


# ---------------------------------------------------------------------------
# Main computation
# ---------------------------------------------------------------------------

def compute_financial_impact(df: pd.DataFrame) -> dict:
    df = df.copy()
    df["churn_flag"]      = (df["lifecycle_stage"] != "Active").astype(int)
    df["annual_revenue"]  = df["bill_amount"].fillna(0) * 12

    # One-row-per-customer: latest snapshot
    customer_df = (
        df.sort_values(["account_number", "snapshot_month"])
        .groupby("account_number")
        .last()
        .reset_index()
    )

    churned_df = customer_df[customer_df["churn_flag"] == 1].copy()
    active_df  = customer_df[customer_df["churn_flag"] == 0].copy()

    # --- Revenue Lost by Primary Driver Type ---
    churned_df = churned_df.copy()
    churned_df["primary_driver"] = _classify_primary_driver(churned_df)
    rev_by_reason = _rev_by_dim(churned_df, "primary_driver")

    # --- Revenue Lost by Value Segment (loyalty_status → tier) ---
    segment_col = (
        "loyalty_status_y" if "loyalty_status_y" in churned_df.columns
        else "value_tier"  if "value_tier"    in churned_df.columns
        else None
    )
    rev_by_segment = _rev_by_dim(churned_df, segment_col) if segment_col else []

    # --- Revenue Lost by Region ---
    region_col = "geographic_market" if "geographic_market" in churned_df.columns else None
    rev_by_region = _rev_by_dim(churned_df, region_col) if region_col else []

    # --- KPIs ---
    total_rev_lost    = float(churned_df["annual_revenue"].sum())
    n_churned         = max(len(churned_df), 1)
    avg_rev_churned   = total_rev_lost / n_churned

    # Revenue at Risk: active customers with ≥2 simultaneous risk signals
    if not active_df.empty:
        n_signals = _count_risk_signals(active_df)
        at_risk_df  = active_df[n_signals >= 2]
        rev_at_risk = float(at_risk_df["annual_revenue"].sum())
    else:
        rev_at_risk = 0.0

    return {
        "revenueLostByReason":  rev_by_reason,
        "revenueLostBySegment": rev_by_segment,
        "revenueLostByRegion":  rev_by_region,
        "kpis": {
            "totalAnnualRevenueLost": round(total_rev_lost),
            "avgRevenuePerChurned":   round(avg_rev_churned),
            "revenueAtRisk":          round(rev_at_risk),
        },
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: churn_financial_impact.py <input_json> <output_json>", file=sys.stderr)
        sys.exit(1)

    input_file, output_file = sys.argv[1], sys.argv[2]

    with open(input_file, "r", encoding="utf-8") as fh:
        params = json.load(fh)

    cwd           = params.get("cwd", os.getcwd())
    explicit_path = params.get("dataPath", "")

    print(f"[churn_financial_impact] Locating data file (cwd={cwd})", file=sys.stderr)
    data_file = find_data_file(explicit_path, cwd)
    print(f"[churn_financial_impact] Using: {data_file}", file=sys.stderr)

    df = load_dataframe(data_file)
    df["snapshot_month"] = pd.to_datetime(df["snapshot_month"], errors="coerce")
    if "commitment_end_date" in df.columns:
        df["commitment_end_date"] = pd.to_datetime(df["commitment_end_date"], errors="coerce")
    df = df.dropna(subset=["snapshot_month", "lifecycle_stage"])

    result = compute_financial_impact(df)
    result["success"] = True

    with open(output_file, "w", encoding="utf-8") as fh:
        json.dump(result, fh)

    kpis = result["kpis"]
    print(
        f"[churn_financial_impact] Done — "
        f"totalRevLost=${kpis['totalAnnualRevenueLost']:,}, "
        f"avgPerChurned=${kpis['avgRevenuePerChurned']:,}, "
        f"atRisk=${kpis['revenueAtRisk']:,}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
