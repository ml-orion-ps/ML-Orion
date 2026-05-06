"""
Churn Driver Analysis - Driver Analysis tab for Churn Diagnostics page.

Mirrors the driver classification logic from Copper_Churn_v3 notebook cell 31
(the `derive_driver_types` function), but works entirely from raw CSV features
so no SHAP/ML pipeline is required.

Driver type definitions (aligned with notebook's keyword buckets):
  Service Quality   : network_outage_events > 0  OR trouble_ticket_volume > 0
                      OR repeat_issue_flag == 1   OR nps_score < 50
                      OR csat_score < 3.0
  Pricing Pressure  : price_increase_flag == 1   OR billing_dispute_flag == 1
                      OR promo_expiration_flag == 1
  Competitive Threat: fiber_available_at_premises == True
                      OR competitor_broadband_available_by_address == True
  Contract / Tenure : commitment_end_date is NaT (month-to-month)
                      OR months_to_commitment_end <= 3
  Engagement Drop   : bandwidth_utilization_pct < 40

For each churned customer (latest snapshot, lifecycle_stage != Active) the
primary driver type is the one whose signals fired most; ties resolved by the
priority order above.

Outputs:
  contributions : [{ driver, count, percent }]          ← horizontal bar chart
  byRegion      : [{ name, churnRate, fiberImpact, qualityImpact }]  ← table
  bySegment     : [{ name, churnRate, fiberImpact, qualityImpact }]  ← table

fiberImpact   : % of churned in that group who were in fiber-available zones
qualityImpact : % of churned in that group who had ≥1 service-quality signal

Usage (called by python-executor.ts):
    python churn_driver_analysis.py <input_json_file> <output_json_file>
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
# Driver classification (mirrors notebook cell 31 `derive_driver_types`)
# ---------------------------------------------------------------------------
DRIVER_PRIORITY = [
    "Service Quality",
    "Pricing Pressure",
    "Competitive Threat",
    "Contract / Tenure",
    "Engagement Drop",
]


def _bool(series: pd.Series, col: str, true_vals=None) -> pd.Series:
    """Safely coerce a column to bool, returning False Series if missing."""
    if col not in series.index if isinstance(series, pd.Series) else col not in series.columns:
        return pd.Series(False, index=series.index if hasattr(series, "index") else [0])
    if true_vals is not None:
        return series[col].astype(str).str.lower().isin([str(v).lower() for v in true_vals])
    return series[col].fillna(0).astype(float).astype(bool)


def classify_drivers(customer_df: pd.DataFrame) -> pd.DataFrame:
    """Add driver flag columns and primary_driver to one-row-per-customer df."""
    df = customer_df.copy()

    def col(name):
        return df[name] if name in df.columns else pd.Series(0, index=df.index)

    # ---- Service Quality signals ----
    service_q = (
        (col("network_outage_events").fillna(0) > 0)
        | (col("trouble_ticket_volume").fillna(0) > 0)
        | (col("repeat_issue_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("nps_score").fillna(999) < 50)
        | (col("csat_score").fillna(999) < 3.0)
    )

    # ---- Pricing Pressure signals ----
    pricing = (
        (col("price_increase_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("billing_dispute_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("promo_expiration_flag").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
    )

    # ---- Competitive Threat / Fiber signals ----
    comp_threat = (
        (col("fiber_available_at_premises").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
        | (col("competitor_broadband_available_by_address").fillna(0).astype(str).isin(["1", "True", "true", "yes"]))
    )

    # ---- Contract / Tenure signals ----
    contract = pd.Series(False, index=df.index)
    if "commitment_end_date" in df.columns:
        ced = pd.to_datetime(df["commitment_end_date"], errors="coerce")
        sm  = pd.to_datetime(df["snapshot_month"],     errors="coerce")
        months_left = ((ced.dt.to_period("M") - sm.dt.to_period("M"))
                       .apply(lambda x: x.n if hasattr(x, "n") else np.nan))
        contract = ced.isna() | (months_left <= 3)

    # ---- Engagement Drop signals ----
    engagement = col("bandwidth_utilization_pct").fillna(100) < 40

    df["_service_q"]  = service_q
    df["_pricing"]    = pricing
    df["_comp_threat"]= comp_threat
    df["_contract"]   = contract
    df["_engagement"] = engagement

    # Priority-based primary driver (first matching wins; ties → first in list)
    flags = {
        "Service Quality":    service_q,
        "Pricing Pressure":   pricing,
        "Competitive Threat": comp_threat,
        "Contract / Tenure":  contract,
        "Engagement Drop":    engagement,
    }

    primary = pd.Series("Other", index=df.index)
    for driver_name in reversed(DRIVER_PRIORITY):       # reverse so highest-priority overwrites
        primary = primary.where(~flags[driver_name], driver_name)

    df["primary_driver"] = primary
    return df


# ---------------------------------------------------------------------------
# Dimension table helper
# ---------------------------------------------------------------------------

def driver_table_by_dim(customer_df: pd.DataFrame, dim_col: str) -> list:
    """
    For each value of dim_col produce:
      { name, churnRate, fiberImpact, qualityImpact }

    fiberImpact   : % of churned in group in fiber-available zones
    qualityImpact : % of churned in group with ≥1 service-quality signal
    """
    if dim_col not in customer_df.columns:
        return []

    result = []
    for name, grp in customer_df.groupby(dim_col):
        if pd.isna(name):
            continue
        total   = len(grp)
        churned = grp[grp["churn_flag"] == 1]
        n_churn = len(churned)

        churn_rate = round(n_churn / max(total, 1) * 100, 1)

        # fiberImpact: % of churned that were in fiber zones
        fiber_impact = 0.0
        if n_churn > 0 and "_comp_threat" in churned.columns:
            fiber_impact = round(churned["_comp_threat"].sum() / n_churn * 100, 1)

        # qualityImpact: % of churned with service quality signals
        quality_impact = 0.0
        if n_churn > 0 and "_service_q" in churned.columns:
            quality_impact = round(churned["_service_q"].sum() / n_churn * 100, 1)

        result.append({
            "name":          str(name),
            "churnRate":     float(churn_rate),
            "fiberImpact":   float(fiber_impact),
            "qualityImpact": float(quality_impact),
        })

    return sorted(result, key=lambda x: x["churnRate"], reverse=True)


# ---------------------------------------------------------------------------
# Main computation
# ---------------------------------------------------------------------------

def compute_drivers(df: pd.DataFrame) -> dict:
    df = df.copy()
    df["churn_flag"] = (df["lifecycle_stage"] != "Active").astype(int)

    # One-row-per-customer: latest snapshot (consistent with other scripts)
    customer_df = (
        df.sort_values(["account_number", "snapshot_month"])
        .groupby("account_number")
        .last()
        .reset_index()
    )

    # Classify drivers
    customer_df = classify_drivers(customer_df)

    # --- Driver Contribution (churned customers only) ---
    churned_df = customer_df[customer_df["churn_flag"] == 1]
    total_churned = max(len(churned_df), 1)

    contrib_counts = churned_df["primary_driver"].value_counts()
    total_contrib  = max(contrib_counts.sum(), 1)

    contributions = []
    for driver in DRIVER_PRIORITY + ["Other"]:
        cnt = int(contrib_counts.get(driver, 0))
        if cnt == 0:
            continue
        contributions.append({
            "driver":  driver,
            "count":   cnt,
            "percent": round(cnt / total_contrib * 100, 1),
        })
    # Sort descending by percent for the horizontal bar chart
    contributions.sort(key=lambda x: x["percent"], reverse=True)

    # --- Driver Impact by Region ---
    region_col = "geographic_market" if "geographic_market" in customer_df.columns else None
    by_region  = driver_table_by_dim(customer_df, region_col) if region_col else []

    # --- Driver Impact by Value Segment (loyalty_status → value tier) ---
    segment_col = (
        "loyalty_status" if "loyalty_status" in customer_df.columns
        else "value_tier"  if "value_tier"    in customer_df.columns
        else None
    )
    by_segment = driver_table_by_dim(customer_df, segment_col) if segment_col else []

    return {
        "contributions": contributions,
        "byRegion":      by_region,
        "bySegment":     by_segment,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 3:
        print("Usage: churn_driver_analysis.py <input_json> <output_json>", file=sys.stderr)
        sys.exit(1)

    input_file, output_file = sys.argv[1], sys.argv[2]

    with open(input_file, "r", encoding="utf-8") as fh:
        params = json.load(fh)

    cwd          = params.get("cwd", os.getcwd())
    explicit_path = params.get("dataPath", "")

    print(f"[churn_driver_analysis] Locating data file (cwd={cwd})", file=sys.stderr)
    data_file = find_data_file(explicit_path, cwd)
    print(f"[churn_driver_analysis] Using: {data_file}", file=sys.stderr)

    df = load_dataframe(data_file)
    df["snapshot_month"] = pd.to_datetime(df["snapshot_month"], errors="coerce")
    df = df.dropna(subset=["snapshot_month", "lifecycle_stage"])

    result = compute_drivers(df)
    result["success"] = True

    with open(output_file, "w", encoding="utf-8") as fh:
        json.dump(result, fh)

    print(
        f"[churn_driver_analysis] Done — "
        f"contributions={len(result['contributions'])}, "
        f"regions={len(result['byRegion'])}, "
        f"segments={len(result['bySegment'])}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
