"""
KPI-anomaly Code Explorer — lets the UI read the Python backend source files.
Mirrors the structure of promo-uplift/code.py.
"""
from __future__ import annotations
import re
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="", tags=["kpi-anomaly-code"])

_ROOT        = Path(__file__).parent.parent.parent.parent.parent
_KPI_ML_DIR  = _ROOT / "ML_backend" / "python-ml" / "retail" / "kpi-anomaly"
_BACKEND     = _ROOT / "backend"

CODE_FILE_MAP: dict[str, dict] = {
    "kpi_anomaly": {
        "path":        _KPI_ML_DIR / "kpi_anomaly.py",
        "label":       "KPI Anomaly Engine",
        "description": "Isolation Forest + SHAP anomaly detection engine for KPI time series",
    },
    "storage": {
        "path":        _BACKEND / "storage.py",
        "label":       "Storage Layer",
        "description": "Data access layer — all CRUD and analytics operations (FastAPI/SQLAlchemy)",
    },
    "ml_service": {
        "path":        _BACKEND / "services" / "ml_service.py",
        "label":       "ML Service",
        "description": "Calls Python ML modules — bridges FastAPI routes to ML logic",
    },
    "models": {
        "path":        _BACKEND / "models.py",
        "label":       "ORM Models",
        "description": "SQLAlchemy ORM models — mirrors the PostgreSQL database schema",
    },
    "schema": {
        "path":        _BACKEND / "schemas.py",
        "label":       "Data Schema",
        "description": "Pydantic request/response schemas and type definitions",
    },
}


@router.get("/code/files")
def list_code_files():
    return [
        {"id": k, "label": v["label"], "description": v["description"]}
        for k, v in CODE_FILE_MAP.items()
    ]


@router.get("/code/{file_id}")
def get_code_file(file_id: str):
    meta = CODE_FILE_MAP.get(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail="File not in allowlist")
    path: Path = meta["path"]
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {path.name}")
    content = path.read_text(encoding="utf-8")
    stat    = path.stat()
    return {
        "id":           file_id,
        "label":        meta["label"],
        "description":  meta["description"],
        "content":      content,
        "lines":        content.count("\n") + 1,
        "lastModified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
    }


@router.put("/code/{file_id}")
def update_code_file(file_id: str, body: dict, db: Session = Depends(get_db)):
    meta = CODE_FILE_MAP.get(file_id)
    if not meta:
        raise HTTPException(status_code=404, detail="File not in allowlist")
    content = body.get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=400, detail="Content is required")
    path: Path = meta["path"]
    path.write_text(content, encoding="utf-8")
    storage.create_audit_log(db, {
        "action":      "update",
        "entity_type": "code",
        "entity_id":   0,
        "entity_name": meta["label"],
        "detail":      f"Backend file {meta['label']} modified via Code Explorer",
        "user":        "ml-ops-user",
        "team":        "ML Ops",
        "status":      "success",
    })
    return {"success": True, "lines": content.count("\n") + 1, "savedAt": datetime.utcnow().isoformat()}


@router.get("/orion/algorithms")
def list_algorithms():
    """Return supported anomaly detection algorithms."""
    return [
        {"value": "Isolation Forest", "label": "Isolation Forest",
         "desc": "Unsupervised tree-based anomaly detection with SHAP explanations"},
    ]
