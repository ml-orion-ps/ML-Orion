"""
Code Explorer — lets the UI read and edit the Python backend source files.
Updated to point to Python files (replacing the old TypeScript references).
"""
from __future__ import annotations
import re
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/api", tags=["code"])

_ROOT = Path(__file__).parent.parent.parent.parent.parent

# Allowlist of files that the code explorer can read/write.
# Updated to reference Python files instead of TypeScript originals.
_ML_SCRIPTS = _ROOT / "ML_backend" / "python-ml" / "tmt" / "customer_churn"
_BACKEND = _ROOT / "backend"

CODE_FILE_MAP: dict[str, dict] = {
    "train_model": {
        "path": _ML_SCRIPTS / "train_model.py",
        "label": "ML Trainer",
        "description": "Python ML engine: feature engineering, model selection, and training logic",
    },
    "storage": {
        "path": _BACKEND / "storage.py",
        "label": "Storage Layer",
        "description": "Data access layer — all CRUD and analytics operations (FastAPI/SQLAlchemy)",
    },
    "engine": {
        "path": _BACKEND / "services" / "custom_features.py",
        "label": "Feature Engine",
        "description": "Custom feature engine: lag, trend, rolling, ratio, flag, interaction",
    },
    "ml_service": {
        "path": _BACKEND / "services" / "ml_service.py",
        "label": "ML Service",
        "description": "Calls Python ML scripts — bridges FastAPI routes to ML training scripts",
    },
    "calculate_shap": {
        "path": _ML_SCRIPTS / "calculate_shap.py",
        "label": "SHAP Explainer",
        "description": "Python script for SHAP model explanations and feature contributions",
    },
    "models": {
        "path": _BACKEND / "models.py",
        "label": "ORM Models",
        "description": "SQLAlchemy ORM models — mirrors the PostgreSQL database schema",
    },
    "schema": {
        "path": _BACKEND / "schemas.py",
        "label": "Data Schema",
        "description": "Pydantic request/response schemas and type definitions for all entities",
    },
    "seed": {
        "path": _BACKEND / "storage.py",
        "label": "Storage & Analytics",
        "description": "All CRUD operations, analytics computations, and business logic for the database layer",
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
        "detail": f"Backend file {meta['label']} modified via Code Explorer",
        "user": "ml-ops-user",
        "team": "ML Ops",
        "status": "success",
    })
    return {"success": True, "lines": content.count("\n") + 1, "savedAt": datetime.utcnow().isoformat()}


@router.get("/orion/algorithms")
def list_algorithms():
    """Read algorithm names directly from train_model.py."""
    train_path = _ML_SCRIPTS / "train_model.py"
    algos = [{"value": "Auto", "label": "Auto (Best Model)", "desc": "Trains multiple models and selects the best performer"}]

    try:
        content = train_path.read_text(encoding="utf-8")
        match = re.search(r"MODEL_FAMILY_DISPLAY_NAMES\s*=\s*\{([^}]+)\}", content, re.DOTALL)
        if match:
            dict_content = match.group(1)
            for m in re.finditer(r"'([^']+)':\s*'([^']+)'", dict_content):
                label = m.group(2)
                if label not in {a["value"] for a in algos}:
                    algos.append({"value": label, "label": label, "desc": f"ML algorithm: {label}"})
        else:
            algos += [
                {"value": "Random Forest", "label": "Random Forest", "desc": "Ensemble of decision trees"},
                {"value": "XGBoost", "label": "XGBoost", "desc": "Gradient boosting"},
                {"value": "LightGBM", "label": "LightGBM", "desc": "Fast gradient boosting"},
                {"value": "Logistic Regression", "label": "Logistic Regression", "desc": "Linear classifier"},
            ]
    except Exception:
        algos += [
            {"value": "Random Forest", "label": "Random Forest", "desc": "Ensemble of decision trees"},
            {"value": "XGBoost", "label": "XGBoost", "desc": "Gradient boosting"},
        ]

    return algos
