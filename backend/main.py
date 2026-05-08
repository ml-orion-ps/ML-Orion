"""
FastAPI server — pure Python backend replacing Express.js completely.
Serves both the API and the React frontend static build.

Development:
    cd fastapi_server
    uvicorn main:app --host 0.0.0.0 --port 5000 --reload

Production (after npm run build):
    uvicorn main:app --host 0.0.0.0 --port 5000
"""
import os
import re
import json
from pathlib import Path
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

load_dotenv()

from sqlalchemy import text
from database import engine
from models import Base

from routers.tmt.customer_churn import analytics, customers, datasets, ml_models, predictions, orion, audit
from routers.tmt.customer_churn import monitoring, notebook, code as code_router
from routers.cpg.baseline_modelling import analytics as cpg_analytics, customers as cpg_customers, datasets as cpg_datasets, ml_models as cpg_ml_models, predictions as cpg_predictions, orion as cpg_orion
from routers.cpg.baseline_modelling import audit as cpg_audit, monitoring as cpg_monitoring
from routers.cpg.baseline_modelling import monitoring as global_monitoring

# CamelCase middleware
# Drizzle (Node.js) returned camelCase; SQLAlchemy returns snake_case.
# This middleware converts all JSON response keys to camelCase so the
# React frontend works unchanged.

def _snake_to_camel(name: str) -> str:
    parts = name.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _camelize(obj):
    if isinstance(obj, dict):
        return {_snake_to_camel(k): _camelize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_camelize(i) for i in obj]
    return obj


class CamelCaseMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        ct = response.headers.get("content-type", "")
        if not ct.startswith("application/json"):
            return response

        body = b""
        async for chunk in response.body_iterator:
            body += chunk

        try:
            data = json.loads(body)
            camelized = _camelize(data)
            new_body = json.dumps(camelized, default=str).encode()
        except Exception:
            new_body = body

        headers = dict(response.headers)
        headers["content-length"] = str(len(new_body))

        return JSONResponse(
            content=json.loads(new_body),
            status_code=response.status_code,
            headers={k: v for k, v in headers.items() if k.lower() not in ("content-length", "content-type")},
        )


# Lifespan

def _run_migrations():
    """Add any columns that exist in the model but may be missing from the live DB."""
    migrations = [
        "ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(100)",
        "ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS notes TEXT",
        "ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS ks REAL",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS psi REAL",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS high_risk_pct REAL",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS med_risk_pct REAL",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS low_risk_pct REAL",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS score_histogram JSONB",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS top_feature_shap_summary JSONB",
        "ALTER TABLE model_evaluation_runs ADD COLUMN IF NOT EXISTS has_labels BOOLEAN",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS use_case VARCHAR(100)",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS wmape REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS mae REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS rmse REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS r2 REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS promo_effect_units REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS baseline_units REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS residual_units REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS row_count INTEGER",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
            except Exception:
                pass
        conn.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine, checkfirst=True)
    _run_migrations()
    yield


# App

app = FastAPI(
    title="ML Orion API",
    description="Churn prediction platform — pure FastAPI backend",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(CamelCaseMiddleware)

# API routers

app.include_router(analytics.router)
app.include_router(customers.router)
app.include_router(datasets.router)
app.include_router(ml_models.router)
app.include_router(predictions.router)
app.include_router(orion.router)
app.include_router(audit.router)
app.include_router(monitoring.router)
app.include_router(notebook.router)
app.include_router(code_router.router)
app.include_router(cpg_ml_models.router, prefix="/api/cpg")
app.include_router(cpg_analytics.router, prefix="/api/cpg")
app.include_router(cpg_customers.router, prefix="/api/cpg")
app.include_router(cpg_datasets.router, prefix="/api/cpg")  
app.include_router(cpg_predictions.router, prefix="/api/cpg")
app.include_router(cpg_orion.router, prefix="/api/cpg")
app.include_router(cpg_audit.router, prefix="/api/cpg")
app.include_router(cpg_monitoring.router, prefix="/api/cpg")
app.include_router(global_monitoring.router, prefix="/api/monitoring")
app.include_router(code_router.router, prefix="/api/cpg/code")

@app.get("/api/health")
def health():
    return {"status": "ok", "framework": "FastAPI", "version": "2.0.0"}


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"message": str(exc)})


# Serve React frontend (production build)
# React builds to dist/public/. Mount static assets, then catch-all for SPA routing.

_DIST_DIR = Path(__file__).parent.parent / "dist" / "public"

if _DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST_DIR / "assets")), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_root():
        return FileResponse(str(_DIST_DIR / "index.html"))

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        # Skip API and WebSocket paths
        if full_path.startswith("api/") or full_path.startswith("vite-hmr"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404)
        file_path = _DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(_DIST_DIR / "index.html"))
