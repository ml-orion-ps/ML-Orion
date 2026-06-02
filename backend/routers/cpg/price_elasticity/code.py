"""
Code Explorer — lets the UI read and edit the Python price elasticity ML source files.
"""
from __future__ import annotations
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from fastapi import Depends
import storage

router = APIRouter(tags=["cpg_price_elasticity_code"])

_ROOT = Path(__file__).resolve().parents[4]
_ML_SCRIPTS = _ROOT / "ML_backend" / "python-ml" / "cpg" / "price_elasticity"
_BACKEND = _ROOT / "backend"

CODE_FILE_MAP: dict[str, dict] = {
    "elasticity_model": {
        "path": _ML_SCRIPTS / "elasticity_model.py",
        "label": "Elasticity Model",
        "description": "Mixed Linear Model (statsmodels) — dynamic formula building and fitting",
    },
    "preprocessing": {
        "path": _ML_SCRIPTS / "preprocessing.py",
        "label": "Preprocessing",
        "description": "Data cleaning, log-transforms, and feature engineering for price elasticity",
    },
    "aggregation": {
        "path": _ML_SCRIPTS / "aggregation.py",
        "label": "Aggregation",
        "description": "Weighted elasticity aggregation by SKU, brand, category, region, channel, store",
    },
    "pipeline": {
        "path": _ML_SCRIPTS / "pipeline.py",
        "label": "Pipeline",
        "description": "End-to-end pipeline orchestration: load → preprocess → train → aggregate → save",
    },
    "storage": {
        "path": _BACKEND / "storage.py",
        "label": "Storage Layer",
        "description": "Data access layer — all CRUD and analytics operations (FastAPI/SQLAlchemy)",
    },
    "models": {
        "path": _BACKEND / "models.py",
        "label": "ORM Models",
        "description": "SQLAlchemy ORM models — mirrors the PostgreSQL database schema",
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
    stat = path.stat()
    return {
        "id": file_id,
        "label": meta["label"],
        "description": meta["description"],
        "content": content,
        "lines": content.count("\n") + 1,
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
        "action": "update",
        "entity_type": "code",
        "entity_id": 0,
        "entity_name": meta["label"],
        "detail": f"Price elasticity file {meta['label']} modified via Code Explorer",
        "user": "ml-ops-user",
        "team": "ML Ops",
        "status": "success",
    })
    return {"success": True, "lines": content.count("\n") + 1, "savedAt": datetime.utcnow().isoformat()}
