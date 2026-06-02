"""KPI-anomaly model management endpoints."""
from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage
from schemas import ApproveRequest

router = APIRouter(prefix="/models", tags=["kpi-anomaly-models"])


def _kpi_models(db: Session):
    """Return only KPI Anomaly models, ignoring all other use cases."""
    all_models = storage.get_ml_models(db)
    return [m for m in all_models if isinstance(m.model_weights, dict) and m.model_weights.get("modelType") == "kpi_anomaly"]


@router.get("")
def list_models(db: Session = Depends(get_db)):
    return _kpi_models(db)


@router.get("/latest/features")
def latest_features(dataset_id: int | None = Query(None), db: Session = Depends(get_db)):
    models = _kpi_models(db)
    if dataset_id:
        models = [m for m in models if m.dataset_id == dataset_id]
    if not models:
        return {"features": [], "algorithm": None, "modelId": None}
    model = models[0]
    fi    = model.feature_importance or []
    return {"features": fi, "algorithm": model.algorithm, "modelId": model.id}


@router.get("/{model_id}")
def get_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.post("/{model_id}/deploy")
def deploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    for m in _kpi_models(db):
        if m.is_deployed:
            storage.update_ml_model(db, m.id, {"is_deployed": False, "deployed_at": None})
    updated = storage.update_ml_model(db, model_id, {
        "is_deployed": True,
        "deployed_at": datetime.now(timezone.utc),
        "status": "deployed",
    })
    return updated


@router.post("/{model_id}/undeploy")
def undeploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {
        "is_deployed": False, "deployed_at": None, "status": "trained"
    })
    return updated


@router.post("/{model_id}/approve")
def approve_model(model_id: int, body: ApproveRequest, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {
        "approval_status": "approved",
        "approved_by":     body.approved_by,
        "approved_at":     datetime.now(timezone.utc),
        "approval_notes":  body.notes,
    })
    return updated


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    storage.delete_ml_model(db, model_id)
    return {"ok": True}
