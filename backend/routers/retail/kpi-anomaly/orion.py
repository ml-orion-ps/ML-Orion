"""KPI-anomaly Orion overview endpoints."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/orion", tags=["kpi-anomaly-orion"])


def _kpi_models(db: Session):
    all_models = storage.get_ml_models(db)
    return [m for m in all_models if isinstance(m.model_weights, dict) and m.model_weights.get("modelType") == "kpi_anomaly"]


@router.get("/overview")
def orion_overview(db: Session = Depends(get_db)):
    models   = _kpi_models(db)
    datasets = storage.get_datasets(db)

    deployed     = [m for m in models if m.is_deployed]
    trained      = [m for m in models if m.status == "trained" or m.status == "deployed"]
    approved     = [m for m in models if m.approval_status == "approved"]

    # Aggregate anomaly stats from model_weights across all models
    total_anomalies  = 0
    total_rows       = 0
    kpis_monitored:  set[str] = set()

    for m in models:
        weights = m.model_weights or {}
        if not isinstance(weights, dict):
            continue
        summary = weights.get("summary", {})
        if not isinstance(summary, dict):
            continue
        total_anomalies += int(summary.get("totalAnomalies", 0))
        total_rows      += int(summary.get("totalRows",      0))
        for kpi in (summary.get("kpisProcessed") or []):
            kpis_monitored.add(kpi)

    model_performance = [
        {
            "id":         m.id,
            "name":       m.name,
            "algorithm":  m.algorithm,
            "isDeployed": m.is_deployed,
            "trainedAt":  m.trained_at,
            "status":     m.status,
        }
        for m in models[:6]
    ]

    return {
        "kpis": {
            "totalModels":      len(models),
            "deployedModels":   len(deployed),
            "totalDatasets":    len(datasets),
            "totalAnomalies":   total_anomalies,
            "totalRowsScored":  total_rows,
            "kpisMonitored":    len(kpis_monitored),
        },
        "kpisMonitored":    list(kpis_monitored),
        "modelPerformance": model_performance,
        "activeModel": {
            "id":        deployed[0].id,
            "name":      deployed[0].name,
            "algorithm": deployed[0].algorithm,
            "isDeployed": True,
            "trainedAt": deployed[0].trained_at,
        } if deployed else None,
        "recentModels": [
            {"id": m.id, "name": m.name, "algorithm": m.algorithm,
             "status": m.status, "trainedAt": m.trained_at}
            for m in models[:5]
        ],
    }


@router.get("/governance")
def governance(db: Session = Depends(get_db)):
    models   = _kpi_models(db)
    audit    = storage.get_audit_log(db, 100)
    datasets = {d.id: d for d in storage.get_datasets(db)}

    approved = [m for m in models if m.approval_status == "approved"]
    pending  = [m for m in models if m.approval_status == "pending"]
    deployed = [m for m in models if m.is_deployed]

    def _compliance(m) -> dict:
        ds      = datasets.get(m.dataset_id)
        weights = m.model_weights or {}
        summary = weights.get("summary", {}) if isinstance(weights, dict) else {}
        return {
            "dataLineage":      bool(ds),
            "metricsRecorded":  bool(isinstance(summary, dict) and summary.get("kpiStats")),
            "featureDocumented": bool(isinstance(summary, dict) and summary.get("kpisProcessed")),
            "hyperparamsLogged": bool(m.hyperparameters),
        }

    def _registry_row(m) -> dict:
        ds      = datasets.get(m.dataset_id)
        weights = m.model_weights or {}
        summary = weights.get("summary", {}) if isinstance(weights, dict) else {}
        return {
            "id":              m.id,
            "name":            m.name,
            "algorithm":       m.algorithm,
            "status":          m.status,
            "approvalStatus":  m.approval_status,
            "isDeployed":      m.is_deployed,
            "trainedAt":       m.trained_at,
            "deployedAt":      m.deployed_at,
            "approvedBy":      m.approved_by,
            "approvedAt":      m.approved_at,
            "datasetName":     ds.name if ds else "—",
            "datasetRows":     ds.row_count if ds else 0,
            "totalAnomalies":  summary.get("totalAnomalies") if isinstance(summary, dict) else 0,
            "kpisProcessed":   len(summary.get("kpisProcessed", [])) if isinstance(summary, dict) else 0,
            "complianceChecks": _compliance(m),
        }

    return {
        "registry": [_registry_row(m) for m in models],
        "summary": {
            "totalModels":     len(models),
            "approved":        len(approved),
            "pendingApproval": len(pending),
            "deployed":        len(deployed),
        },
        "auditLog": [
            {
                "id":         a.id,
                "action":     a.action,
                "entityType": a.entity_type,
                "entityName": a.entity_name,
                "detail":     a.detail,
                "user":       a.user,
                "team":       a.team,
                "status":     a.status,
                "createdAt":  a.created_at,
            }
            for a in audit[:20]
        ],
    }
