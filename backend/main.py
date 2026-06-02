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
import importlib.util
import sys
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
from routers.tmt.customer_churn import code as churn_code_router
from routers.cpg.baseline_modelling import code as cpg_code_router
from routers.cpg.price_elasticity import (datasets as cpg_price_elasticity, ml_models as cpg_price_elasticity_ml_models, orion as cpg_price_elasticity_orion, code as cpg_price_elasticity_code)
from routers.retail.demand_forecast import analytics as retail_df_analytics, customers as retail_df_customers, datasets as retail_df_datasets, ml_models as retail_df_ml_models, predictions as retail_df_predictions, orion as retail_df_orion
from routers.retail.demand_forecast import audit as retail_df_audit, monitoring as retail_df_monitoring
from routers.retail.demand_forecast import monitoring as global_monitoring
from routers.retail.demand_forecast import code as retail_df_code_router

def _load_module_from_path(module_name: str, file_path: str):
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    mod  = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod

_promo_dir = Path(__file__).parent / "routers" / "cpg" / "promo-uplift"

_promo_datasets    = _load_module_from_path("routers.cpg.promo_uplift.datasets",    str(_promo_dir / "datasets.py"))
_promo_ml_models   = _load_module_from_path("routers.cpg.promo_uplift.ml_models",   str(_promo_dir / "ml_models.py"))
_promo_analytics   = _load_module_from_path("routers.cpg.promo_uplift.analytics",   str(_promo_dir / "analytics.py"))
_promo_customers   = _load_module_from_path("routers.cpg.promo_uplift.customers",   str(_promo_dir / "customers.py"))
_promo_predictions = _load_module_from_path("routers.cpg.promo_uplift.predictions", str(_promo_dir / "predictions.py"))
_promo_orion       = _load_module_from_path("routers.cpg.promo_uplift.orion",       str(_promo_dir / "orion.py"))
_promo_audit       = _load_module_from_path("routers.cpg.promo_uplift.audit",       str(_promo_dir / "audit.py"))
_promo_monitoring  = _load_module_from_path("routers.cpg.promo_uplift.monitoring",  str(_promo_dir / "monitoring.py"))
_promo_code        = _load_module_from_path("routers.cpg.promo_uplift.code",        str(_promo_dir / "code.py"))
_promo_notebook    = _load_module_from_path("routers.cpg.promo_uplift.notebook",    str(_promo_dir / "notebook.py"))

# The kpi-anomaly router directory also uses a hyphen in its folder name.
# Load it explicitly via importlib — same pattern as promo-uplift above.
_anomaly_dir = Path(__file__).parent / "routers" / "retail" / "kpi-anomaly"

