from __future__ import annotations
import gzip, base64, io, uuid, math
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
import pandas as pd
import numpy as np
from database import get_db
import storage


def _sanitize_for_json(obj):
    """Replace NaN/Infinity with None so PostgreSQL JSON columns accept the data."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(i) for i in obj]
    return obj
from schemas import CustomFeatureDefinition
from services.custom_features import (
    apply_custom_features,
    build_custom_feature_formula,
    validate_custom_feature,
    build_preview_rows,
    get_dataset_rows,
    get_dataset_custom_features,
)
from services.ml_service import run_baseline_prediction

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _compress_csv(csv_text: str) -> str:
    return base64.b64encode(gzip.compress(csv_text.encode("utf-8"))).decode("ascii")


def _build_data_preview(csv_text: str, all_data: list[dict]) -> dict:
    import random
    preview = all_data[:20]
    sample_size = min(len(all_data), 500)
    sample = random.sample(all_data, sample_size) if len(all_data) > sample_size else all_data
    return {
        "preview": preview,
        "sample": sample,
        "compressedCsvBase64": _compress_csv(csv_text),
        "csvEncoding": "gzip-base64",
        "storageVersion": 2,
    }


def _sanitize_dataset(ds) -> dict:
    d = {c.name: getattr(ds, c.name) for c in ds.__table__.columns}
    dp = d.get("data_preview") or {}
    if isinstance(dp, dict):
        dp = {k: v for k, v in dp.items() if k not in ("all", "rawCsv", "compressedCsvBase64")}
    d["data_preview"] = dp
    return d


def _compute_column_info(df: pd.DataFrame) -> list[dict]:
    cols = []
    for col in df.columns:
        series = df[col]
        non_null = series.dropna()
        null_count = int(series.isna().sum())
        null_pct = round(null_count / max(len(series), 1) * 100, 1)
        unique_count = int(series.nunique())

        is_numeric = pd.api.types.is_numeric_dtype(series)
        numeric_stats: dict = {}
        categorical_stats: dict = {}

        if is_numeric and len(non_null) > 0:
            nums = non_null.astype(float)
            numeric_stats = {
                "mean": round(float(nums.mean()), 4),
                "median": round(float(nums.median()), 4),
                "stdDev": round(float(nums.std()), 4),
                "min": float(nums.min()),
                "max": float(nums.max()),
            }
            if len(nums) > 3:
                q1, q3 = float(nums.quantile(0.25)), float(nums.quantile(0.75))
                iqr = q3 - q1
                skew = float(nums.skew())
                outliers = int(((nums < q1 - 1.5 * iqr) | (nums > q3 + 1.5 * iqr)).sum())
                numeric_stats.update({"q1": round(q1, 4), "q3": round(q3, 4), "skewness": round(skew, 4), "outlierCount": outliers})
        else:
            counts = series.value_counts().head(10)
            categorical_stats["topValues"] = [{"value": str(k), "count": int(v)} for k, v in counts.items()]

        cols.append({
            "name": col,
            "type": "numeric" if is_numeric else "categorical",
            "nullCount": null_count,
            "nullPercent": str(null_pct),
            "uniqueCount": unique_count,
            "sampleValues": [v for v in non_null.head(5).tolist()],
            "numericStats": numeric_stats,
            "categoricalStats": categorical_stats,
        })
    return cols


@router.post("/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    name: str = Form(None),
    db: Session = Depends(get_db),
):
    content = await file.read()
    csv_text = content.decode("utf-8")
    try:
        df = pd.read_csv(io.StringIO(csv_text))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {e}")

    if df.empty:
        raise HTTPException(status_code=400, detail="CSV file contains no data rows")

    df = df.where(pd.notnull(df), None)
    all_data = df.to_dict(orient="records")

    # Sanitize NaN/Infinity → None so PostgreSQL JSON columns accept the data
    all_data = _sanitize_for_json(all_data)
    column_info = _sanitize_for_json(_compute_column_info(df))
    data_preview = _sanitize_for_json(_build_data_preview(csv_text, all_data))

    ds = storage.create_dataset(db, {
        "name": name or file.filename,
        "file_name": file.filename,
        "row_count": len(df),
        "column_count": len(df.columns),
        "columns": column_info,
        "status": "uploaded",
        "data_preview": data_preview,
        "quality_report": None,
        "eda_report": None,
        "feature_report": None,
    })
    return _sanitize_dataset(ds)


@router.get("/unique-account-counts")
def unique_account_counts(db: Session = Depends(get_db)):
    # Return {datasetId: count} dict — frontend uses (datasetAccountCounts as any)[m.datasetId]
    items = storage.get_unique_account_counts(db)
    return {str(item["datasetId"]): item["uniqueAccountCount"] for item in items}


@router.get("/rgm-results")
def get_rgm_results(db: Session = Depends(get_db)):
    """Return all datasets that have baseline and/or promo-uplift results stored."""
    datasets = storage.get_datasets(db)
    results = []
    for ds in datasets:
        fr = ds.feature_report or {}
        if not isinstance(fr, dict):
            continue
        has_baseline = "baselinePrediction" in fr
        has_uplift = "promoUplift" in fr
        if not has_baseline and not has_uplift:
            continue
        results.append({
            "datasetId": ds.id,
            "datasetName": ds.name,
            "hasBaseline": has_baseline,
            "hasPromoUplift": has_uplift,
            "hasPromoRoi": "promoRoi" in fr,
            "baseline": fr.get("baselinePrediction", {}).get("summary", {}),
            "promoUplift": fr.get("promoUplift", {}).get("summary", {}),
            "promoRoi": fr.get("promoRoi", {}),
        })
    return results


@router.get("")
def list_datasets(db: Session = Depends(get_db)):
    datasets = storage.get_datasets(db)
    return [_sanitize_dataset(ds) for ds in datasets]


@router.get("/{dataset_id}")
def get_dataset(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return _sanitize_dataset(ds)


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    storage.delete_dataset(db, dataset_id)
    return {"ok": True}


@router.post("/{dataset_id}/quality-check")
def quality_check(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    cols = ds.columns or []
    quality_issues: list[dict] = []
    column_reports: list[dict] = []
    score = 100

    for col in cols:
        issues: list[dict] = []
        null_pct = float(col.get("nullPercent", 0))
        col_type = col.get("type", "categorical")

        if null_pct > 5:
            sev = "high" if null_pct > 20 else "medium"
            rec = "Apply median imputation" if col_type == "numeric" else "Apply mode imputation or 'Unknown' category"
            issues.append({"type": "missing_values", "severity": sev, "description": f"{null_pct}% missing values ({col.get('nullCount', 0)} of {ds.row_count} records)", "recommendation": rec})
            score -= (10 if sev == "high" else 5)

        if col_type == "numeric":
            stats = col.get("numericStats", {})
            if stats.get("outlierCount", 0) > ds.row_count * 0.05:
                issues.append({"type": "outliers", "severity": "medium", "description": f"{stats['outlierCount']} outliers detected", "recommendation": "Review and cap using IQR or winsorization"})
                score -= 3
            if abs(stats.get("skewness", 0)) > 2:
                issues.append({"type": "skewness", "severity": "low", "description": f"High skewness: {stats.get('skewness', 0):.2f}", "recommendation": "Consider log or Box-Cox transformation"})
                score -= 2
        else:
            top = col.get("categoricalStats", {}).get("topValues", [])
            if top and top[0].get("count", 0) / max(ds.row_count, 1) > 0.95:
                issues.append({"type": "high_cardinality", "severity": "low", "description": f"Single value dominates ({top[0]['count']} / {ds.row_count})", "recommendation": "Consider dropping this column"})

        if issues:
            quality_issues.append({"column": col["name"], "issues": issues})
        column_reports.append({"column": col["name"], "type": col_type, "issues": issues, "status": "ok" if not issues else "warning"})

    total_null = sum(c.get("nullCount", 0) for c in cols)
    total_outliers = sum(c.get("numericStats", {}).get("outlierCount", 0) for c in cols if c.get("type") == "numeric")
    null_pcts = [float(c.get("nullPercent", 0)) for c in cols]
    avg_completeness = round(100 - (sum(null_pcts) / max(len(null_pcts), 1)), 1)

    report = {
        "overallScore": max(score, 0),
        "totalIssues": sum(len(qi["issues"]) for qi in quality_issues),
        "completeness": avg_completeness,
        "duplicates": 0,
        "missingValues": total_null,
        "outliers": total_outliers,
        "columnReports": column_reports,
        "issues": quality_issues,
        "recommendations": [
            "Review columns with missing values > 20%",
            "Apply feature scaling for numeric columns",
            "Encode categorical variables before training",
        ],
    }
    ds_updated = storage.update_dataset(db, dataset_id, {"quality_report": _sanitize_for_json(report)})
    return _sanitize_dataset(ds_updated)


@router.post("/{dataset_id}/eda")
def run_eda(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    df = pd.DataFrame(rows)
    df = df.where(pd.notnull(df), None)

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = [c for c in df.select_dtypes(exclude=[np.number]).columns.tolist()]
    target_col = next((c for c in ["is_churned", "isChurned", "churned", "label", "target"] if c in df.columns), None)
    n = len(df)

    # Overview
    churned_n = 0
    if target_col:
        churned_n = int(df[target_col].apply(lambda x: x in (1, True, "1", "true")).sum())
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
    churn_mask = None
    if target_col:
        churn_mask = df[target_col].apply(lambda x: x in (1, True, "1", "true"))

    numeric_stats: dict = {}
    for col in numeric_cols[:40]:
        if col == target_col:
            continue
        series = df[col].dropna().astype(float)
        if len(series) == 0:
            continue
        completeness = round((1 - df[col].isna().sum() / max(n, 1)) * 100, 1)
        hist_vals, edges = np.histogram(series, bins=15)
        histogram = [
            {"label": f"{edges[i]:.1f}–{edges[i+1]:.1f}", "count": int(hist_vals[i])}
            for i in range(len(hist_vals))
        ]
        churn_mean = retained_mean = None
        if churn_mask is not None:
            try:
                aligned = series[series.index.isin(churn_mask[churn_mask].index)]
                churn_mean = round(float(aligned.mean()), 3) if len(aligned) else None
                ret = series[series.index.isin(churn_mask[~churn_mask].index)]
                retained_mean = round(float(ret.mean()), 3) if len(ret) else None
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
            "completeness": completeness,
            "churnMean": churn_mean,
            "retainedMean": retained_mean,
            "histogram": histogram,
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
        cat_stats[col] = {
            "nullCount": int(df[col].isna().sum()),
            "uniqueCount": int(df[col].nunique()),
            "top": top,
        }

    # bivariate
    credit_col  = next((c for c in ["credit_profile", "creditProfile", "credit_score_band", "credit_segment"] if c in df.columns), None)
    # loyalty_status preferred; fallback to value_tier / segment
    loyalty_col = next((c for c in ["loyalty_status", "loyaltyStatus", "value_tier", "valueTier", "segment"] if c in df.columns), None)
    # bill_amount preferred for revenue; fallback to monthly_revenue
    bill_col    = next((c for c in ["bill_amount", "billAmount", "monthly_revenue", "monthlyRevenue", "revenue"] if c in df.columns), None)
    acct_col    = next((c for c in ["account_number", "accountNumber"] if c in df.columns), None)
    snap_col    = next((c for c in ["snapshot_month", "snapshotMonth"] if c in df.columns), None)

    def _avg_monthly_revenue(grp: "pd.DataFrame") -> float:
        """sum(bill_amount) / num_snapshot_months per account, then averaged across accounts."""
        if bill_col is None or bill_col not in grp.columns:
            return 0.0
        try:
            if acct_col and acct_col in grp.columns and snap_col and snap_col in grp.columns:
                per_acct = (
                    grp.groupby(acct_col)
                    .apply(lambda a: a[bill_col].dropna().astype(float).sum()
                                     / max(a[snap_col].nunique(), 1))
                )
                return round(float(per_acct.mean()), 2)
            # fallback: simple mean of bill_amount
            return round(float(grp[bill_col].dropna().astype(float).mean()), 2)
        except Exception:
            return 0.0

    risk_category_data: list[dict] = []
    if credit_col and target_col:
        for val in df[credit_col].dropna().unique():
            grp = df[df[credit_col] == val]
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            risk_category_data.append({
                "label": str(val),
                "total": len(grp),
                "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
            })

    value_tier_data: list[dict] = []
    if loyalty_col and target_col:
        for val in df[loyalty_col].dropna().unique():
            grp = df[df[loyalty_col] == val]
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            value_tier_data.append({
                "label": str(val),
                "total": len(grp),
                "count": len(grp),
                "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
                "avgRevenue": _avg_monthly_revenue(grp),
            })

    # multivariate — group by loyalty_status only (contract_status dropped)
    multivariate: list[dict] = []
    if loyalty_col and target_col:
        for loyalty in df[loyalty_col].dropna().unique()[:8]:
            grp = df[df[loyalty_col] == loyalty]
            if len(grp) == 0:
                continue
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            multivariate.append({
                "valueTier": str(loyalty),
                "total": len(grp),
                "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
                "avgRevenue": _avg_monthly_revenue(grp),
            })

    # timeTrends (tenure cohorts)
    tenure_col = next((c for c in ["tenure_months", "tenureMonths", "tenure"] if c in df.columns), None)
    time_trends: list[dict] = []
    if tenure_col and target_col:
        buckets = [("0-6 mo", 0, 6), ("6-12 mo", 6, 12), ("12-24 mo", 12, 24), ("24-48 mo", 24, 48), ("48+ mo", 48, 9999)]
        for label, lo, hi in buckets:
            try:
                grp = df[(df[tenure_col].astype(float) >= lo) & (df[tenure_col].astype(float) < hi)]
            except Exception:
                continue
            ch = grp[target_col].apply(lambda x: x in (1, True, "1", "true")).sum()
            time_trends.append({
                "bucket": label, "total": len(grp), "churned": int(ch),
                "churnRate": round(int(ch) / max(len(grp), 1) * 100, 1),
                "avgRevenue": _avg_monthly_revenue(grp),
            })

    # correlationMatrix
    correlation_matrix: list[dict] = []
    if len(numeric_cols) > 1:
        try:
            corr_df = df[numeric_cols].corr()
            for i, c1 in enumerate(numeric_cols):
                for c2 in numeric_cols[i + 1:]:
                    val = corr_df.loc[c1, c2]
                    if math.isnan(val) or math.isinf(val):
                        continue
                    if abs(val) > 0.2:
                        correlation_matrix.append({"col1": c1, "col2": c2, "corr": round(float(val), 3)})
            correlation_matrix.sort(key=lambda x: -abs(x["corr"]))
        except Exception:
            pass

    # Legacy correlations: {feature, corr} for target-correlation display
    legacy_correlations = []
    if target_col and numeric_stats:
        for col, stats in list(numeric_stats.items())[:20]:
            if col == target_col:
                continue
            # Approximate feature-target correlation from churnMean vs retainedMean
            cm = stats.get("churnMean") or 0
            rm = stats.get("retainedMean") or 0
            std = stats.get("stdDev") or 1
            approx_corr = round((cm - rm) / max(std, 0.001), 3) if std else 0
            approx_corr = max(-1.0, min(1.0, approx_corr))
            legacy_correlations.append({"feature": col, "corr": approx_corr, "correlation": approx_corr})
        legacy_correlations.sort(key=lambda x: -abs(x["corr"]))

    # Distributions: flat format with {feature, mean, median, stdDev, min, max, skewness}
    legacy_distributions = [
        {
            "feature": col,
            "mean": stats["mean"], "median": stats["median"],
            "stdDev": stats["stdDev"], "min": stats["min"], "max": stats["max"],
            "skewness": 0,  # skewness not stored in numericStats
            "histogram": stats.get("histogram", []),
        }
        for col, stats in list(numeric_stats.items())[:20]
    ]

    # dataRisks
    class_imbalance = round(churned_n / max(n, 1) * 100, 1)
    duplicates = int(df.duplicated().sum())
    null_risks = [
        {"column": col, "nullCount": int(df[col].isna().sum()), "nullPercent": round(df[col].isna().sum() / max(n, 1) * 100, 1)}
        for col in df.columns if df[col].isna().sum() > 0
    ]
    outlier_cols = []
    low_variance = []
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

    # insights
    tenure_time_col = next((c for c in ["snapshot_month", "snapshotMonth", "date", "tenure_months"] if c in df.columns), None)
    insights: list[str] = []
    if target_col:
        insights.append(f"Target column detected as {target_col}. {round(churned_n / max(n, 1) * 100, 1)}% of sample rows are positive.")
    else:
        insights.append("No target column was detected automatically. Please verify the label field.")
    if null_risks:
        insights.append(f"Missing values found in {len(null_risks)} columns. Consider cleaning or imputing these fields.")
    if duplicates > 0:
        insights.append(f"{duplicates} duplicate sample rows were detected.")
    if correlation_matrix:
        top = correlation_matrix[0]
        insights.append(f"Strong relationship found between {top['col1']} and {top['col2']} (corr {top['corr']}).")
    if time_trends and tenure_time_col:
        insights.append(f"Time trends were generated using {tenure_time_col}.")

    eda_report = {
        "targetColumn": target_col,
        "overview": overview,
        "numericStats": numeric_stats,
        "catStats": cat_stats,
        "bivariate": {"riskCategory": risk_category_data, "valueTier": value_tier_data},
        "multivariate": multivariate,
        "timeTrends": time_trends,
        "correlationMatrix": correlation_matrix[:30],
        "dataRisks": {
            "classImbalance": class_imbalance,
            "duplicates": duplicates,
            "nullRisks": null_risks,
            "outliers": outlier_cols,
            "lowVariance": low_variance,
        },
        "insights": insights,
        # Legacy keys used by dataset registry view
        "correlations": legacy_correlations,
        "distributions": legacy_distributions,
    }

    ds_updated = storage.update_dataset(db, dataset_id, {"eda_report": _sanitize_for_json(eda_report), "status": "analyzed"})
    return _sanitize_dataset(ds_updated)


@router.post("/{dataset_id}/feature-selection")
def feature_selection(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    cols = ds.columns or []
    numeric_cols = [c["name"] for c in cols if c.get("type") == "numeric"]
    cat_cols = [c["name"] for c in cols if c.get("type") == "categorical"]

    exclude = {"id", "account_number", "accountNumber", "customer_id", "customerId", "name", "created_at"}
    target_candidates = ["is_churned", "isChurned", "churned", "label", "target"]

    target = next((c for c in target_candidates if any(col["name"] == c for col in cols)), None)
    features = [c for c in numeric_cols if c not in exclude and c != target]

    return {
        "recommendedFeatures": features,
        "categoricalFeatures": [c for c in cat_cols if c not in exclude and c != target],
        "targetColumn": target,
        "excludedColumns": list(exclude),
        "totalFeatures": len(features),
    }


@router.post("/{dataset_id}/baseline-prediction")
def baseline_prediction(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    models_to_run = body.get("modelsToRun") or body.get("models_to_run") or ["Ridge", "RF", "XGB"]
    if not isinstance(models_to_run, list) or not models_to_run:
        models_to_run = ["Ridge", "RF", "XGB"]

    result = run_baseline_prediction(rows, models_to_run=models_to_run)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Baseline prediction failed"))

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}
    feature_report["baselinePrediction"] = {
        "summary": result.get("summary", {}),
        "preview": (result.get("predictions") or [])[:50],
    }
    storage.update_dataset(db, dataset_id, {"feature_report": _sanitize_for_json(feature_report)})

    return result


@router.post("/{dataset_id}/promo-uplift")
def promo_uplift_endpoint(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    try:
        alpha = float(body.get("alpha", 1.0))
    except (TypeError, ValueError):
        alpha = 1.0

    promo_cols = body.get("promoCols") or None

    result = run_baseline_prediction(rows, alpha=alpha, promo_cols=promo_cols)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Promo uplift failed"))

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}
    feature_report["promoUplift"] = {
        "summary": result.get("summary", {}),
        "preview": (result.get("predictions") or [])[:50],
    }
    storage.update_dataset(db, dataset_id, {"feature_report": _sanitize_for_json(feature_report)})

    return result


@router.post("/{dataset_id}/promo-roi")
def promo_roi_endpoint(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    """
    Calculate ROI per promo mechanic by combining uplift units with trade spend.

    Body:
      tradeSpendPerUnit  – { discount_depth: 0.45, feature_flag: 1.20, ... }
                           cost (in currency units) per active row for each mechanic
      avgPrice           – average selling price per unit (default 10.0)
    """
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}

    uplift_summary = feature_report.get("promoUplift", {}).get("summary", {})
    if not uplift_summary:
        raise HTTPException(
            status_code=400,
            detail="Run promo-uplift first before computing ROI",
        )

    promo_summary = uplift_summary.get("promoSummary", {})
    trade_spend: dict = body.get("tradeSpendPerUnit", {})

    try:
        avg_price = float(body.get("avgPrice", 10.0))
    except (TypeError, ValueError):
        avg_price = 10.0

    roi_results: dict = {}
    for mechanic, stats in promo_summary.items():
        total_uplift_units = float(stats.get("totalUpliftUnits") or 0)
        active_rows = int(stats.get("activeRows") or 1)
        avg_pct_uplift = stats.get("avgPctUplift")

        incremental_revenue = total_uplift_units * avg_price
        cost_per_unit = float(trade_spend.get(mechanic, 0))
        total_cost = cost_per_unit * active_rows
        roi = round(incremental_revenue / total_cost, 3) if total_cost > 0 else None

        roi_results[mechanic] = {
            "activeRows": active_rows,
            "totalUpliftUnits": round(total_uplift_units, 2),
            "avgPctUplift": avg_pct_uplift,
            "incrementalRevenue": round(incremental_revenue, 2),
            "totalCost": round(total_cost, 2),
            "roi": roi,
        }

    feature_report["promoRoi"] = roi_results
    storage.update_dataset(db, dataset_id, {"feature_report": _sanitize_for_json(feature_report)})

    return {"success": True, "roiResults": roi_results}


# Custom features

@router.get("/{dataset_id}/custom-features")
def get_custom_features(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return get_dataset_custom_features(ds)


@router.post("/{dataset_id}/custom-features/validate")
def validate_custom_feature_endpoint(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    feature = body.get("feature", {})
    col_names = [c["name"] for c in (ds.columns or [])]
    result = validate_custom_feature(feature, col_names)
    return result


@router.post("/{dataset_id}/custom-features/preview")
def preview_custom_feature(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    feature = body.get("feature", {})
    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="No data available")
    preview = build_preview_rows(rows[:100], [feature])
    return {"preview": preview[:10], "formula": build_custom_feature_formula(feature)}


@router.post("/{dataset_id}/custom-features")
def add_custom_feature(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}

    existing = feature_report.get("customFeatures", [])
    if not isinstance(existing, list):
        existing = []

    new_feature = body.get("feature", body)
    if not new_feature.get("id"):
        new_feature["id"] = str(uuid.uuid4())

    # Auto-inject entityKey when dataset has account_number column
    col_names = [c.get("name", "") for c in (ds.columns or [])]
    if not new_feature.get("entityKey") and "account_number" in col_names:
        new_feature["entityKey"] = "account_number"

    new_feature["status"] = "ready"
    new_feature["formula"] = build_custom_feature_formula(new_feature)

    existing = [f for f in existing if f.get("id") != new_feature["id"]]
    existing.append(new_feature)
    feature_report["customFeatures"] = existing

    ds_updated = storage.update_dataset(db, dataset_id, {"feature_report": feature_report})
    return _sanitize_dataset(ds_updated)


@router.delete("/{dataset_id}/custom-features/{feature_id}")
def delete_custom_feature(dataset_id: int, feature_id: str, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}
    existing = feature_report.get("customFeatures", [])
    feature_report["customFeatures"] = [f for f in existing if f.get("id") != feature_id]

    ds_updated = storage.update_dataset(db, dataset_id, {"feature_report": feature_report})
    return _sanitize_dataset(ds_updated)


@router.get("/{dataset_id}/feature-suggestions")
def feature_suggestions(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    cols = ds.columns or []
    numeric_cols = [c["name"] for c in cols if c.get("type") == "numeric"]
    cat_cols = [c["name"] for c in cols if c.get("type") == "categorical"]
    time_col = next((c["name"] for c in cols if any(k in c["name"].lower() for k in ["snapshot", "date", "month", "day", "year", "time"])), None)

    suggestions: list[dict] = []
    sid = 1

    if numeric_cols and time_col:
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{numeric_cols[0]}_trend_3m", "type": "trend",
            "formula": f"trend_slope({numeric_cols[0]}, window=3)",
            "description": f"3-month trend slope of {numeric_cols[0]}",
            "sourceColumn": numeric_cols[0], "window": 3, "timeColumn": time_col,
        })
        sid += 1

    if len(numeric_cols) >= 2:
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{numeric_cols[0]}_to_{numeric_cols[1]}_ratio",
            "type": "ratio", "formula": f"{numeric_cols[0]} / {numeric_cols[1]}",
            "description": f"Ratio of {numeric_cols[0]} to {numeric_cols[1]}",
            "numeratorColumn": numeric_cols[0], "denominatorColumn": numeric_cols[1],
        })
        sid += 1

    for col in numeric_cols[:3]:
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{col}_rolling_mean_3m", "type": "rolling",
            "formula": f"mean({col}, window=3)",
            "description": f"3-month rolling mean of {col}",
            "sourceColumn": col, "window": 3, "aggregation": "mean", "timeColumn": time_col,
        })
        sid += 1

    return suggestions
