from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage
from schemas import MlModelOut, TrainRequest, TrainLiveRequest, ApproveRequest
from services.ml_service import (
    run_train_model,
    run_baseline_prediction,
    run_calculate_shap,
    normalize_algorithm_for_python,
)
from services.custom_features import (
    get_dataset_rows,
    get_dataset_custom_features,
)

router = APIRouter(prefix="/models", tags=["baseline_modelling"])

USE_CASE = "cpg_baseline_modelling"

ALGORITHM_MAP = {
    "Gradient Boosting": "XGBoost",
    "Neural Network": "Random Forest",
    "SVM": "Random Forest",
}

SUPPORTED_ALGORITHMS = {
    "Auto", "Random Forest", "LightGBM", "XGBoost",
    "Decision Tree", "Support Vector Machine", "Gradient Boosting",
    "Neural Network", "SVM",
}


def _risk_category(prob: float) -> str:
    """Thresholds match the original ML-Orion classifyRiskCategoryFromProbability."""
    if prob > 0.85:
        return "very high"
    if prob >= 0.70:
        return "high"
    if prob >= 0.50:
        return "medium"
    return "low"


def _recommended_action(prob: float) -> tuple[str, str]:
    if prob > 0.85:
        return "Immediate retention offer — high-value priority", "urgent"
    if prob >= 0.70:
        return "Proactive outreach with loyalty incentive", "proactive"
    if prob >= 0.50:
        return "Monitor and schedule check-in", "monitor"
    return "Standard engagement", "standard"


def _estimate_impact(monthly_revenue: float, risk: str) -> float:
    months = {"very high": 12, "high": 8, "medium": 4, "low": 1}.get(risk, 4)
    return round(monthly_revenue * months, 2)


def _estimate_cost(risk: str) -> float:
    return {"very high": 180.0, "high": 120.0, "medium": 60.0, "low": 15.0}.get(risk, 60.0)


def _generate_predictions_for_model(
    db: Session,
    model,
    precomputed: list[dict] | None = None,
    prod_dataset_id: int | None = None,
) -> dict:
    storage.clear_predictions_by_model(db, model.id)

    target_dataset_id = prod_dataset_id or model.dataset_id
    ds = storage.get_dataset(db, target_dataset_id) if target_dataset_id else None

    customers = storage.get_customers(db)
    if not customers:
        return {"predicted": 0, "veryHigh": 0, "high": 0, "medium": 0, "low": 0}

    feature_importance = model.feature_importance or []
    top_drivers = sorted(feature_importance, key=lambda x: abs(x.get("importance", 0)), reverse=True)[:5] if feature_importance else []

    if precomputed:
        cust_map = {c.account_number: c for c in customers}
        preds_to_create = []
        recs_to_create = []
        summary = {"predicted": 0, "veryHigh": 0, "high": 0, "medium": 0, "low": 0}

        for p in precomputed:
            acc = p.get("accountNumber") or p.get("account_number")
            prob = float(p.get("churnProbability", p.get("churn_probability", 0.5)))
            c = cust_map.get(acc)
            if not c:
                continue
            cat = _risk_category(prob)
            action, action_cat = _recommended_action(prob)
            preds_to_create.append({
                "model_id": model.id, "customer_id": c.id,
                "churn_probability": prob, "risk_category": cat,
                "top_drivers": top_drivers, "recommended_action": action, "action_category": action_cat,
            })
            if prob >= 0.50:
                action_type = "Retention Offer" if cat == "very high" else ("Proactive Call" if cat == "high" else "Loyalty Plan")
                recs_to_create.append({
                    "customer_id": c.id, "action_type": action_type,
                    "priority": cat, "status": "pending",
                    "estimated_impact": _estimate_impact(c.monthly_revenue or 0, cat),
                    "estimated_cost": _estimate_cost(cat),
                })
            summary["predicted"] += 1
            if cat == "very high":
                summary["veryHigh"] += 1
            elif cat == "high":
                summary["high"] += 1
            elif cat == "medium":
                summary["medium"] += 1
            else:
                summary["low"] += 1

        storage.bulk_create_predictions(db, preds_to_create)
        if recs_to_create:
            storage.bulk_create_recommendations(db, recs_to_create)
        return summary

    # Fallback: use churn risk score from customer table
    preds_to_create = []
    recs_to_create = []
    summary = {"predicted": 0, "veryHigh": 0, "high": 0, "medium": 0, "low": 0}

    for c in customers:
        prob = float(c.churn_risk_score or 0.5)
        cat = _risk_category(prob)
        action, action_cat = _recommended_action(prob)
        preds_to_create.append({
            "model_id": model.id, "customer_id": c.id,
            "churn_probability": prob, "risk_category": cat,
            "top_drivers": top_drivers, "recommended_action": action, "action_category": action_cat,
        })
        if prob >= 0.50:
            action_type = "Retention Offer" if cat == "very high" else ("Proactive Call" if cat == "high" else "Loyalty Plan")
            recs_to_create.append({
                "customer_id": c.id, "action_type": action_type,
                "priority": cat, "status": "pending",
                "estimated_impact": _estimate_impact(c.monthly_revenue or 0, cat),
                "estimated_cost": _estimate_cost(cat),
            })
        summary["predicted"] += 1
        if cat == "very high":
            summary["veryHigh"] += 1
        elif cat == "high":
            summary["high"] += 1
        elif cat == "medium":
            summary["medium"] += 1
        else:
            summary["low"] += 1

    storage.bulk_create_predictions(db, preds_to_create)
    if recs_to_create:
        storage.bulk_create_recommendations(db, recs_to_create)
    return summary


