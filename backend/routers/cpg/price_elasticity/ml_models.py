from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/models", tags=["cpg_price_elasticity"])

USE_CASE = "cpg_price_elasticity"


def _model_to_dict(m) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "dataset_id": m.dataset_id,
        "algorithm": m.algorithm,
        "status": m.status,
        "is_deployed": bool(m.is_deployed) if m.is_deployed is not None else False,
        "deployed_at": m.deployed_at.isoformat() if getattr(m, "deployed_at", None) else None,
        "trained_at": m.trained_at.isoformat() if m.trained_at else None,
        "use_case": m.use_case,
        "model_weights": m.model_weights,
        "row_count": m.row_count,
        "r2": m.r2,
        "mae": m.mae,
        "rmse": m.rmse,
        "accuracy": m.accuracy,
        "hyperparameters": m.hyperparameters,
        "feature_importance": m.feature_importance,
    }


@router.get("")
def list_models(db: Session = Depends(get_db)):
    return [_model_to_dict(m) for m in storage.get_ml_models(db, use_case=USE_CASE)]


@router.get("/latest/features")
def latest_features(
    dataset_id: int | None = Query(None, alias="datasetId"),
    model_id: int | None = Query(None, alias="modelId"),
    db: Session = Depends(get_db),
):
    # If a specific model is requested, use it directly
    if model_id:
        model = storage.get_ml_model(db, model_id)
        if not model or model.use_case != USE_CASE:
            return {"features": [], "algorithm": None, "modelId": None}
        return {
            "features": model.feature_importance or [],
            "algorithm": model.algorithm,
            "modelId": model.id,
        }

    models = storage.get_ml_models(db, use_case=USE_CASE)

    if dataset_id:
        models = [m for m in models if m.dataset_id == dataset_id]
    if not models:
        return {
            "features": [],
            "algorithm": None,
            "modelId": None,
        }

    # Prefer deployed model first
    deployed_models = [m for m in models if m.is_deployed]

    if deployed_models:
        model = sorted(
            deployed_models,
            key=lambda x: x.trained_at,
            reverse=True,
        )[0]
    else:
        model = sorted(
            models,
            key=lambda x: x.trained_at,
            reverse=True,
        )[0]

    return {
        "features": model.feature_importance or [],
        "algorithm": model.algorithm,
        "modelId": model.id,
    }


@router.get("/{model_id}")
def get_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return _model_to_dict(model)

@router.post("/{model_id}/deploy")
def deploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    all_models = storage.get_ml_models(db, use_case=USE_CASE)
    for m in all_models:
        if m.is_deployed:
            storage.update_ml_model(db, m.id, {"is_deployed": False, "deployed_at": None})
    updated = storage.update_ml_model(db, model_id, {
        "is_deployed": True,
        "deployed_at": datetime.now(timezone.utc),
        "status": "deployed",
    })
    return _model_to_dict(updated)


@router.post("/{model_id}/undeploy")
def undeploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {
        "is_deployed": False,
        "deployed_at": None,
        "status": "trained",
    })
    return _model_to_dict(updated)


@router.post("/{model_id}/score-production")
def score_production(model_id: int, body: dict, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    prod_dataset_id = body.get("prodDatasetId")
    weights = model.model_weights or {}
    return {
        "modelId": model_id,
        "prodDatasetId": prod_dataset_id,
        "rowsProcessed": model.row_count or 0,
        "metrics": {
            "globalPriceElasticity": weights.get("globalPriceElasticity"),
            "modelConverged": weights.get("modelConverged"),
        },
    }


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    storage.delete_ml_model(db, model_id)
    return {"ok": True}
