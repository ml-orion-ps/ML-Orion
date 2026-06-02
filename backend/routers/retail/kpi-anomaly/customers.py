"""KPI-anomaly KPI configuration endpoints (parallel to promo-uplift customers.py)."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/customers", tags=["kpi-anomaly-customers"])

# Default KPI config mirrored here so the frontend can read/display it.
DEFAULT_KPI_CONFIG: dict[str, dict] = {
    "set_rate":         {"window1": 3, "window2": 6, "anomaly_percentile": 12},
    "demo_rate":        {"window1": 3, "window2": 7, "anomaly_percentile": 13},
    "gross_close_rate": {"window1": 2, "window2": 6, "anomaly_percentile": 13},
    "issue_rate":       {"window1": 2, "window2": 6, "anomaly_percentile": 15},
    "net_close_rate":   {"window1": 2, "window2": 5, "anomaly_percentile": 18},
    "avg_ticket_size":  {"window1": 4, "window2": 7, "anomaly_percentile": 18},
    "cost_per_lead":    {"window1": 4, "window2": 6, "anomaly_percentile": 14},
    "cost_per_demo":    {"window1": 2, "window2": 8, "anomaly_percentile": 12},
}


@router.get("")
def list_kpi_configs(
    limit:  int = Query(50, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Return the default KPI configuration entries."""
    items = [
        {"kpi": kpi, **cfg}
        for kpi, cfg in DEFAULT_KPI_CONFIG.items()
    ]
    page = items[offset: offset + limit]
    return {"data": page, "total": len(items), "limit": limit, "offset": offset}


@router.get("/stats")
def kpi_stats(db: Session = Depends(get_db)):
    return {
        "totalKpis":   len(DEFAULT_KPI_CONFIG),
        "kpiNames":    list(DEFAULT_KPI_CONFIG.keys()),
    }


@router.get("/{kpi_name}")
def get_kpi_config(kpi_name: str, db: Session = Depends(get_db)):
    cfg = DEFAULT_KPI_CONFIG.get(kpi_name)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"KPI '{kpi_name}' not found in default config")
    return {"kpi": kpi_name, **cfg}