@router.get("")
def list_models(db: Session = Depends(get_db)):
    return storage.get_ml_models(db, use_case=USE_CASE)



@router.get("/latest/features")
def latest_features(
    dataset_id: int | None = Query(None,alias = "datasetId"),
    db: Session = Depends(get_db)
):
    models = storage.get_ml_models(db, use_case=USE_CASE)

    if dataset_id:
        models = [m for m in models if m.dataset_id == dataset_id]
    if not models:
        return {
            "features": [],
            "algorithm": None,
            "modelId": None
        }
    # Prefer deployed model first
    deployed_models = [m for m in models if m.is_deployed]

    if deployed_models:
        model = sorted(
            deployed_models,
            key=lambda x: x.trained_at,
            reverse=True
        )[0]
    else:
        model = sorted(
            models,
            key=lambda x: x.trained_at,
            reverse=True
        )[0]
    return {
        "features": model.feature_importance or [],
        "algorithm": model.algorithm,
        "modelId": model.id
    }

@router.get("/{model_id}", response_model=MlModelOut)
def get_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.post("/train")
def train_model(body: TrainRequest, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    source_rows = get_dataset_rows(ds)
    if not source_rows:
        raise HTTPException(status_code=400, detail="Dataset has no data")

    # Map UI algorithm name to baseline_prediction.py model keys
    _algo_map = {
        "Ridge": ["Ridge"], "Random Forest": ["RF"],
        "Gradient Boosting": ["XGB"], "XGBoost": ["XGB"],
        "LightGBM": ["XGB"], "Neural Network": ["RF"], "SVM": ["Ridge"],
        "Decision Tree": ["RF"],
    }
    models_to_run = None
    if body.algorithm and body.algorithm not in ("Auto", ""):
        models_to_run = _algo_map.get(body.algorithm)

    result = run_baseline_prediction(data=source_rows, models_to_run=models_to_run)

    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Training failed"))

    summary = result.get("summary", {})
    metrics = summary.get("metrics", {})
    totals = summary.get("totals", {})
    best_model = summary.get("bestModel", body.algorithm or "Ridge")
    best_params = summary.get("bestParams", {})
    row_count = summary.get("rowCount", len(source_rows))

    model_name = body.name or f"{best_model} Baseline - {datetime.now(timezone.utc).date()}"
    display_algo = f"Auto ({best_model})" if not body.algorithm or body.algorithm == "Auto" else body.algorithm

    model = storage.create_ml_model(db, {
        "name": model_name,
        "dataset_id": body.dataset_id,
        "algorithm": display_algo,
        "use_case": USE_CASE,
        "status": "trained",
        "r2": metrics.get("r2"),
        "wmape": metrics.get("test_wmape"),
        "mae": metrics.get("mae"),
        "rmse": metrics.get("rmse"),
        "baseline_units": totals.get("baselineWithoutPromoUnits") or totals.get("base0Units"),
        "promo_effect_units": totals.get("promoEffectUnits"),
        "residual_units": totals.get("residualUnits"),
        "row_count": row_count,
        "hyperparameters": best_params,
        "feature_importance": result.get("featureImportance", []),
        "confusion_matrix": None,
        "model_weights": {
            "promoColumnsUsed": summary.get("promoColumnsUsed", []),
            "totals": totals,
            "predictions": result.get("predictions", []),
        },
        "is_deployed": False,
        "deployed_at": None,
    })

    storage.create_audit_log(db, {
        "action": "train", "entity_type": "model", "entity_id": model.id,
        "entity_name": model.name,
        "detail": f"Trained on {row_count} rows — R² {round(metrics.get('r2') or 0, 3)}, WMAPE {round(metrics.get('test_wmape') or 0, 3)}, best model: {best_model}",
        "user": "ml-ops-user", "team": "ML Ops", "status": "success",
    })

    result_dict = {c.name: getattr(model, c.name) for c in model.__table__.columns}
    result_dict["predictionsGenerated"] = row_count
    return result_dict


@router.post("/train-live")
def train_live(body: TrainLiveRequest, db: Session = Depends(get_db)):
    customers = storage.get_customers(db)
    churned = [c for c in customers if c.is_churned]
    if not customers:
        raise HTTPException(status_code=400, detail="No customers found")
    if len(churned) < 10:
        raise HTTPException(status_code=400, detail=f"Need at least 10 churned customers, found {len(churned)}")

    training_rows = [
        {
            "accountNumber": c.account_number,
            "tenureMonths": c.tenure_months,
            "monthlyRevenue": c.monthly_revenue,
            "outageCount": c.outage_count or 0,
            "ticketCount": c.ticket_count or 0,
            "npsScore": c.nps_score or 0,
            "fiberAvailable": 1 if c.fiber_available else 0,
            "competitorAvailable": 1 if c.competitor_available else 0,
            "isChurned": 1 if c.is_churned else 0,
        }
        for c in customers
    ]

    python_algorithm = ALGORITHM_MAP.get(body.algorithm, body.algorithm)
    result = run_train_model(
        data=training_rows,
        target_column="isChurned",
        algorithm=python_algorithm,
        hyperparameters=body.hyperparameters,
    )

    metrics = result.get("metrics")
    if not metrics:
        raise HTTPException(status_code=500, detail="Training returned no metrics")

    ds = storage.create_dataset(db, {
        "name": f"Live Training Data - {datetime.now(timezone.utc).date()}",
        "file_name": "live_data.json",
        "row_count": len(training_rows),
        "column_count": 9,
        "columns": [],
        "status": "uploaded",
        "data_preview": None,
    })

    model = storage.create_ml_model(db, {
        "name": body.name or f"{body.algorithm} (Live) - {datetime.now(timezone.utc).date()}",
        "dataset_id": ds.id,
        "algorithm": body.algorithm,
        "use_case": USE_CASE,
        "status": "trained",
        "accuracy": metrics.get("accuracy"),
        "precision": metrics.get("precision"),
        "recall": metrics.get("recall"),
        "f1_score": metrics.get("f1Score"),
        "auc": metrics.get("auc"),
        "hyperparameters": metrics.get("bestParams") or body.hyperparameters or {},
        "feature_importance": metrics.get("featureImportance") or [],
        "confusion_matrix": metrics.get("confusionMatrix") or {"tp": 0, "fp": 0, "tn": 0, "fn": 0},
        "model_weights": {},
        "is_deployed": False,
        "deployed_at": None,
    })

    precomputed = result.get("latestActivePredictions") or []
    summary = _generate_predictions_for_model(db, model, precomputed if precomputed else None)

    result_dict = {c.name: getattr(model, c.name) for c in model.__table__.columns}
    result_dict["predictionsGenerated"] = summary["predicted"]
    return result_dict


@router.post("/{model_id}/deploy")
def deploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    all_models = storage.get_ml_models(db, use_case=USE_CASE)
    for m in all_models:
        if m.is_deployed:
            storage.update_ml_model(db, m.id, {"is_deployed": False, "deployed_at": None})
    updated = storage.update_ml_model(db, model_id, {"is_deployed": True, "deployed_at": datetime.now(timezone.utc), "status": "deployed"})
    return updated


@router.post("/{model_id}/undeploy")
def undeploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {"is_deployed": False, "deployed_at": None, "status": "trained"})
    return updated


