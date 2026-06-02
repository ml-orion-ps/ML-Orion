from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/orion", tags=["cpg_price_elasticity_orion"])
USE_CASE = "cpg_price_elasticity"


@router.get("/overview")
def orion_overview(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    datasets = storage.get_datasets(db)

    deployed = [m for m in models if m.is_deployed]

    # Aggregate global price elasticity across all models
    elasticities = []
    for m in models:
        weights = m.model_weights or {}
        elas = weights.get("globalPriceElasticity")
        if elas is None and m.r2 is not None:
            elas = m.r2
        if elas is not None:
            elasticities.append(float(elas))

    avg_elasticity = round(sum(elasticities) / len(elasticities), 4) if elasticities else None

    deployed_elasticities = []
    for m in deployed:
        weights = m.model_weights or {}
        elas = weights.get("globalPriceElasticity")
        if elas is None and m.r2 is not None:
            elas = m.r2
        if elas is not None:
            deployed_elasticities.append(float(elas))

    deployed_elasticity = round(sum(deployed_elasticities) / len(deployed_elasticities), 4) if deployed_elasticities else None
    total_rows_processed = sum(
        (m.row_count or (m.model_weights or {}).get("rowsProcessed", 0) or 0)
        for m in models
    )

    # Build model performance list (last 8, sorted by trained_at)
    sorted_models = sorted(models, key=lambda x: x.trained_at or "")
    model_performance = [
        {
            "id": m.id,
            "name": m.name,
            "algorithm": m.algorithm,
            "global_price_elasticity": (m.model_weights or {}).get("globalPriceElasticity") or m.r2,
            "model_converged": (m.model_weights or {}).get("modelConverged"),
            "brands_scored": len((m.model_weights or {}).get("elasticitySummary", [])),
            "row_count": m.row_count or (m.model_weights or {}).get("rowsProcessed", 0),
            "r2": m.r2,
            "is_deployed": m.is_deployed,
            "trained_at": m.trained_at,
            "model_weights": m.model_weights,
        }
        for m in sorted_models[-8:]
    ]

    active_model = None
    if deployed:
        dm = deployed[0]
        weights = dm.model_weights or {}
        active_model = {
            "id": dm.id,
            "name": dm.name,
            "algorithm": dm.algorithm,
            "global_price_elasticity": weights.get("globalPriceElasticity") or dm.r2,
            "model_converged": weights.get("modelConverged"),
            "elasticity_summary": weights.get("elasticitySummary", []),
            "row_count": dm.row_count or weights.get("rowsProcessed", 0),
            "r2": dm.r2,
            "is_deployed": True,
            "trained_at": dm.trained_at,
            "model_weights": dm.model_weights,
        }

    return {
        "kpis": {
            "total_models": len(models),
            "deployed_models": len(deployed),
            "avg_elasticity": avg_elasticity,
            "deployed_elasticity": deployed_elasticity,
            "total_rows_processed": total_rows_processed,
            "total_datasets": len(datasets),
            "deployed_converged": deployed[0].model_weights.get("modelConverged") if deployed and deployed[0].model_weights else None,
        },
        "model_performance": model_performance,
        "active_model": active_model,
        "recent_models": [
            {
                "id": m.id,
                "name": m.name,
                "algorithm": m.algorithm,
                "global_price_elasticity": (m.model_weights or {}).get("globalPriceElasticity") or m.r2,
                "model_converged": (m.model_weights or {}).get("modelConverged"),
                "status": m.status,
                "is_deployed": m.is_deployed,
                "trained_at": m.trained_at,
                "model_weights": m.model_weights,
            }
            for m in sorted_models[-5:]
        ],
    }


@router.get("/governance")
def get_governance(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)

    registry = []
    for m in models:
        weights = m.model_weights or {}
        row_count = m.row_count or weights.get("rowsProcessed", 0) or 0
        elasticity_summary = weights.get("elasticitySummary", [])

        compliance_checks = {
            "dataLineage": m.dataset_id is not None,
            "metricsRecorded": weights.get("globalPriceElasticity") is not None,
            "featureDocumented": len(elasticity_summary) > 0,
            "hyperparamsLogged": weights.get("modelConverged") is not None,
        }

        registry.append({
            "id": m.id,
            "name": m.name,
            "algorithm": m.algorithm or "Mixed LM",
            "status": m.status,
            "isDeployed": m.is_deployed,
            "trainedAt": m.trained_at.isoformat() if m.trained_at else None,
            "deployedAt": m.deployed_at.isoformat() if getattr(m, "deployed_at", None) else None,
            "r2": m.r2,
            "rowCount": row_count,
            "globalPriceElasticity": weights.get("globalPriceElasticity"),
            "modelConverged": weights.get("modelConverged"),
            "brandsScored": len(elasticity_summary),
            "approvalStatus": getattr(m, "approval_status", None),
            "approvedBy": getattr(m, "approved_by", None),
            "approvedAt": None,
            "complianceChecks": compliance_checks,
            "datasetName": None,
            "datasetRows": row_count,
            "predictionCount": row_count,
        })

    compliant_count = sum(
        1 for r in registry if all(r["complianceChecks"].values())
    )

    return {
        "registry": registry,
        "auditLog": [],
        "summary": {
            "totalModels": len(models),
            "deployed": sum(1 for m in models if m.is_deployed),
            "approved": 0,
            "pendingApproval": 0,
        },
    }


@router.get("/monitoring/{model_id}")
def get_monitoring(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    weights = model.model_weights or {}
    elasticity_summary = weights.get("elasticitySummary", [])
    global_elas = float(weights.get("globalPriceElasticity") or model.r2 or 0)

    all_models = storage.get_ml_models(db, use_case=USE_CASE)
    all_models_sorted = sorted(all_models, key=lambda x: x.trained_at or "")

    weekly_metrics = []
    for i, m in enumerate(all_models_sorted[-8:]):
        w = m.model_weights or {}
        elas = float(w.get("globalPriceElasticity") or m.r2 or 0)
        weekly_metrics.append({
            "label": f"Run {i + 1}",
            "elasticity": round(elas, 4),
            "converged": 1 if w.get("modelConverged") else 0,
            "brandsScored": len(w.get("elasticitySummary", [])),
            "rowsProcessed": m.row_count or w.get("rowsProcessed", 0) or 0,
            "r2":   w.get("r2")   if w.get("r2")   is not None else m.r2,
            "mae":  w.get("mae")  if w.get("mae")  is not None else getattr(m, "mae", None),
            "rmse": w.get("rmse") if w.get("rmse") is not None else getattr(m, "rmse", None),
            "aic":  w.get("aic"),
            "priceCoefPvalue": w.get("priceCoefPvalue"),
        })

    driver_changes = [
        {
            "name": b["name"],
            "displayName": "brand elasticity",
            "current": abs(float(b["elasticity"])),
            "delta": 0.0,
            "deltaPct": "0",
            "trend": "declining" if b["elasticity"] < -1 else "stable",
        }
        for b in elasticity_summary[:6]
    ]

    recommendations = []
    high_elastic = [b for b in elasticity_summary if b["elasticity"] < -1]
    inelastic_brands = [b for b in elasticity_summary if -1 <= b["elasticity"] < 0]

    if high_elastic:
        recommendations.append({
            "id": "high-elastic-brands",
            "title": f"{len(high_elastic)} Highly Elastic Brand(s) Detected",
            "severity": "high" if len(high_elastic) > 3 else "medium",
            "category": "Pricing Strategy",
            "detail": (
                f"{len(high_elastic)} brand(s) have elasticity below -1, making them highly "
                "price-sensitive. Small price increases significantly reduce volume."
            ),
            "action": "Review pricing for elastic brands. Consider promotional support or value packs instead of price increases.",
            "impact": f"Protecting volume for {len(high_elastic)} elastic brand(s) can preserve significant revenue.",
            "icon": "trend-down",
        })

    if global_elas < -1.5:
        recommendations.append({
            "id": "global-high-elasticity",
            "title": "High Portfolio-Wide Price Sensitivity",
            "severity": "medium",
            "category": "Model Insight",
            "detail": (
                f"Global elasticity of {round(global_elas, 3)} means a 1% price increase "
                f"reduces demand by {abs(round(global_elas, 2))}% on average across the portfolio."
            ),
            "action": "Develop a pricing architecture segmenting brands by elasticity tier.",
            "impact": "Tiered pricing can optimise revenue while protecting high-elasticity SKU volumes.",
            "icon": "sparkle",
        })

    if inelastic_brands:
        recommendations.append({
            "id": "inelastic-opportunity",
            "title": f"{len(inelastic_brands)} Inelastic Brand(s) — Pricing Opportunity",
            "severity": "low",
            "category": "Revenue Opportunity",
            "detail": (
                f"{len(inelastic_brands)} brand(s) have elasticity between -1 and 0 — demand is "
                "relatively insensitive to price changes."
            ),
            "action": "Consider selective price increases for inelastic brands to improve margin without significant volume loss.",
            "impact": "A 5% price increase on inelastic brands can improve revenue with minimal volume impact.",
            "icon": "shield",
        })

    return {
        "summary": {"latestPsi": None, "latestKs": None, "prodDataset": None},
        "weeklyMetrics": weekly_metrics,
        "driverChanges": driver_changes,
        "featureHistory": [{"label": m["label"], "elasticity": m["elasticity"]} for m in weekly_metrics],
        "featureNames": ["elasticity"],
        "recommendations": recommendations,
    }
