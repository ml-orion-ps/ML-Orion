from __future__ import annotations
import gzip, base64, io, uuid, math
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session
import pandas as pd
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
from services.ml_service import run_price_elasticity
from .eda import run_eda as _run_eda
from sqlalchemy.orm.attributes import flag_modified

from services.custom_features import (
    apply_custom_features,
    build_custom_feature_formula,
    validate_custom_feature,
    build_preview_rows,
    get_dataset_rows,
    get_dataset_custom_features,
)

router = APIRouter(prefix="/datasets", tags=["CPG Price Elasticity"])

USE_CASE = "cpg_price_elasticity"



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
def run_eda(dataset_id: int, usecase: str = Query("price_elasticity"), db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    df = pd.DataFrame(rows)

    try:
        eda_report = _run_eda(usecase, df)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"EDA computation failed: {exc}") from exc

    old_report = ds.eda_report if isinstance(ds.eda_report, dict) else {}
    new_report = {usecase: _sanitize_for_json(eda_report)}
    for k, v in old_report.items():
        if k != usecase:
            new_report[k] = v

    ds.eda_report = new_report
    ds.status = "analyzed"
    flag_modified(ds, "eda_report")
    db.commit()
    db.refresh(ds)

    print(f"[EDA] Saved for dataset {dataset_id}, usecase={usecase}, keys={list(ds.eda_report.keys())}")

    return _sanitize_dataset(ds)


@router.post("/run/{dataset_id}")
def run_elasticity(
    dataset_id: int,
    body: dict = {},
    db: Session = Depends(get_db),
):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset rows not found")

    custom_features = get_dataset_custom_features(ds)
    training_rows = apply_custom_features(rows, custom_features) if custom_features else rows

    try:
        result = run_price_elasticity(training_rows)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    global_elas = result.get("global_price_elasticity")
    rows_processed = result.get("rows_processed", len(rows))
    converged = result.get("model_converged", False)
    elasticity_summary = result.get("elasticity_summary", [])
    r2   = result.get("r2")
    mae  = result.get("mae")
    rmse = result.get("rmse")

    run_name = body.get("name") or f"Price Elasticity - {ds.name}"
    feature_importance = result.get("feature_importance", [])

    model = storage.create_ml_model(db, {
        "name": run_name,
        "dataset_id": dataset_id,
        "algorithm": "Mixed Linear Model",
        "use_case": USE_CASE,
        "status": "trained",
        "hyperparameters": {},
        "feature_importance": _sanitize_for_json(feature_importance),
        "confusion_matrix": {},
        "model_weights": _sanitize_for_json({
            "globalPriceElasticity": global_elas,
            "modelConverged": converged,
            "elasticitySummary": elasticity_summary,
            "rowsProcessed": rows_processed,
            "r2":               r2,
            "mae":              mae,
            "rmse":             rmse,
            "aic":              result.get("aic"),
            "bic":              result.get("bic"),
            "logLikelihood":    result.get("log_likelihood"),
            "priceCoefPvalue":  result.get("price_coef_pvalue"),
            "priceCoefStdErr":  result.get("price_coef_std_err"),
            "priceCoefTstat":   result.get("price_coef_tstat"),
        }),
        "is_deployed": False,
        "row_count": rows_processed,
        "r2":   float(r2)   if r2   is not None else None,
        "mae":  float(mae)  if mae  is not None else None,
        "rmse": float(rmse) if rmse is not None else None,
    })

    result["modelId"] = model.id
    result["runName"] = run_name
    return result

    
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


# Custom features

@router.get("/{dataset_id}/custom-features")
def get_custom_features(dataset_id: int, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {
        "datasetId": dataset_id,
        "features": get_dataset_custom_features(ds),
        "availableColumns": ds.columns or [],
    }


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
    feature = body.get("feature", body)
    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="No data available")
    validation = validate_custom_feature(feature, [c["name"] for c in (ds.columns or [])])
    if not validation.get("valid"):
        raise HTTPException(status_code=400, detail="; ".join(validation.get("errors", [])))
    preview = build_preview_rows(rows[:100], [feature])
    return {
        "preview": preview[:10],
        "formula": build_custom_feature_formula(feature),
        "warnings": validation.get("warnings", []),
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
    if not new_feature.get("entityKey") and "account_number" in col_names:
        new_feature["entityKey"] = "account_number"

    new_feature["status"] = "ready"
    new_feature["formula"] = build_custom_feature_formula(new_feature)
    validation = validate_custom_feature(new_feature, col_names)
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

    suggestion_specs = [
        (
            "avg_brand_price_store_week",
            "AVG(price) by brand, store, week",
            "Captures average brand-level price movement within a store-week.",
            "high",
            0.060,
        ),
        (
            "own_brand_price_index",
            "SKU price / avg_brand_price_store_week",
            "Shows whether the SKU is priced higher or lower than its own brand average.",
            "high",
            0.058,
        ),
        (
            "avg_cat_price_store_week",
            "AVG(price) by category, store, week",
            "Captures the overall category price level in a store-week.",
            "high",
            0.056,
        ),
        (
            "own_cat_price_index",
            "SKU price / avg_cat_price_store_week",
            "Measures SKU price positioning versus the category average.",
            "high",
            0.054,
        ),
        (
            "seasonality_index",
            "avg_sales_for_week_or_month / overall_avg_sales",
            "Captures recurring seasonal demand patterns.",
            "high",
            0.052,
        ),
        (
            "price_change_vs_last_week",
            "(price_t - price_t-1) / price_t-1",
            "Captures sudden price movement impact on demand.",
            "medium",
            0.048,
        ),
        (
            "price_change_vs_4wk_avg",
            "(price_t - avg_price_last_4_weeks) / avg_price_last_4_weeks",
            "Measures deviation from recent normal price levels.",
            "medium",
            0.046,
        ),
        (
            "competitor_avg_price_cat_store_week",
            "AVG(competitor_price) by category, store, week",
            "Captures external competitive pricing pressure.",
            "medium",
            0.044,
        ),
        (
            "competitor_price_index",
            "SKU price / competitor_avg_price_cat_store_week",
            "Measures SKU price competitiveness versus competitors.",
            "medium",
            0.042,
        ),
        (
            "promo_intensity_score",
            "discount_depth + feature_flag + display_flag + bogo_flag or weighted score",
            "Captures combined promotional pressure.",
            "medium",
            0.040,
        ),
        (
            "weeks_since_last_promo",
            "current_week - last_promo_week",
            "Captures post-promo normalization or demand reset.",
            "medium",
            0.038,
        ),
        (
            "cannibalization_index_brand",
            "other_SKU_same_brand_sales / total_brand_sales",
            "Captures internal brand-level substitution risk.",
            "low",
            0.036,
        ),
        (
            "category_demand_index_store_week",
            "category_sales_store_week / avg_category_sales_store",
            "Captures whether the category itself is over- or under-performing.",
            "low",
            0.034,
        ),
        (
            "store_size_index",
            "store_sales / avg_store_sales",
            "Captures store-level selling capacity.",
            "low",
            0.032,
        ),
    ]

    suggestions = [
        {
            "id": f"sug_{idx}",
            "name": name,
            "type": "business_logic",
            "formula": formula,
            "reason": reason,
            "priority": priority,
            "importanceGain": importance_gain,
        }
        for idx, (name, formula, reason, priority, importance_gain) in enumerate(suggestion_specs, start=1)
    ]

    return {"suggestions": suggestions}

