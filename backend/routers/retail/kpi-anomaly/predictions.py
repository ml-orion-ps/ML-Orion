"""KPI-anomaly predictions endpoints."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="", tags=["kpi-anomaly-predictions"])


def _kpi_models(db: Session):
    all_models = storage.get_ml_models(db)
    return [m for m in all_models if isinstance(m.model_weights, dict) and m.model_weights.get("modelType") == "kpi_anomaly"]


@router.get("/predictions")
def get_predictions(model_id: int | None = Query(None), db: Session = Depends(get_db)):
    return storage.get_predictions(db, model_id)


@router.get("/anomalies")
def get_anomalies(
    model_id:   int | None = Query(None),
    dataset_id: int | None = Query(None),
    kpi:        str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return anomaly rows stored in model_weights.preview of the most recent run."""
    resolved_model = None

    if model_id:
        resolved_model = storage.get_ml_model(db, model_id)
    elif dataset_id:
        models         = _kpi_models(db)
        resolved_model = next((m for m in models if m.dataset_id == dataset_id), None)
    else:
        models         = _kpi_models(db)
        resolved_model = models[0] if models else None

    if not resolved_model:
        return {"anomalies": [], "total": 0}

    weights  = resolved_model.model_weights or {}
    if not isinstance(weights, dict):
        weights = {}

    preview  = weights.get("preview") or []
    if kpi:
        preview = [r for r in preview if r.get("kpi") == kpi]

    return {
        "modelId":   resolved_model.id,
        "modelName": resolved_model.name,
        "anomalies": preview,
        "total":     len(preview),
    }


@router.get("/recommendations")
def get_recommendations(customer_id: int | None = Query(None), db: Session = Depends(get_db)):
    return storage.get_recommendations(db, customer_id)
