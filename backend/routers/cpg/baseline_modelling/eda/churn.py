from __future__ import annotations
import math
import numpy as np
import pandas as pd

TARGET_COLS  = ["is_churned", "isChurned", "churned", "label", "target"]
CREDIT_COLS  = ["credit_profile", "creditProfile", "credit_score_band", "credit_segment"]
LOYALTY_COLS = ["loyalty_status", "loyaltyStatus", "value_tier", "valueTier", "segment"]
BILL_COLS    = ["bill_amount", "billAmount", "monthly_revenue", "monthlyRevenue", "revenue"]
ACCT_COLS    = ["account_number", "accountNumber"]
SNAP_COLS    = ["snapshot_month", "snapshotMonth"]
TENURE_COLS  = ["tenure_months", "tenureMonths", "tenure"]


def run(df: pd.DataFrame) -> dict:
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
    n = len(df)

    target_col  = next((c for c in TARGET_COLS  if c in df.columns), None)
    credit_col  = next((c for c in CREDIT_COLS  if c in df.columns), None)
    loyalty_col = next((c for c in LOYALTY_COLS if c in df.columns), None)
    bill_col    = next((c for c in BILL_COLS    if c in df.columns), None)
    acct_col    = next((c for c in ACCT_COLS    if c in df.columns), None)
    snap_col    = next((c for c in SNAP_COLS    if c in df.columns), None)
    tenure_col  = next((c for c in TENURE_COLS  if c in df.columns), None)

    churned_n = 0
    churn_mask = None
    if target_col:
        churn_mask = df[target_col].apply(lambda x: x in (1, True, "1", "true"))
        churned_n = int(churn_mask.sum())

    overview = {
        "totalRows": n,
        "churnedRows": churned_n,
        "retainedRows": n - churned_n,
        "churnRate": round(churned_n / max(n, 1) * 100, 1),
        "features": len(df.columns),
        "numericFeatures": len(numeric_cols),
        "categoricalFeatures": len(cat_cols),
    }

    # numericStats
    numeric_stats: dict = {}
    for col in numeric_cols[:40]:
        if col == target_col:
            continue
        series = df[col].dropna().astype(float)
        if len(series) == 0:
            continue
        hist_vals, edges = np.histogram(series, bins=15)
        churn_mean = retained_mean = None
        if churn_mask is not None:
            try:
                churn_mean = round(float(series[series.index.isin(churn_mask[churn_mask].index)].mean()), 3) or None
                retained_mean = round(float(series[series.index.isin(churn_mask[~churn_mask].index)].mean()), 3) or None
            except Exception:
                pass
        q1 = float(series.quantile(0.25)) if len(series) > 3 else None
        q3 = float(series.quantile(0.75)) if len(series) > 3 else None
        numeric_stats[col] = {
            "mean": round(float(series.mean()), 3),
            "median": round(float(series.median()), 3),
            "stdDev": round(float(series.std()), 3) if len(series) > 1 else 0,
            "min": float(series.min()),
            "max": float(series.max()),
            "q1": round(q1, 3) if q1 is not None else None,
            "q3": round(q3, 3) if q3 is not None else None,
            "nullCount": int(df[col].isna().sum()),
            "completeness": round((1 - df[col].isna().sum() / max(n, 1)) * 100, 1),
            "churnMean": churn_mean,
            "retainedMean": retained_mean,
            "histogram": [{"label": f"{edges[i]:.1f}–{edges[i+1]:.1f}", "count": int(hist_vals[i])} for i in range(len(hist_vals))],
        }

    # catStats
    cat_stats: dict = {}
    for col in cat_cols[:30]:
        if col == target_col:
            continue
        counts = df[col].value_counts().head(15)
        top = []
        for val, cnt in counts.items():
            churn_cnt = 0
            if churn_mask is not None:
                try:
                    churn_cnt = int(df[churn_mask & (df[col] == val)].shape[0])
                except Exception:
                    pass
            top.append({"label": str(val), "count": int(cnt), "churnCount": churn_cnt})
        cat_stats[col] = {"nullCount": int(df[col].isna().sum()), "uniqueCount": int(df[col].nunique()), "top": top}

    # bivariate
    def _avg_revenue(grp: pd.DataFrame) -> float:
        if bill_col is None:
            return 0.0
        try:
            if acct_col and acct_col in grp.columns and snap_col and snap_col in grp.columns:
                per_acct = grp.groupby(acct_col).apply(
                    lambda a: a[bill_col].dropna().astype(float).sum() / max(a[snap_col].nunique(), 1)
                )
                return round(float(per_acct.mean()), 2)
            return round(float(grp[bill_col].dropna().astype(float).mean()), 2)
        except Exception:
            return 0.0

    risk_category_data: list[dict] = []
    if credit_col and target_col:
        for val in df[credit_col].dropna().unique():
            grp = df[df[credit_col] == val]
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            risk_category_data.append({
                "label": str(val), "total": len(grp), "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
            })

    value_tier_data: list[dict] = []
    if loyalty_col and target_col:
        for val in df[loyalty_col].dropna().unique():
            grp = df[df[loyalty_col] == val]
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            value_tier_data.append({
                "label": str(val), "total": len(grp), "count": len(grp), "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
                "avgRevenue": _avg_revenue(grp),
            })

    multivariate: list[dict] = []
    if loyalty_col and target_col:
        for loyalty in df[loyalty_col].dropna().unique()[:8]:
            grp = df[df[loyalty_col] == loyalty]
            if len(grp) == 0:
                continue
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            multivariate.append({
                "valueTier": str(loyalty), "total": len(grp), "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
                "avgRevenue": _avg_revenue(grp),
            })

    # timeTrends by tenure cohort
    time_trends: list[dict] = []
    if tenure_col and target_col:
        for label, lo, hi in [("0-6 mo", 0, 6), ("6-12 mo", 6, 12), ("12-24 mo", 12, 24), ("24-48 mo", 24, 48), ("48+ mo", 48, 9999)]:
            try:
                grp = df[(df[tenure_col].astype(float) >= lo) & (df[tenure_col].astype(float) < hi)]
            except Exception:
                continue
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            time_trends.append({
                "bucket": label, "total": len(grp), "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
                "avgRevenue": _avg_revenue(grp),
            })

    # correlationMatrix
    correlation_matrix: list[dict] = []
    if len(numeric_cols) > 1:
        try:
            corr_df = df[numeric_cols].corr()
            for i, c1 in enumerate(numeric_cols):
                for c2 in numeric_cols[i + 1:]:
                    val = corr_df.loc[c1, c2]
                    if math.isnan(val) or math.isinf(val) or abs(val) <= 0.2:
                        continue
                    correlation_matrix.append({"col1": c1, "col2": c2, "corr": round(float(val), 3)})
            correlation_matrix.sort(key=lambda x: -abs(x["corr"]))
        except Exception:
            pass

    legacy_correlations = []
    if target_col and numeric_stats:
        for col, stats in list(numeric_stats.items())[:20]:
            cm = stats.get("churnMean") or 0
            rm = stats.get("retainedMean") or 0
            std = stats.get("stdDev") or 1
            approx_corr = max(-1.0, min(1.0, round((cm - rm) / max(std, 0.001), 3)))
            legacy_correlations.append({"feature": col, "corr": approx_corr, "correlation": approx_corr})
        legacy_correlations.sort(key=lambda x: -abs(x["corr"]))

    legacy_distributions = [
        {"feature": col, "mean": s["mean"], "median": s["median"], "stdDev": s["stdDev"],
         "min": s["min"], "max": s["max"], "skewness": 0, "histogram": s.get("histogram", [])}
        for col, s in list(numeric_stats.items())[:20]
    ]

    # dataRisks
    duplicates = int(df.duplicated().sum())
    null_risks = [
        {"column": col, "nullCount": int(df[col].isna().sum()), "nullPercent": round(df[col].isna().sum() / max(n, 1) * 100, 1)}
        for col in df.columns if df[col].isna().sum() > 0
    ]
    outlier_cols, low_variance = [], []
    for col in numeric_cols[:20]:
        series = df[col].dropna().astype(float)
        if len(series) < 4:
            continue
        q1_v, q3_v = series.quantile(0.25), series.quantile(0.75)
        iqr = q3_v - q1_v
        outlier_n = int(((series < q1_v - 1.5 * iqr) | (series > q3_v + 1.5 * iqr)).sum())
        if outlier_n > n * 0.05:
            outlier_cols.append({"column": col, "outlierCount": outlier_n, "percent": round(outlier_n / n * 100, 1)})
        if series.std() < 0.001:
            low_variance.append({"column": col, "std": round(float(series.std()), 6)})

    tenure_time_col = next((c for c in ["snapshot_month", "snapshotMonth", "date", "tenure_months"] if c in df.columns), None)
    insights: list[str] = []
    if target_col:
        insights.append(f"Target column detected as '{target_col}'. {round(churned_n / max(n, 1) * 100, 1)}% of rows are positive.")
    else:
        insights.append("No target column detected. Expected one of: is_churned, churned, label, target.")
    if null_risks:
        insights.append(f"Missing values in {len(null_risks)} columns. Consider imputing before training.")
    if duplicates > 0:
        insights.append(f"{duplicates} duplicate rows detected.")
    if correlation_matrix:
        top = correlation_matrix[0]
        insights.append(f"Strongest feature relationship: {top['col1']} vs {top['col2']} (corr {top['corr']}).")
    if time_trends and tenure_time_col:
        insights.append(f"Time trends generated using '{tenure_time_col}'.")

    return {
        "usecase": "churn",
        "targetColumn": target_col,
        "overview": overview,
        "numericStats": numeric_stats,
        "catStats": cat_stats,
        "bivariate": {"riskCategory": risk_category_data, "valueTier": value_tier_data},
        "multivariate": multivariate,
        "timeTrends": time_trends,
        "correlationMatrix": correlation_matrix[:30],
        "dataRisks": {
            "classImbalance": round(churned_n / max(n, 1) * 100, 1),
            "duplicates": duplicates,
            "nullRisks": null_risks,
            "outliers": outlier_cols,
            "lowVariance": low_variance,
        },
        "insights": insights,
        "correlations": legacy_correlations,
        "distributions": legacy_distributions,
    }
