"""KPI-anomaly dataset endpoints."""
from __future__ import annotations
import gzip, base64, io, math
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
import pandas as pd
import numpy as np
from database import get_db
import storage
from services.custom_features import get_dataset_rows
from services.ml_service import run_kpi_anomaly

router = APIRouter(prefix="/datasets", tags=["kpi-anomaly"])


def _sanitize_for_json(obj):
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    try:
        import pandas as _pd
        import numpy as _np
        if isinstance(obj, _pd.Timestamp) or (hasattr(_pd, "NaT") and obj is _pd.NaT):
            return None if _pd.isnull(obj) else obj.isoformat()
        if isinstance(obj, _np.integer):
            return int(obj)
        if isinstance(obj, _np.floating):
            v = float(obj)
            return None if (math.isnan(v) or math.isinf(v)) else v
    except Exception:
        pass
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_for_json(i) for i in obj]
    return obj


def _compress_csv(csv_text: str) -> str:
    return base64.b64encode(gzip.compress(csv_text.encode("utf-8"))).decode("ascii")


def _build_data_preview(csv_text: str, all_data: list[dict]) -> dict:
    import random
    preview     = all_data[:20]
    sample_size = min(len(all_data), 500)
    sample      = random.sample(all_data, sample_size) if len(all_data) > sample_size else all_data
    return {
        "preview": preview,
        "sample": sample,
        "compressedCsvBase64": _compress_csv(csv_text),
        "csvEncoding": "gzip-base64",
        "storageVersion": 2,
    }


def _sanitize_dataset(ds) -> dict:
    d  = {c.name: getattr(ds, c.name) for c in ds.__table__.columns}
    dp = d.get("data_preview") or {}
    if isinstance(dp, dict):
        dp = {k: v for k, v in dp.items() if k not in ("all", "rawCsv", "compressedCsvBase64")}
    d["data_preview"] = dp
    return d


