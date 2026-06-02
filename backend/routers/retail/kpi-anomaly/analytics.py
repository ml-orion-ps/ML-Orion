"""KPI-anomaly analytics endpoints."""
from __future__ import annotations
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="", tags=["kpi-anomaly-analytics"])


def _kpi_models(db: Session):
    all_models = storage.get_ml_models(db)
    return [m for m in all_models if isinstance(m.model_weights, dict) and m.model_weights.get("modelType") == "kpi_anomaly"]


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    return storage.get_churn_analytics(db)


@router.get("/segments")
def segments(db: Session = Depends(get_db)):
    return storage.get_segment_analytics(db)


@router.get("/analytics/command-center")
def command_center(db: Session = Depends(get_db)):
    return storage.get_command_center_data(db)


@router.get("/analytics/kpi-summary")
def kpi_summary(
    dataset_id: int | None = Query(None),
    model_id:   int | None = Query(None),
    db: Session = Depends(get_db),
):
    """Return a per-KPI anomaly summary from the most recent detection run."""
    resolved_model = None

    if model_id:
        resolved_model = storage.get_ml_model(db, model_id)
    elif dataset_id:
        models = _kpi_models(db)
        resolved_model = next(
            (m for m in models if m.dataset_id == dataset_id), None
        )
    else:
        models = _kpi_models(db)
        resolved_model = models[0] if models else None

    if not resolved_model:
        return {"kpiStats": {}, "summary": {}}

    weights = resolved_model.model_weights or {}
    if not isinstance(weights, dict):
        weights = {}

    summary   = weights.get("summary", {}) if isinstance(weights, dict) else {}
    kpi_stats = summary.get("kpiStats", {}) if isinstance(summary, dict) else {}

    return {
        "modelId":   resolved_model.id,
        "modelName": resolved_model.name,
        "kpiStats":  kpi_stats,
        "summary":   summary,
    }


@router.get("/analytics/risk-intelligence")
def risk_intelligence(db: Session = Depends(get_db)):
    return storage.get_risk_intelligence(db)


@router.get("/analytics/business-impact")
def business_impact(db: Session = Depends(get_db)):
    return storage.get_business_impact(db)


@router.get("/analytics/strategy")
def strategy(db: Session = Depends(get_db)):
    return storage.get_strategy_insights(db)
