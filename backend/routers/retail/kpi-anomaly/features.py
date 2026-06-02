"""KPI-anomaly custom feature CRUD + preview endpoints."""
from __future__ import annotations
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import storage
from services.custom_features import (
    get_dataset_rows,
    get_dataset_custom_features,
    validate_custom_feature,
    build_custom_feature_formula,
    build_preview_rows,
)

router = APIRouter(prefix="/features", tags=["kpi-anomaly-features"])


def _get_ds_or_404(db: Session, dataset_id: int):
    ds = storage.get_dataset(db, dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return ds


def _persist_features(db: Session, dataset_id: int, features: list[dict]) -> None:
    ds = storage.get_dataset(db, dataset_id)
    fr = ds.feature_report if isinstance(ds.feature_report, dict) else {}
    fr["customFeatures"] = features
    storage.update_dataset(db, dataset_id, {"feature_report": fr})


@router.get("")
def list_features(datasetId: int, db: Session = Depends(get_db)):
    ds = _get_ds_or_404(db, datasetId)
    return get_dataset_custom_features(ds)


@router.post("/preview")
def preview_feature(body: dict, db: Session = Depends(get_db)):
    dataset_id = body.get("datasetId")
    feature    = body.get("feature") or {}
    if not dataset_id:
        raise HTTPException(status_code=400, detail="datasetId required")

    ds        = _get_ds_or_404(db, dataset_id)
    col_names = [c["name"] for c in (ds.columns or [])]
    validation = validate_custom_feature(feature, col_names)

    rows = get_dataset_rows(ds)[:50]
    if not rows:
        return {"rows": [], "warnings": validation["warnings"], "formula": validation["formula"]}

    preview = build_preview_rows(rows, [feature])
    return {
        "rows":     preview[:20],
        "warnings": validation["warnings"],
        "formula":  validation["formula"],
    }


@router.post("")
def save_feature(body: dict, db: Session = Depends(get_db)):
    dataset_id = body.get("datasetId")
    feature    = dict(body.get("feature") or {})
    if not dataset_id:
        raise HTTPException(status_code=400, detail="datasetId required")

    ds        = _get_ds_or_404(db, dataset_id)
    col_names = [c["name"] for c in (ds.columns or [])]
    validation = validate_custom_feature(feature, col_names)
    if not validation["valid"]:
        raise HTTPException(status_code=400, detail="; ".join(validation["errors"]))

    feature["formula"] = build_custom_feature_formula(feature)
    feature["status"]  = "active"

    existing = get_dataset_custom_features(ds)

    if feature.get("id"):
        updated = [feature if f.get("id") == feature["id"] else f for f in existing]
        if not any(f.get("id") == feature["id"] for f in existing):
            updated = existing + [feature]
    else:
        feature["id"] = str(uuid.uuid4())
        updated = existing + [feature]

    _persist_features(db, dataset_id, updated)
    return feature


@router.delete("/{feature_id}")
def delete_feature(feature_id: str, datasetId: int, db: Session = Depends(get_db)):
    ds = _get_ds_or_404(db, datasetId)
    existing = get_dataset_custom_features(ds)
    updated  = [f for f in existing if f.get("id") != feature_id]
    _persist_features(db, datasetId, updated)
    return {"ok": True}
