"""Promo-uplift dataset endpoints."""
from __future__ import annotations
import gzip, base64, io, math, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
import pandas as pd
import numpy as np
from database import get_db
import storage
from services.custom_features import (
    get_dataset_rows,
    build_custom_feature_formula,
    validate_custom_feature,
    build_preview_rows,
    get_dataset_custom_features,
    apply_custom_features,
)
from services.ml_service import run_promo_uplift, run_promo_feature_suggestions

router = APIRouter(prefix="/datasets", tags=["promo-uplift"])


def _sanitize_for_json(obj):
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(i) for i in obj]
    return obj


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
                outliers = int(((nums < q1 - 1.5 * iqr) | (nums > q3 + 1.5 * iqr)).sum())
                numeric_stats.update({
                    "q1": round(q1, 4), "q3": round(q3, 4),
                    "skewness": round(float(nums.skew()), 4), "outlierCount": outliers,
                })
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


# ── Standard dataset CRUD ──────────────────────────────────────────────────

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
    all_data = _sanitize_for_json(df.to_dict(orient="records"))
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


@router.get("")
def list_datasets(db: Session = Depends(get_db)):
    return [_sanitize_dataset(ds) for ds in storage.get_datasets(db)]


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
            issues.append({"type": "missing_values", "severity": sev,
                           "description": f"{null_pct}% missing values ({col.get('nullCount', 0)} of {ds.row_count} records)",
                           "recommendation": rec})
            score -= (10 if sev == "high" else 5)

        if col_type == "numeric":
            stats = col.get("numericStats", {})
            if stats.get("outlierCount", 0) > ds.row_count * 0.05:
                issues.append({"type": "outliers", "severity": "medium",
                               "description": f"{stats['outlierCount']} outliers detected",
                               "recommendation": "Review and cap using IQR or winsorization"})
                score -= 3
            if abs(stats.get("skewness", 0)) > 2:
                issues.append({"type": "skewness", "severity": "low",
                               "description": f"High skewness: {stats.get('skewness', 0):.2f}",
                               "recommendation": "Consider log or Box-Cox transformation"})
                score -= 2
        else:
            top = col.get("categoricalStats", {}).get("topValues", [])
            if top and top[0].get("count", 0) / max(ds.row_count, 1) > 0.95:
                issues.append({"type": "high_cardinality", "severity": "low",
                               "description": f"Single value dominates ({top[0]['count']} / {ds.row_count})",
                               "recommendation": "Consider dropping this column"})

        if issues:
            quality_issues.append({"column": col["name"], "issues": issues})
        column_reports.append({"column": col["name"], "type": col_type, "issues": issues,
                                "status": "ok" if not issues else "warning"})

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
def run_eda(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    df = pd.DataFrame(rows)
    df = df.where(pd.notnull(df), None)

    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()
    n = len(df)

    # Promo dataset EDA (detects PROMO_1..PROMO_15 columns)
    is_promo = any(f"PROMO_{i}" in df.columns for i in range(1, 16))
    _sales = "sales_units" if "sales_units" in df.columns else None

    promo_overview: dict | None = None
    promo_activity: list[dict] = []
    brand_sales: list[dict] = []
    promo_multivariate: list[dict] = []
    promo_time_trends: list[dict] = []

    if is_promo:
        try:
            date_range = None
            if "date" in df.columns:
                _dates = pd.to_datetime(df["date"], errors="coerce").dropna()
                if len(_dates):
                    date_range = f"{_dates.min().strftime('%Y-%m-%d')} to {_dates.max().strftime('%Y-%m-%d')}"
            promo_overview = {
                "totalRows": n,
                "uniqueSkus": int(df["sku_id"].nunique()) if "sku_id" in df.columns else 0,
                "uniqueBrands": int(df["brand"].nunique()) if "brand" in df.columns else 0,
                "uniqueChannels": int(df["sales_channel_short_name"].nunique()) if "sales_channel_short_name" in df.columns else 0,
                "totalSalesUnits": int(df[_sales].sum()) if _sales else 0,
                "avgPromoSpend": round(float(df["PROMO_SPENDS"].mean()), 2) if "PROMO_SPENDS" in df.columns else 0,
                "activeMechanics": sum(1 for i in range(1, 16) if f"PROMO_{i}" in df.columns),
                "dateRange": date_range,
            }
        except Exception:
            pass

        for _i in range(1, 16):
            _pc = f"PROMO_{_i}"
            if _pc not in df.columns:
                continue
            try:
                _mask = df[_pc].fillna(0).astype(float) > 0
                _active_n = int(_mask.sum())
                if _active_n == 0:
                    continue
                _eff_col = f"PROMO_{_i}_effect_units"
                _avg_eff = None
                if _eff_col in df.columns:
                    _ev = df.loc[_mask, _eff_col].dropna().astype(float)
                    _avg_eff = round(float(_ev.mean()), 2) if len(_ev) else None
                _avg_on = round(float(df.loc[_mask, _sales].dropna().astype(float).mean()), 2) if _sales and _active_n else None
                _avg_off = round(float(df.loc[~_mask, _sales].dropna().astype(float).mean()), 2) if _sales and int((~_mask).sum()) > 0 else None
                promo_activity.append({
                    "mechanic": _pc, "activeRows": _active_n,
                    "avgUnitsOn": _avg_on, "avgUnitsOff": _avg_off,
                    "avgEffect": _avg_eff,
                    "uplift": round((_avg_on or 0) - (_avg_off or 0), 2),
                })
            except Exception:
                continue

        if "brand" in df.columns and _sales:
            try:
                _bg = df.groupby("brand")[_sales].agg(["sum", "mean", "count"])
                for _brand, _row in _bg.iterrows():
                    brand_sales.append({
                        "label": str(_brand), "totalUnits": int(_row["sum"]),
                        "avgUnits": round(float(_row["mean"]), 2), "rows": int(_row["count"]),
                    })
                brand_sales.sort(key=lambda x: -x["totalUnits"])
                brand_sales = brand_sales[:15]
            except Exception:
                pass

        _chan = "sales_channel_short_name" if "sales_channel_short_name" in df.columns else None
        if "brand" in df.columns and _chan and _sales:
            try:
                _mg = df.groupby(["brand", _chan])[_sales].agg(["sum", "mean", "count"]).reset_index()
                for _, _r in _mg.iterrows():
                    promo_multivariate.append({
                        "brand": str(_r["brand"]), "channel": str(_r[_chan]),
                        "totalUnits": int(_r["sum"]), "avgUnits": round(float(_r["mean"]), 2),
                        "rows": int(_r["count"]),
                    })
                promo_multivariate.sort(key=lambda x: -x["totalUnits"])
                promo_multivariate = promo_multivariate[:20]
            except Exception:
                pass

        if "month" in df.columns and _sales:
            try:
                _mgrp = df.groupby("month")[_sales].agg(["sum", "mean", "count"]).reset_index()
                for _, _r in _mgrp.iterrows():
                    promo_time_trends.append({
                        "period": str(int(_r["month"])), "totalUnits": int(_r["sum"]),
                        "avgUnits": round(float(_r["mean"]), 2), "rows": int(_r["count"]),
                    })
                promo_time_trends.sort(key=lambda x: int(x["period"]))
            except Exception:
                pass

    # Generic numeric stats
    numeric_stats: dict = {}
    for col in numeric_cols[:40]:
        series = df[col].dropna().astype(float)
        if len(series) == 0:
            continue
        hist_vals, edges = np.histogram(series, bins=15)
        histogram = [
            {"label": f"{edges[i]:.1f}–{edges[i+1]:.1f}", "count": int(hist_vals[i])}
            for i in range(len(hist_vals))
        ]
        numeric_stats[col] = {
            "mean": round(float(series.mean()), 3),
            "median": round(float(series.median()), 3),
            "stdDev": round(float(series.std()), 3) if len(series) > 1 else 0,
            "min": float(series.min()), "max": float(series.max()),
            "nullCount": int(df[col].isna().sum()),
            "completeness": round((1 - df[col].isna().sum() / max(n, 1)) * 100, 1),
            "histogram": histogram,
        }

    cat_stats: dict = {}
    for col in cat_cols[:30]:
        counts = df[col].value_counts().head(15)
        cat_stats[col] = {
            "nullCount": int(df[col].isna().sum()),
            "uniqueCount": int(df[col].nunique()),
            "top": [{"label": str(val), "count": int(cnt)} for val, cnt in counts.items()],
        }

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

    duplicates = int(df.duplicated().sum())
    null_risks = [
        {"column": col, "nullCount": int(df[col].isna().sum()),
         "nullPercent": round(df[col].isna().sum() / max(n, 1) * 100, 1)}
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

    insights: list[str] = []
    if null_risks:
        insights.append(f"Missing values found in {len(null_risks)} columns.")
    if duplicates > 0:
        insights.append(f"{duplicates} duplicate rows detected.")
    if correlation_matrix:
        top = correlation_matrix[0]
        insights.append(f"Strong relationship between {top['col1']} and {top['col2']} (corr {top['corr']}).")
    if is_promo and promo_activity:
        insights.append(f"{len(promo_activity)} active promo mechanics detected.")

    eda_report = {
        "overview": {"totalRows": n, "features": len(df.columns),
                     "numericFeatures": len(numeric_cols), "categoricalFeatures": len(cat_cols)},
        "numericStats": numeric_stats,
        "catStats": cat_stats,
        "correlationMatrix": correlation_matrix[:30],
        "dataRisks": {
            "duplicates": duplicates, "nullRisks": null_risks,
            "outliers": outlier_cols, "lowVariance": low_variance,
        },
        "insights": insights,
        "promoOverview": _sanitize_for_json(promo_overview),
        "promoActivity": _sanitize_for_json(promo_activity),
        "brandSales": _sanitize_for_json(brand_sales),
        "promoMultivariate": _sanitize_for_json(promo_multivariate),
        "promoTimeTrends": _sanitize_for_json(promo_time_trends),
        "correlations": [{"feature": c, "corr": 0} for c in list(numeric_stats.keys())[:20]],
        "distributions": [
            {"feature": col, "mean": s["mean"], "median": s["median"],
             "stdDev": s["stdDev"], "min": s["min"], "max": s["max"],
             "skewness": 0, "histogram": s.get("histogram", [])}
            for col, s in list(numeric_stats.items())[:20]
        ],
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


# ── Custom features ────────────────────────────────────────────────────────


@router.get("/{dataset_id}/custom-features")
def get_custom_features(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    features = get_dataset_custom_features(ds)
    available_columns = [
        {"name": c["name"], "type": c.get("type", "categorical")}
        for c in (ds.columns or [])
    ]
    return {
        "datasetId": dataset_id,
        "features": features,
        "availableColumns": available_columns,
    }


@router.post("/{dataset_id}/custom-features")
def add_custom_feature(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
 
    feature_report = dict(ds.feature_report) if isinstance(ds.feature_report, dict) else {}
 
    existing = feature_report.get("customFeatures", [])
    if not isinstance(existing, list):
        existing = []
    existing = list(existing)
 
    new_feature = dict(body.get("feature", body))
    if not new_feature.get("id"):
        new_feature["id"] = str(uuid.uuid4())
 
    # Auto-inject entityKey when dataset has account_number column
    col_names = [c.get("name", "") for c in (ds.columns or [])]
    if not new_feature.get("entityKey"):
        for _ek in ("sku_id", "product_id", "account_number"):
            if _ek in col_names:
                new_feature["entityKey"] = _ek
                break
 
    new_feature["status"] = "ready"
    new_feature["formula"] = build_custom_feature_formula(new_feature)
    validation = validate_custom_feature(new_feature, col_names, use_case="cpg_baseline")
    if not validation.get("valid"):
        raise HTTPException(status_code=400, detail="; ".join(validation.get("errors", [])))
 
    existing = [f for f in existing if f.get("id") != new_feature["id"]]
    existing.append(new_feature)
    feature_report["customFeatures"] = existing
 
    ds_updated = storage.update_dataset(db, dataset_id, {"feature_report": feature_report})
    return {
        "dataset": _sanitize_dataset(ds_updated),
        "feature": new_feature,
        "warnings": validation.get("warnings", []),
    }
 
@router.post("/{dataset_id}/custom-features/validate")
def validate_custom_feature_endpoint(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    feature = body.get("feature", body)
    col_names = [c["name"] for c in (ds.columns or [])]
    for f in get_dataset_custom_features(ds):
        col_names.append(f["name"])
    return validate_custom_feature(feature, col_names, use_case="cpg_baseline")


@router.post("/{dataset_id}/custom-features/preview")
def preview_custom_feature(dataset_id: int, body: dict, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    # Accept both flat payload {name, type, ...} and wrapped {feature: {...}}
    feature = body.get("feature", body)
    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="No data available")
    preview = build_preview_rows(rows[:100], [feature], use_case="cpg_baseline")
    return {"preview": preview[:10], "formula": build_custom_feature_formula(feature)}


@router.delete("/{dataset_id}/custom-features/{feature_id}")
def delete_custom_feature(dataset_id: int, feature_id: str, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    feature_report = dict(ds.feature_report) if isinstance(ds.feature_report, dict) else {}
    existing = feature_report.get("customFeatures", [])
    if not isinstance(existing, list):
        existing = []
    existing = list(existing)
    feature_report["customFeatures"] = [f for f in existing if f.get("id") != feature_id]

    ds_updated = storage.update_dataset(db, dataset_id, {"feature_report": feature_report})
    return _sanitize_dataset(ds_updated)


@router.get("/groq-status")
def groq_status():
    """Return whether the GROQ_API_KEY is configured in the environment."""
    from services.ml_service import _read_env_key
    return {"hasKey": bool(_read_env_key("GROQ_API_KEY"))}


@router.get("/{dataset_id}/feature-suggestions")
def feature_suggestions(dataset_id: int, db: Session = Depends(get_db)):
    import traceback, sys as _sys

    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    try:
        cols = ds.columns or []
        if isinstance(cols, str):
            import json as _json
            cols = _json.loads(cols)
        all_col_names = [c["name"] for c in cols]

        entity_col = next(
            (c["name"] for c in cols if c["name"] in ("sku_id", "product_id", "item_id", "account_number")),
            None,
        )
        time_col = next(
            (c["name"] for c in cols
             if any(k in c["name"].lower() for k in ("week", "month", "date", "snapshot", "period", "day", "year"))),
            None,
        )
        promo_cols = [
            c["name"] for c in cols
            if (
                c["name"].upper().startswith("PROMO_")
                and not c["name"].lower().endswith("_effect_units")
            ) or c["name"] in ("discount_depth", "feature_flag", "display_flag", "bogo_flag")
        ]

        raw_rows = get_dataset_rows(ds)
        sample_rows = raw_rows[:8] if raw_rows else []

        dataset_info = {
            "datasetName": ds.name or "Dataset",
            "columns": all_col_names,
            "columnDetails": [{"name": c["name"], "type": c.get("type", "unknown")} for c in cols],
            "sampleRows": sample_rows,
            "promoColumns": promo_cols,
            "entityColumn": entity_col,
            "timeColumn": time_col,
        }

        result = run_promo_feature_suggestions(dataset_info)
        suggestions = result.get("suggestions", [])
        source = result.get("source", "fallback")
        error_msg = result.get("error")

    except Exception as exc:
        _sys.stderr.write(f"[feature_suggestions] endpoint error: {traceback.format_exc()}\n")
        suggestions = []
        source = "error"
        error_msg = str(exc)

    return {
        "suggestions": suggestions,
        "source": source,
        "datasetId": dataset_id,
        **({"error": error_msg} if error_msg else {}),
    }


@router.post("/{dataset_id}/promo-uplift")
def promo_uplift_endpoint(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    raw_rows = get_dataset_rows(ds)
    if not raw_rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    # Apply any saved custom features before training
    custom_features = get_dataset_custom_features(ds)
    rows = apply_custom_features(raw_rows, custom_features) if custom_features else raw_rows

    try:
        alpha = float(body.get("alpha", 1.0))
    except (TypeError, ValueError):
        alpha = 1.0

    algorithm  = str(body.get("algorithm", "Ridge")).strip() or "Ridge"
    promo_cols = body.get("promoCols") or None
    run_name   = str(body.get("name", "")).strip() or None

    custom_feature_names = [f["name"] for f in custom_features]
    result = run_promo_uplift(
        rows, algorithm=algorithm, alpha=alpha,
        promo_cols=promo_cols,
        custom_feature_names=custom_feature_names or None,
    )
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

    summary  = result.get("summary", {})
    metrics  = summary.get("metrics", {})
    model_name = run_name or f"Promo Uplift [{algorithm}] — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    model = storage.create_ml_model(db, {
        "name": model_name,
        "dataset_id": dataset_id,
        "algorithm": algorithm,
        "status": "trained",
        "accuracy": None,
        "precision": None,
        "recall": None,
        "f1_score": None,
        "auc": metrics.get("r2"),
        "hyperparameters": {"alpha": alpha},
        "feature_importance": [],
        "confusion_matrix": {},
        "model_weights": _sanitize_for_json({
            "modelType": "promo_uplift",
            "customFeatures": custom_features,
            "customFeatureNames": custom_feature_names,
            "summary": summary,
            "preview": (result.get("predictions") or [])[:50],
        }),
        "is_deployed": False,
        "deployed_at": None,
    })

    result["modelId"]     = model.id
    result["modelName"]   = model.name
    result["datasetId"]   = dataset_id
    result["datasetName"] = ds.name
    return result


@router.post("/{dataset_id}/promo-roi")
def promo_roi_endpoint(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    """Calculate ROI per promo mechanic from a previously-saved uplift run."""
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}

    uplift_summary = feature_report.get("promoUplift", {}).get("summary", {})
    if not uplift_summary:
        raise HTTPException(status_code=400, detail="Run promo-uplift first before computing ROI")

    promo_summary = uplift_summary.get("promoSummary", {})
    trade_spend: dict = body.get("tradeSpendPerUnit", {})

    try:
        avg_price = float(body.get("avgPrice", 10.0))
    except (TypeError, ValueError):
        avg_price = 10.0

    roi_results: dict = {}
    for mechanic, stats in promo_summary.items():
        total_uplift_units = float(stats.get("totalUpliftUnits") or 0)
        active_rows        = int(stats.get("activeRows") or 1)
        avg_pct_uplift     = stats.get("avgPctUplift")
        incremental_revenue = total_uplift_units * avg_price
        cost_per_unit       = float(trade_spend.get(mechanic, 0))
        total_cost          = cost_per_unit * active_rows
        roi = round(incremental_revenue / total_cost, 3) if total_cost > 0 else None
        roi_results[mechanic] = {
            "activeRows":          active_rows,
            "totalUpliftUnits":    round(total_uplift_units, 2),
            "avgPctUplift":        avg_pct_uplift,
            "incrementalRevenue":  round(incremental_revenue, 2),
            "totalCost":           round(total_cost, 2),
            "roi":                 roi,
        }

    feature_report["promoRoi"] = roi_results
    storage.update_dataset(db, dataset_id, {"feature_report": _sanitize_for_json(feature_report)})
    return {"success": True, "roiResults": roi_results}