def _compute_column_info(df: pd.DataFrame) -> list[dict]:
    cols = []
    for col in df.columns:
        series    = df[col]
        non_null  = series.dropna()
        null_count   = int(series.isna().sum())
        null_pct     = round(null_count / max(len(series), 1) * 100, 1)
        unique_count = int(series.nunique())
        is_numeric   = pd.api.types.is_numeric_dtype(series)
        numeric_stats:     dict = {}
        categorical_stats: dict = {}
        if is_numeric and len(non_null) > 0:
            nums = non_null.astype(float)
            numeric_stats = {
                "mean":   round(float(nums.mean()),   4),
                "median": round(float(nums.median()), 4),
                "stdDev": round(float(nums.std()),    4),
                "min":    float(nums.min()),
                "max":    float(nums.max()),
            }
            if len(nums) > 3:
                q1, q3 = float(nums.quantile(0.25)), float(nums.quantile(0.75))
                iqr     = q3 - q1
                outliers = int(((nums < q1 - 1.5 * iqr) | (nums > q3 + 1.5 * iqr)).sum())
                numeric_stats.update({
                    "q1": round(q1, 4), "q3": round(q3, 4),
                    "skewness": round(float(nums.skew()), 4),
                    "outlierCount": outliers,
                })
        else:
            counts = series.value_counts().head(10)
            categorical_stats["topValues"] = [
                {"value": str(k), "count": int(v)} for k, v in counts.items()
            ]
        cols.append({
            "name":             col,
            "type":             "numeric" if is_numeric else "categorical",
            "nullCount":        null_count,
            "nullPercent":      str(null_pct),
            "uniqueCount":      unique_count,
            "sampleValues":     [v for v in non_null.head(5).tolist()],
            "numericStats":     numeric_stats,
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
    content  = await file.read()
    csv_text = content.decode("utf-8")
    try:
        df = pd.read_csv(io.StringIO(csv_text))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse CSV: {exc}")

    if df.empty:
        raise HTTPException(status_code=400, detail="CSV file contains no data rows")

    df       = df.where(pd.notnull(df), None)
    all_data = _sanitize_for_json(df.to_dict(orient="records"))
    column_info  = _sanitize_for_json(_compute_column_info(df))
    data_preview = _sanitize_for_json(_build_data_preview(csv_text, all_data))

    ds = storage.create_dataset(db, {
        "name":          name or file.filename,
        "file_name":     file.filename,
        "row_count":     len(df),
        "column_count":  len(df.columns),
        "columns":       column_info,
        "status":        "uploaded",
        "data_preview":  data_preview,
        "quality_report": None,
        "eda_report":    None,
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

    cols           = ds.columns or []
    quality_issues: list[dict] = []
    column_reports: list[dict] = []
    score          = 100

    for col in cols:
        issues:   list[dict] = []
        null_pct  = float(col.get("nullPercent", 0))
        col_type  = col.get("type", "categorical")

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

    total_null     = sum(c.get("nullCount", 0) for c in cols)
    total_outliers = sum(c.get("numericStats", {}).get("outlierCount", 0) for c in cols if c.get("type") == "numeric")
    null_pcts      = [float(c.get("nullPercent", 0)) for c in cols]
    avg_completeness = round(100 - (sum(null_pcts) / max(len(null_pcts), 1)), 1)

    report = {
        "overallScore":   max(score, 0),
        "totalIssues":    sum(len(qi["issues"]) for qi in quality_issues),
        "completeness":   avg_completeness,
        "duplicates":     0,
        "missingValues":  total_null,
        "outliers":       total_outliers,
        "columnReports":  column_reports,
        "issues":         quality_issues,
        "recommendations": [
            "Ensure Week_Start_Date column is present and formatted as YYYY-MM-DD",
            "KPI columns should be numeric with minimal missing values",
            "Minimum 63 rows recommended for stable anomaly detection",
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
    cat_cols     = df.select_dtypes(exclude=[np.number]).columns.tolist()
    n            = len(df)

    # KPI overview
    date_range = None
    date_col   = next((c for c in df.columns if "week" in c.lower() or "date" in c.lower()), None)
    if date_col:
        _dates = pd.to_datetime(df[date_col], errors="coerce").dropna()
        if len(_dates):
            date_range = f"{_dates.min().strftime('%Y-%m-%d')} to {_dates.max().strftime('%Y-%m-%d')}"

    kpi_overview = {
        "totalRows":      n,
        "numericColumns": len(numeric_cols),
        "dateRange":      date_range,
        "dateColumn":     date_col,
    }

    # Numeric stats with histogram
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
            "mean":         round(float(series.mean()),   3),
            "median":       round(float(series.median()), 3),
            "stdDev":       round(float(series.std()),    3) if len(series) > 1 else 0,
            "min":          float(series.min()),
            "max":          float(series.max()),
            "nullCount":    int(df[col].isna().sum()),
            "completeness": round((1 - df[col].isna().sum() / max(n, 1)) * 100, 1),
            "histogram":    histogram,
        }

    cat_stats: dict = {}
    for col in cat_cols[:30]:
        counts = df[col].value_counts().head(15)
        cat_stats[col] = {
            "nullCount":   int(df[col].isna().sum()),
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
    outlier_cols: list[dict] = []
    low_variance: list[dict] = []
    for col in numeric_cols[:20]:
        series = df[col].dropna().astype(float)
        if len(series) < 4:
            continue
        q1_v, q3_v  = series.quantile(0.25), series.quantile(0.75)
        iqr          = q3_v - q1_v
        outlier_n    = int(((series < q1_v - 1.5 * iqr) | (series > q3_v + 1.5 * iqr)).sum())
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
    if n < 63:
        insights.append(f"Only {n} rows — minimum 63 recommended for stable anomaly detection.")

    eda_report = {
        "overview":          {"totalRows": n, "features": len(df.columns),
                              "numericFeatures": len(numeric_cols), "categoricalFeatures": len(cat_cols)},
        "numericStats":      numeric_stats,
        "catStats":          cat_stats,
        "correlationMatrix": correlation_matrix[:30],
        "dataRisks":         {
            "duplicates": duplicates, "nullRisks": null_risks,
            "outliers":   outlier_cols, "lowVariance": low_variance,
        },
        "insights":          insights,
        "kpiOverview":       _sanitize_for_json(kpi_overview),
        "correlations": [{"feature": c, "corr": 0} for c in list(numeric_stats.keys())[:20]],
        "distributions": [
            {"feature": col, "mean": s["mean"], "median": s["median"],
             "stdDev": s["stdDev"], "min": s["min"], "max": s["max"],
             "skewness": 0, "histogram": s.get("histogram", [])}
            for col, s in list(numeric_stats.items())[:20]
        ],
    }

    ds_updated = storage.update_dataset(db, dataset_id, {
        "eda_report": _sanitize_for_json(eda_report), "status": "analyzed"
    })
    return _sanitize_dataset(ds_updated)


@router.post("/{dataset_id}/feature-selection")
def feature_selection(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    cols         = ds.columns or []
    numeric_cols = [c["name"] for c in cols if c.get("type") == "numeric"]
    exclude      = {"id", "Week_Start_Date", "week_start_date", "date"}
    kpi_cols     = [c for c in numeric_cols if c not in exclude]
    return {
        "recommendedKpis":   kpi_cols,
        "dateColumn":        next((c["name"] for c in cols if "week" in c["name"].lower() or "date" in c["name"].lower()), None),
        "totalKpis":         len(kpi_cols),
        "excludedColumns":   list(exclude),
    }


# ── KPI Anomaly Detection endpoint ────────────────────────────────────────

@router.post("/{dataset_id}/kpi-anomaly")
def kpi_anomaly_endpoint(dataset_id: int, body: dict = {}, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data rows")

    kpi_config = body.get("kpiConfig") or None
    kpi_names  = body.get("kpiNames")  or None
    date_col   = str(body.get("dateCol", "Week_Start_Date")).strip() or "Week_Start_Date"
    run_name   = str(body.get("name", "")).strip() or None

    result = run_kpi_anomaly(
        rows,
        kpi_config=kpi_config,
        kpi_names=kpi_names,
        date_col=date_col,
    )
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "KPI anomaly detection failed"))

    summary = result.get("summary", {})

    feature_report = ds.feature_report or {}
    if not isinstance(feature_report, dict):
        feature_report = {}
    feature_report["kpiAnomaly"] = {
        "summary": summary,
        "preview": (result.get("anomalies") or [])[:50],
    }
    storage.update_dataset(db, dataset_id, {"feature_report": _sanitize_for_json(feature_report)})

    model_name = run_name or f"KPI Anomaly — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    model = storage.create_ml_model(db, {
        "name":             model_name,
        "dataset_id":       dataset_id,
        "algorithm":        "Isolation Forest",
        "status":           "trained",
        "accuracy":         None,
        "precision":        None,
        "recall":           None,
        "f1_score":         None,
        "auc":              None,
        "hyperparameters":  {"contamination": "auto", "random_state": 42},
        "feature_importance": [],
        "confusion_matrix": {},
        "model_weights":    _sanitize_for_json({
            "modelType":   "kpi_anomaly",
            "summary":     summary,
            "preview":     (result.get("anomalies") or [])[:50],
        }),
        "is_deployed": False,
        "deployed_at": None,
    })

    result["modelId"]     = model.id
    result["modelName"]   = model.name
    result["datasetId"]   = dataset_id
    result["datasetName"] = ds.name
    return result