_anomaly_datasets    = _load_module_from_path("routers.retail.kpi_anomaly.datasets",    str(_anomaly_dir / "datasets.py"))
_anomaly_ml_models   = _load_module_from_path("routers.retail.kpi_anomaly.ml_models",   str(_anomaly_dir / "ml_models.py"))
_anomaly_analytics   = _load_module_from_path("routers.retail.kpi_anomaly.analytics",   str(_anomaly_dir / "analytics.py"))
_anomaly_customers   = _load_module_from_path("routers.retail.kpi_anomaly.customers",   str(_anomaly_dir / "customers.py"))
_anomaly_predictions = _load_module_from_path("routers.retail.kpi_anomaly.predictions", str(_anomaly_dir / "predictions.py"))
_anomaly_orion       = _load_module_from_path("routers.retail.kpi_anomaly.orion",       str(_anomaly_dir / "orion.py"))
_anomaly_audit       = _load_module_from_path("routers.retail.kpi_anomaly.audit",       str(_anomaly_dir / "audit.py"))
_anomaly_monitoring  = _load_module_from_path("routers.retail.kpi_anomaly.monitoring",  str(_anomaly_dir / "monitoring.py"))
_anomaly_code        = _load_module_from_path("routers.retail.kpi_anomaly.code",        str(_anomaly_dir / "code.py"))
_anomaly_notebook    = _load_module_from_path("routers.retail.kpi_anomaly.notebook",    str(_anomaly_dir / "notebook.py"))
_anomaly_features    = _load_module_from_path("routers.retail.kpi_anomaly.features",    str(_anomaly_dir / "features.py"))

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
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS mape REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS r2 REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS promo_effect_units REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS baseline_units REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS residual_units REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS row_count INTEGER",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS \"forecastUnits\" REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS \"actualUnits\" REAL",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS is_deployed BOOLEAN DEFAULT FALSE",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMP",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) DEFAULT 'pending'",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS approved_by TEXT",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP",
        "ALTER TABLE ml_models ADD COLUMN IF NOT EXISTS approval_notes TEXT",
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
    description="Automation platform — pure FastAPI backend",
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
app.include_router(churn_code_router.router,prefix = "/api/tmt")
app.include_router(cpg_code_router.router,prefix = "/api/cpg/baseline_modelling")
app.include_router(cpg_ml_models.router, prefix="/api/cpg/baseline_modelling")
app.include_router(cpg_analytics.router, prefix="/api/cpg")
app.include_router(cpg_customers.router, prefix="/api/cpg")
app.include_router(cpg_datasets.router, prefix="/api/cpg/baseline_modelling")  
app.include_router(cpg_predictions.router, prefix="/api/cpg/baseline_modelling")
app.include_router(cpg_orion.router, prefix="/api/cpg/baseline_modelling")
app.include_router(cpg_audit.router, prefix="/api/cpg")
app.include_router(cpg_monitoring.router, prefix="/api/cpg/baseline_modelling")
app.include_router(global_monitoring.router, prefix="/api/monitoring")
app.include_router(code_router.router)
app.include_router(cpg_price_elasticity.router, prefix="/api/cpg/price_elasticity")
app.include_router(cpg_price_elasticity_ml_models.router, prefix="/api/cpg/price_elasticity")
app.include_router(cpg_price_elasticity_orion.router, prefix="/api/cpg/price_elasticity")
app.include_router(cpg_price_elasticity_code.router, prefix="/api/cpg/price_elasticity")


app.include_router(retail_df_code_router.router,prefix = "/api/retail/demand_forecast")
app.include_router(retail_df_ml_models.router, prefix="/api/retail/demand_forecast")
app.include_router(retail_df_analytics.router, prefix="/api/retail")
app.include_router(retail_df_customers.router, prefix="/api/retail")
app.include_router(retail_df_datasets.router, prefix="/api/retail/demand_forecast")  
app.include_router(retail_df_predictions.router, prefix="/api/retail/demand_forecast")
app.include_router(retail_df_orion.router, prefix="/api/retail/demand_forecast")
app.include_router(retail_df_audit.router, prefix="/api/retail")
app.include_router(retail_df_monitoring.router, prefix="/api/retail/demand_forecast")

# Promo-uplift routers — all scoped under /api/cpg/promoUplift
app.include_router(_promo_datasets.router,    prefix="/api/cpg/promoUplift")
app.include_router(_promo_ml_models.router,   prefix="/api/cpg/promoUplift")
app.include_router(_promo_analytics.router,   prefix="/api/cpg/promoUplift")
app.include_router(_promo_customers.router,   prefix="/api/cpg/promoUplift")
app.include_router(_promo_predictions.router, prefix="/api/cpg/promoUplift")
app.include_router(_promo_orion.router,       prefix="/api/cpg/promoUplift")
app.include_router(_promo_audit.router,       prefix="/api/cpg/promoUplift")
app.include_router(_promo_monitoring.router,  prefix="/api/cpg/promoUplift")
app.include_router(_promo_code.router,        prefix="/api/cpg/promoUplift")
app.include_router(_promo_notebook.router,    prefix="/api/cpg/promoUplift")
# KPI-anomaly routers — all scoped under /api/retail/kpiAnomaly
app.include_router(_anomaly_datasets.router,    prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_ml_models.router,   prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_analytics.router,   prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_customers.router,   prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_predictions.router, prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_orion.router,       prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_audit.router,       prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_monitoring.router,  prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_code.router,        prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_notebook.router,    prefix="/api/retail/kpiAnomaly")
app.include_router(_anomaly_features.router,    prefix="/api/retail/kpiAnomaly")

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