@router.post("/{model_id}/approve")
def approve_model(model_id: int, body: ApproveRequest, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {
        "approval_status": "approved",
        "approved_by": body.approved_by,
        "approved_at": datetime.now(timezone.utc),
        "approval_notes": body.notes,
    })
    return updated


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    storage.delete_ml_model(db, model_id)
    return {"ok": True}


@router.post("/{model_id}/predict-customers")
def predict_customers(model_id: int, body: dict = {}, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    prod_dataset_id = body.get("prodDatasetId")
    target_dataset_id = int(prod_dataset_id) if prod_dataset_id else model.dataset_id
    ds = storage.get_dataset(db, target_dataset_id) if target_dataset_id else None
    if not ds:
        raise HTTPException(status_code=400, detail="Dataset not found")

    rows = get_dataset_rows(ds)
    if not rows:
        raise HTTPException(status_code=400, detail="Dataset has no data")

    result = run_baseline_prediction(data=rows)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Scoring failed"))

    summary_data = result.get("summary", {})
    metrics = summary_data.get("metrics", {})
    totals = summary_data.get("totals", {})
    row_count = summary_data.get("rowCount", len(rows))
    r2 = metrics.get("r2")
    wmape = metrics.get("test_wmape")
    mae = metrics.get("mae")
    rmse = metrics.get("rmse")
    prediction_rows = result.get("predictions", [])

    existing_weights = model.model_weights or {}
    update_data: dict = {
        "row_count": row_count,
        "model_weights": {
            **existing_weights,
            "predictions": prediction_rows,
            "predictionTotals": totals,
            "predictionMetrics": metrics,
            "promoColumnsUsed": summary_data.get("promoColumnsUsed", existing_weights.get("promoColumnsUsed", [])),
        },
    }

    if not prod_dataset_id:
        update_data.update({
            "r2": r2, "wmape": wmape, "mae": mae, "rmse": rmse,
            "baseline_units": totals.get("baselineWithoutPromoUnits"),
            "promo_effect_units": totals.get("promoEffectUnits"),
            "residual_units": totals.get("residualUnits"),
        })

    storage.update_ml_model(db, model.id, update_data)

    storage.create_audit_log(db, {
        "action": "score", "entity_type": "model", "entity_id": model.id,
        "entity_name": model.name,
        "detail": f"Scored {row_count} rows — R² {round(r2 or 0, 3)}, WMAPE {round(wmape or 0, 3)}",
        "user": "ml-ops-user", "team": "ML Ops", "status": "success",
    })
    return {
        "modelId": model.id,
        "predicted": row_count,
        "r2": r2, "wmape": wmape, "mae": mae, "rmse": rmse,
    }


@router.post("/{model_id}/score-production")
def score_production(model_id: int, body: dict, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    prod_dataset_id = body.get("prodDatasetId")
    if not prod_dataset_id:
        raise HTTPException(status_code=400, detail="prodDatasetId is required")

    prod_ds = storage.get_dataset(db, int(prod_dataset_id))
    if not prod_ds:
        raise HTTPException(status_code=404, detail="Production dataset not found")

    prod_rows = get_dataset_rows(prod_ds)
    if not prod_rows:
        raise HTTPException(status_code=400, detail="Production dataset has no data")

    result = run_baseline_prediction(data=prod_rows)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Production scoring failed"))

    summary_data = result.get("summary", {})
    metrics = summary_data.get("metrics", {})
    totals = summary_data.get("totals", {})
    row_count = summary_data.get("rowCount", len(prod_rows))
    r2 = metrics.get("r2")
    wmape = metrics.get("test_wmape")
    mae = metrics.get("mae")
    rmse = metrics.get("rmse")
    prediction_rows = result.get("predictions", [])

    existing_weights = model.model_weights or {}
    storage.update_ml_model(db, model.id, {
        "model_weights": {
            **existing_weights,
            "prodPredictions": prediction_rows,
            "prodTotals": totals,
            "prodMetrics": metrics,
            "prodRowCount": row_count,
            "prodDatasetId": int(prod_dataset_id),
            "prodDatasetName": prod_ds.name,
        },
    })

    storage.create_audit_log(db, {
        "action": "score_production", "entity_type": "model", "entity_id": model.id,
        "entity_name": model.name,
        "detail": f"Production scoring on {prod_ds.name}: {row_count} rows — R² {round(r2 or 0, 3)}, WMAPE {round(wmape or 0, 3)}",
        "user": "ml-ops-user", "team": "ML Ops", "status": "success",
    })

    return {
        "modelId": model.id,
        "predicted": row_count,
        "metrics": {"r2": r2, "wmape": wmape, "mae": mae, "rmse": rmse},
        "totals": totals,
    }
