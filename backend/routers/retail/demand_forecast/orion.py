from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db
import storage
from models import MlModel
from services.custom_features import get_dataset_rows

router = APIRouter(prefix="/orion", tags=["orion"])

USE_CASE = "retail_demand_forecast"


@router.get("/overview")
def orion_overview(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    datasets = storage.get_datasets(db)
    customers = storage.get_customers(db)
    predictions = storage.get_predictions(db)
    recs = storage.get_recommendations(db)

    deployed = [m for m in models if m.is_deployed]
    active = [c for c in customers if not c.is_churned]
    at_risk = [c for c in active if (c.churn_risk_score or 0) > 0.6]
    churned = [c for c in customers if c.is_churned]

    completed_recs = [r for r in recs if r.status == "completed"]
    saved_recs = [r for r in completed_recs if r.outcome == "retained"]
    retention_rate = round(len(saved_recs) / max(len(completed_recs), 1) * 100, 1)
    rev_at_risk = round(sum(c.monthly_revenue or 0 for c in at_risk) * 12)
    churn_rate = round(len(churned) / max(len(customers), 1) * 100, 1)

    deployed_aucs = [m.auc for m in deployed if m.auc is not None]
    avg_auc = round(sum(deployed_aucs) / len(deployed_aucs), 4) if deployed_aucs else None

    unique_scored = len(set(p["customer_id"] for p in predictions))

    # Demand forecast KPIs — use all df models regardless of is_deployed
    # (demand forecast models are saved with is_deployed=False)
    df_models = storage.get_ml_models(db, use_case=USE_CASE)
    df_latest = sorted(df_models, key=lambda m: m.trained_at or "", reverse=True)
    df_wmapes = [m.wmape for m in df_models if m.wmape is not None]
    avg_wmape = round(sum(df_wmapes) / len(df_wmapes), 4) if df_wmapes else None
    forecasted_units = None
    for m in df_latest:
        if m.forecastUnits is not None:
            forecasted_units = round(m.forecastUnits, 0)
            break
    unique_rows_scored = 0
    for m in df_latest:
        mw = m.model_weights if isinstance(m.model_weights, dict) else {}
        if mw.get("unique_combinations"):
            unique_rows_scored = mw["unique_combinations"]
            break

    risk_dist = {"low": 0, "medium": 0, "high": 0, "veryHigh": 0}
    for c in active:
        s = c.churn_risk_score or 0
        if s >= 0.8:
            risk_dist["veryHigh"] += 1
        elif s >= 0.6:
            risk_dist["high"] += 1
        elif s >= 0.3:
            risk_dist["medium"] += 1
        else:
            risk_dist["low"] += 1

    model_performance = [
        {
            "id": m.id, "name": m.name, "algorithm": m.algorithm,
            "accuracy": m.accuracy, "auc": m.auc, "f1": m.f1_score,
            "precision": m.precision, "recall": m.recall,
            "isDeployed": m.is_deployed, "trainedAt": m.trained_at,
        }
        for m in models[:6]
    ]

    return {
        "kpis": {
            "totalModels": len(models),
            "deployedModels": len(deployed),
            "avgAuc": avg_auc,
            "totalPredictions": len(predictions),
            "customersScored": unique_scored,
            "totalDatasets": len(datasets),
            "retentionSuccessRate": retention_rate,
            "revenueAtRisk": rev_at_risk,
            "avgWmape": avg_wmape,
            "uniqueRowsScored": unique_rows_scored,
            "forecastedUnits": forecasted_units,
        },
        "churnRate": churn_rate,
        "revenueAtRisk": rev_at_risk,
        "riskDistribution": risk_dist,
        "modelPerformance": model_performance,
        "activeModel": {
            "id": deployed[0].id, "name": deployed[0].name,
            "algorithm": deployed[0].algorithm, "auc": deployed[0].auc,
            "accuracy": deployed[0].accuracy, "f1Score": deployed[0].f1_score,
            "isDeployed": True, "trainedAt": deployed[0].trained_at,
        } if deployed else None,
        "recentModels": [
            {"id": m.id, "name": m.name, "algorithm": m.algorithm,
             "auc": m.auc, "status": m.status, "trainedAt": m.trained_at}
            for m in models[:5]
        ],
    }


@router.get("/outcome-analysis")
def outcome_analysis(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)

    def _unique_combos(m) -> int | None:
        mw = m.model_weights if isinstance(m.model_weights, dict) else {}
        val = mw.get("unique_combinations")
        return int(val) if val is not None else None

    # 1. SKU-level Accuracy Distribution — per store×style WMAPE from the latest model run
    latest_model = sorted(models, key=lambda m: m.trained_at or "", reverse=True)
    latest_model = latest_model[0] if latest_model else None
    sku_wmapes = []
    if latest_model:
        mw = latest_model.model_weights if isinstance(latest_model.model_weights, dict) else {}
        raw = mw.get("sku_wmapes") or []
        sku_wmapes = [float(w) for w in raw if w is not None]

    sku_band_counts = {"Excellent": 0, "Good": 0, "Fair": 0, "Poor": 0}
    for wmape in sku_wmapes:
        if wmape < 10:
            sku_band_counts["Excellent"] += 1
        elif wmape < 20:
            sku_band_counts["Good"] += 1
        elif wmape < 30:
            sku_band_counts["Fair"] += 1
        else:
            sku_band_counts["Poor"] += 1
    total_skus = len(sku_wmapes)
    accuracy_distribution = [
        {"band": k, "count": v, "pct": round(v / max(total_skus, 1) * 100, 1), "color": c}
        for (k, v), c in zip(
            sku_band_counts.items(),
            ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444"],
        )
    ]

    # 2. WMAPE by run — last 10 model runs with WMAPE recorded
    sorted_by_date = sorted(
        [m for m in models if m.wmape is not None],
        key=lambda m: m.trained_at or "",
    )[-10:]
    wmape_by_run = [
        {
            "run": m.trained_at.strftime("%d/%m/%Y") if m.trained_at else f"Run {m.id}",
            "wmape": round(m.wmape, 1),
            "algorithm": m.algorithm,
        }
        for m in sorted_by_date
    ]

    # 3. Algorithm performance — grouped by algorithm, rows from model_weights
    algo_groups: dict[str, dict] = {}
    for m in models:
        algo = m.algorithm or "Unknown"
        if algo not in algo_groups:
            algo_groups[algo] = {"wmapes": [], "rows": [], "count": 0}
        algo_groups[algo]["count"] += 1
        if m.wmape is not None:
            algo_groups[algo]["wmapes"].append(m.wmape)
        combos = _unique_combos(m)
        if combos is not None:
            algo_groups[algo]["rows"].append(combos)
    algorithm_performance = [
        {
            "algorithm": algo,
            "runCount": d["count"],
            "avgWmape": round(sum(d["wmapes"]) / len(d["wmapes"]), 1) if d["wmapes"] else None,
            "avgRows": round(sum(d["rows"]) / len(d["rows"])) if d["rows"] else None,
        }
        for algo, d in sorted(algo_groups.items(), key=lambda x: -x[1]["count"])
    ]

    # 4. Actual vs Forecast by run — last 10 runs with unit data
    actual_vs_forecast = [
        {
            "run": m.trained_at.strftime("%d/%m/%Y") if m.trained_at else f"Run {m.id}",
            "algorithm": m.algorithm,
            "actualUnits": round(m.actualUnits or 0),
            "forecastUnits": round(m.forecastUnits or 0),
        }
        for m in sorted(
            [m for m in models if m.actualUnits is not None or m.forecastUnits is not None],
            key=lambda m: m.trained_at or "",
        )[-10:]
    ]

    # Unique style×store combinations from the latest model's model_weights
    latest_combos = 0
    for m in sorted(models, key=lambda m: m.trained_at or "", reverse=True):
        c = _unique_combos(m)
        if c:
            latest_combos = c
            break

    return {
        "accuracyDistribution": accuracy_distribution,
        "wmapeByRun": wmape_by_run,
        "algorithmPerformance": algorithm_performance,
        "actualVsForecast": actual_vs_forecast,
        "uniqueCombinations": latest_combos,
        "totalModels": len(models),
    }


@router.get("/model-runs")
def model_runs(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    sorted_models = sorted(models, key=lambda m: m.trained_at or "", reverse=True)

    def _unique_combos(m) -> int | None:
        mw = m.model_weights if isinstance(m.model_weights, dict) else {}
        val = mw.get("unique_combinations")
        return int(val) if val is not None else None

    return [
        {
            "id": m.id,
            "name": m.name,
            "algorithm": m.algorithm,
            "wmape": round(m.wmape, 1) if m.wmape is not None else None,
            "actualUnits": round(m.actualUnits) if m.actualUnits is not None else None,
            "forecastUnits": round(m.forecastUnits) if m.forecastUnits is not None else None,
            "uniqueCombinations": _unique_combos(m),
            "status": m.status,
            "isDeployed": m.is_deployed,
            "trainedAt": m.trained_at,
        }
        for m in sorted_models
    ]


@router.patch("/model-runs/{model_id}/deploy")
def deploy_model_run(model_id: int, db: Session = Depends(get_db)):
    target = storage.get_ml_model(db, model_id)
    if not target or target.use_case != USE_CASE:
        raise HTTPException(status_code=404, detail="Model not found")

    # Demote all other demand forecast models first
    all_df = storage.get_ml_models(db, use_case=USE_CASE)
    for m in all_df:
        if m.id != model_id and m.is_deployed:
            storage.update_ml_model(db, m.id, {"is_deployed": False})

    from datetime import datetime, timezone
    updated = storage.update_ml_model(db, model_id, {
        "is_deployed": True,
        "deployed_at": datetime.now(timezone.utc),
        "status": "deployed",
    })
    return {"ok": True, "id": updated.id, "isDeployed": updated.is_deployed}


@router.patch("/model-runs/{model_id}/demote")
def demote_model_run(model_id: int, db: Session = Depends(get_db)):
    target = storage.get_ml_model(db, model_id)
    if not target or target.use_case != USE_CASE:
        raise HTTPException(status_code=404, detail="Model not found")
    storage.update_ml_model(db, model_id, {"is_deployed": False, "status": "trained"})
    return {"ok": True, "id": model_id, "isDeployed": False}


@router.get("/sku-forecasts")
def sku_forecasts(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    sorted_models = sorted(models, key=lambda m: m.trained_at or "", reverse=True)

    # Find latest model that has an associated dataset
    latest = next((m for m in sorted_models if m.dataset_id is not None), None)
    if not latest:
        return {"preview": [], "featureImportance": [], "modelName": None, "algorithm": None, "trainedAt": None}

    # Feature importance from model record — top 10 by score
    fi_raw = latest.feature_importance or []
    feature_importance = sorted(
        [{"name": x["name"], "importance": x["importance"]} for x in fi_raw if x.get("importance") and x["importance"] > 0],
        key=lambda x: -x["importance"],
    )[:10]

    # SKU-level forecast rows stored in dataset.feature_report["DemandForecasting"]["preview"]
    ds = storage.get_dataset(db, latest.dataset_id)
    raw_preview = []
    if ds and isinstance(ds.feature_report, dict):
        df_report = ds.feature_report.get("DemandForecasting", {})
        raw_preview = df_report.get("preview", []) or []

    def _val(v):
        """Return v unchanged unless it is NaN (float nan → None)."""
        if isinstance(v, float) and v != v:  # nan != nan
            return None
        return v

    # Normalize rows to clean camelCase keys for the frontend
    preview = [
        {
            "store": _val(row.get("store") if row.get("store") is not None else row.get("Store")),
            "styleCode": _val(row.get("Style Code") if row.get("Style Code") is not None else row.get("style_code")),
            "weekDate": _val(row.get("Week_Date") if row.get("Week_Date") is not None else row.get("week_date")),
            "actualUnits": row.get("Net Shipped") if row.get("Net Shipped") is not None else 0,
            "forecastUnits": row.get("Forecast") if row.get("Forecast") is not None else 0,
        }
        for row in raw_preview
    ]

    return {
        "preview": preview,
        "featureImportance": feature_importance,
        "modelName": latest.name,
        "algorithm": latest.algorithm,
        "trainedAt": latest.trained_at,
    }


@router.get("/risk-distribution")
def risk_distribution(
    model_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    predictions = storage.get_predictions(db, model_id)
    if not predictions:
        customers = storage.get_customers(db)
        distribution = {"veryHigh": 0, "high": 0, "medium": 0, "low": 0}
        for c in customers:
            s = c.churn_risk_score or 0
            if s >= 0.8:
                distribution["veryHigh"] += 1
            elif s >= 0.6:
                distribution["high"] += 1
            elif s >= 0.3:
                distribution["medium"] += 1
            else:
                distribution["low"] += 1
        return {"distribution": distribution, "source": "customers"}

    distribution = {"veryHigh": 0, "high": 0, "medium": 0, "low": 0}
    for p in predictions:
        cat = p.get("risk_category", "")
        if cat == "very high":
            distribution["veryHigh"] += 1
        elif cat == "high":
            distribution["high"] += 1
        elif cat == "medium":
            distribution["medium"] += 1
        else:
            distribution["low"] += 1
    return {"distribution": distribution, "source": "predictions", "totalPredictions": len(predictions)}


@router.get("/customer-dataset")
def customer_dataset(db: Session = Depends(get_db)):
    customers = storage.get_customers(db)
    return [
        {
            "id": c.id, "accountNumber": c.account_number, "name": c.name,
            "region": c.region, "serviceType": c.service_type,
            "tenureMonths": c.tenure_months, "monthlyRevenue": c.monthly_revenue,
            "contractStatus": c.contract_status, "valueTier": c.value_tier,
            "churnRiskScore": c.churn_risk_score, "churnRiskCategory": c.churn_risk_category,
            "isChurned": c.is_churned, "fiberAvailable": c.fiber_available,
            "competitorAvailable": c.competitor_available,
        }
        for c in customers
    ]


@router.get("/governance")
def governance(db: Session = Depends(get_db)):
    # Include correctly-tagged models AND legacy models (use_case NULL) that have
    # demand-forecast metrics (wmape set) — churn models never have wmape.
    models = (
        db.query(MlModel)
        .filter(or_(
            MlModel.use_case == USE_CASE,
            (MlModel.use_case == None) & (MlModel.wmape != None),
        ))
        .order_by(MlModel.trained_at.desc())
        .all()
    )
    audit = storage.get_audit_log(db, 100)

    approved = [m for m in models if m.approval_status == "approved"]
    pending = [m for m in models if m.approval_status == "pending"]
    deployed = [m for m in models if m.is_deployed]

    registry = []
    for m in models:
        ds = storage.get_dataset(db, m.dataset_id) if m.dataset_id else None
        mw = m.model_weights if isinstance(m.model_weights, dict) else {}
        rows_scored = mw.get("unique_combinations") or m.row_count or 0
        tree_based = (m.algorithm or "").lower() in ("xgboost", "lightgbm")
        cc = {
            "dataLineage": m.dataset_id is not None,
            "metricsRecorded": m.wmape is not None or m.mape is not None or m.rmse is not None,
            "featureDocumented": bool(m.feature_importance) if tree_based else True,
            "hyperparamsLogged": bool(m.hyperparameters),
        }
        registry.append({
            "id": m.id, "name": m.name, "algorithm": m.algorithm,
            "datasetName": ds.name if ds else None,
            "datasetRows": ds.row_count if ds else 0,
            "wmape": round(m.wmape, 2) if m.wmape is not None else None,
            "mape": round(m.mape, 2) if m.mape is not None else None,
            "rmse": round(m.rmse, 2) if m.rmse is not None else None,
            "status": m.status,
            "isDeployed": m.is_deployed,
            "trainedAt": m.trained_at,
            "deployedAt": m.deployed_at,
            "approvalStatus": m.approval_status,
            "approvedBy": m.approved_by,
            "approvedAt": m.approved_at,
            "rowsScored": int(rows_scored) if rows_scored else 0,
            "hasFeatureImportance": bool(m.feature_importance),
            "complianceChecks": cc,
        })

    return {
        "registry": registry,
        "summary": {
            "totalModels": len(models),
            "deployed": len(deployed),
            "approved": len(approved),
            "pendingApproval": len(pending),
        },
        "auditLog": [
            {
                "id": a.id, "action": a.action, "entityType": a.entity_type,
                "entityName": a.entity_name, "detail": a.detail,
                "user": a.user, "team": a.team, "status": a.status,
                "createdAt": a.created_at,
            }
            for a in audit
        ],
    }


@router.get("/eda-live")
def eda_live(db: Session = Depends(get_db)):
    customers = storage.get_customers(db)
    if not customers:
        return {"error": "No customer data available"}

    import statistics

    churned = [c for c in customers if c.is_churned]
    n = len(customers)
    churned_n = len(churned)

    # overview
    revenues = [c.monthly_revenue for c in customers if c.monthly_revenue]
    tenures = [c.tenure_months for c in customers if c.tenure_months]
    overview = {
        "totalRows": n, "churnedRows": churned_n, "retainedRows": n - churned_n,
        "churnRate": round(churned_n / max(n, 1) * 100, 1),
        "features": 8, "numericFeatures": 5, "categoricalFeatures": 3,
    }

    # numericStats
    def _hist(values: list[float], bins: int = 12) -> list[dict]:
        if not values:
            return []
        mn, mx = min(values), max(values)
        if mn == mx:
            return [{"label": str(round(mn, 1)), "count": len(values)}]
        step = (mx - mn) / bins
        hist: dict[int, int] = {}
        for v in values:
            bucket = min(bins - 1, int((v - mn) / step))
            hist[bucket] = hist.get(bucket, 0) + 1
        return [{"label": f"{round(mn + i * step, 1)}–{round(mn + (i+1)*step, 1)}", "count": hist.get(i, 0)} for i in range(bins)]

    def _num_stat(field: str, label: str = None) -> tuple[str, dict]:
        vals = [getattr(c, field) for c in customers if getattr(c, field) is not None]
        churn_vals = [getattr(c, field) for c in churned if getattr(c, field) is not None]
        ret_vals = [getattr(c, field) for c in customers if not c.is_churned and getattr(c, field) is not None]
        null_c = n - len(vals)
        if not vals:
            return (label or field, {"mean": 0, "median": 0, "stdDev": 0, "min": 0, "max": 0, "q1": None, "q3": None, "nullCount": n, "completeness": 0, "histogram": []})
        sorted_v = sorted(vals)
        mid = len(sorted_v) // 2
        median = sorted_v[mid] if len(sorted_v) % 2 else (sorted_v[mid - 1] + sorted_v[mid]) / 2
        mean = sum(vals) / len(vals)
        std = (sum((v - mean) ** 2 for v in vals) / max(len(vals) - 1, 1)) ** 0.5
        q1 = sorted_v[len(sorted_v) // 4]
        q3 = sorted_v[3 * len(sorted_v) // 4]
        return (label or field, {
            "mean": round(mean, 2), "median": round(median, 2), "stdDev": round(std, 2),
            "min": round(min(vals), 2), "max": round(max(vals), 2),
            "q1": round(q1, 2), "q3": round(q3, 2),
            "nullCount": null_c, "completeness": round((1 - null_c / max(n, 1)) * 100, 1),
            "churnMean": round(sum(churn_vals) / max(len(churn_vals), 1), 2) if churn_vals else None,
            "retainedMean": round(sum(ret_vals) / max(len(ret_vals), 1), 2) if ret_vals else None,
            "histogram": _hist([float(v) for v in vals]),
        })

    numeric_stats = dict([
        _num_stat("monthly_revenue", "monthly_revenue"),
        _num_stat("tenure_months", "tenure_months"),
        _num_stat("outage_count", "outage_count"),
        _num_stat("ticket_count", "ticket_count"),
        _num_stat("nps_score", "nps_score"),
    ])

    # catStats
    def _cat_stat(field: str) -> tuple[str, dict]:
        counts: dict[str, dict] = {}
        for c in customers:
            val = str(getattr(c, field, None) or "Unknown")
            if val not in counts:
                counts[val] = {"count": 0, "churnCount": 0}
            counts[val]["count"] += 1
            if c.is_churned:
                counts[val]["churnCount"] += 1
        top = sorted([{"label": k, **v} for k, v in counts.items()], key=lambda x: -x["count"])[:10]
        return (field, {"nullCount": 0, "uniqueCount": len(counts), "top": top})

    cat_stats = dict([_cat_stat("region"), _cat_stat("value_tier"), _cat_stat("contract_status")])

    # bivariate
    risk_category_data = [
        {"label": k, "total": v["total"], "churned": v["churned"],
         "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1)}
        for k, v in {
            cat: {"total": sum(1 for c in customers if (c.churn_risk_category or "").lower() == cat),
                  "churned": sum(1 for c in churned if (c.churn_risk_category or "").lower() == cat)}
            for cat in ["high", "medium", "low"]
        }.items()
    ]
    value_tier_data = [
        {"label": k, "count": v["total"], "total": v["total"], "churned": v["churned"],
         "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1),
         "avgRevenue": round(v["rev"] / max(v["total"], 1), 2)}
        for k, v in sorted({
            str(c.value_tier or "Unknown"): None for c in customers
        }.keys() and {
            str(c.value_tier or "Unknown"): {
                "total": sum(1 for x in customers if str(x.value_tier or "Unknown") == str(c.value_tier or "Unknown")),
                "churned": sum(1 for x in churned if str(x.value_tier or "Unknown") == str(c.value_tier or "Unknown")),
                "rev": sum(x.monthly_revenue or 0 for x in customers if str(x.value_tier or "Unknown") == str(c.value_tier or "Unknown")),
            } for c in customers
        }.items(), key=lambda x: -x[1]["total"])
    ]

    # multivariate
    multivariate: list[dict] = []
    seen_mv: set = set()
    for c in customers:
        tier = str(c.value_tier or "Unknown")
        contract = str(c.contract_status or "Unknown")
        key = (tier, contract)
        if key in seen_mv:
            continue
        seen_mv.add(key)
        grp = [x for x in customers if str(x.value_tier or "Unknown") == tier and str(x.contract_status or "Unknown") == contract]
        ch = sum(1 for x in grp if x.is_churned)
        avg_rev = round(sum(x.monthly_revenue or 0 for x in grp) / max(len(grp), 1), 2)
        multivariate.append({"valueTier": tier, "contractStatus": contract, "total": len(grp),
                              "churned": ch, "churnRate": round(ch / max(len(grp), 1) * 100, 1), "avgRevenue": avg_rev})
    multivariate = sorted(multivariate, key=lambda x: -x["total"])[:20]

    # timeTrends
    time_trends: list[dict] = []
    for label, lo, hi in [("0-6 mo", 0, 6), ("6-12 mo", 6, 12), ("12-24 mo", 12, 24), ("24-48 mo", 24, 48), ("48+ mo", 48, 9999)]:
        grp = [c for c in customers if lo <= (c.tenure_months or 0) < hi]
        ch = sum(1 for c in grp if c.is_churned)
        avg_rev = round(sum(c.monthly_revenue or 0 for c in grp) / max(len(grp), 1), 2)
        time_trends.append({"bucket": label, "total": len(grp), "churned": ch,
                             "churnRate": round(ch / max(len(grp), 1) * 100, 1), "avgRevenue": avg_rev})

    # correlationMatrix
    fields = [("tenure_months", lambda c: c.tenure_months), ("monthly_revenue", lambda c: c.monthly_revenue),
              ("outage_count", lambda c: c.outage_count), ("ticket_count", lambda c: c.ticket_count)]
    correlation_matrix: list[dict] = []
    for i, (n1, f1) in enumerate(fields):
        for n2, f2 in fields[i + 1:]:
            vals1 = [f1(c) for c in customers if f1(c) is not None and f2(c) is not None]
            vals2 = [f2(c) for c in customers if f1(c) is not None and f2(c) is not None]
            if len(vals1) < 5:
                continue
            mean1, mean2 = sum(vals1) / len(vals1), sum(vals2) / len(vals2)
            num = sum((a - mean1) * (b - mean2) for a, b in zip(vals1, vals2))
            d1 = sum((a - mean1) ** 2 for a in vals1) ** 0.5
            d2 = sum((b - mean2) ** 2 for b in vals2) ** 0.5
            corr = num / (d1 * d2) if d1 * d2 > 0 else 0
            correlation_matrix.append({"col1": n1, "col2": n2, "corr": round(corr, 3)})
    correlation_matrix.sort(key=lambda x: -abs(x["corr"]))

    # dataRisks
    data_risks = {
        "classImbalance": round(churned_n / max(n, 1) * 100, 1),
        "duplicates": 0,
        "nullRisks": [
            {"column": "nps_score", "nullCount": sum(1 for c in customers if c.nps_score is None),
             "nullPercent": round(sum(1 for c in customers if c.nps_score is None) / max(n, 1) * 100, 1)},
        ],
        "outliers": [],
        "lowVariance": [],
    }

    return {
        "overview": overview, "numericStats": numeric_stats, "catStats": cat_stats,
        "bivariate": {"riskCategory": risk_category_data, "valueTier": value_tier_data},
        "multivariate": multivariate, "timeTrends": time_trends,
        "correlationMatrix": correlation_matrix,
        "dataRisks": data_risks,
        "correlations": [{"feature1": c["col1"], "feature2": c["col2"], "correlation": c["corr"]} for c in correlation_matrix],
        "distributions": [],
    }


def _group_churn(customers, field: str) -> list[dict]:
    groups: dict[str, dict] = {}
    for c in customers:
        key = str(getattr(c, field, None) or "Unknown")
        if key not in groups:
            groups[key] = {"total": 0, "churned": 0}
        groups[key]["total"] += 1
        if c.is_churned:
            groups[key]["churned"] += 1
    return [
        {"name": k, "total": v["total"], "churned": v["churned"],
         "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1)}
        for k, v in sorted(groups.items(), key=lambda x: -x[1]["total"])
    ]


# /api/orion/algorithms is handled by routers/code.py (reads from train_model.py)
