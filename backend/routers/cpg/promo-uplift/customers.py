from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("")
def list_customers(
    limit: int = Query(50, le=1000),
    offset: int = Query(0, ge=0),
    risk: str | None = Query(None),
    churned: str | None = Query(None),
    region: str | None = Query(None),
    db: Session = Depends(get_db),
):
    all_customers = storage.get_customers(db)

    filtered = all_customers
    if risk:
        filtered = [c for c in filtered if c.churn_risk_category == risk]
    if churned == "true":
        filtered = [c for c in filtered if c.is_churned]
    elif churned == "false":
        filtered = [c for c in filtered if not c.is_churned]
    if region:
        filtered = [c for c in filtered if c.region == region]

    page = filtered[offset: offset + limit]
    return {
        "data": [_serialize(c) for c in page],
        "total": len(filtered),
        "limit": limit,
        "offset": offset,
    }


@router.get("/stats")
def customer_stats(db: Session = Depends(get_db)):
    all_c = storage.get_customers(db)
    active = [c for c in all_c if not c.is_churned]
    return {"total": len(all_c), "active": len(active), "churned": len(all_c) - len(active)}


@router.get("/{customer_id}")
def get_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = storage.get_customer(db, customer_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    preds = storage.get_predictions(db)
    customer_preds = [p for p in preds if p["customer_id"] == customer_id]
    recs = storage.get_recommendations(db, customer_id)
    return {
        "customer": _serialize(customer),
        "predictions": customer_preds,
        "recommendations": [_serialize_rec(r) for r in recs],
    }


@router.post("/shap-drivers")
def shap_drivers(body: dict, db: Session = Depends(get_db)):
    model_id = body.get("modelId")
    customer_ids = body.get("customerIds")

    if not model_id:
        raise HTTPException(status_code=400, detail="Model ID is required")

    model = storage.get_ml_model(db, model_id)
    if not model:
        models = storage.get_ml_models(db)
        deployed = [m for m in models if m.is_deployed]
        model = deployed[0] if deployed else (models[0] if models else None)

    if not model:
        raise HTTPException(status_code=404, detail="No model available")

    all_customers = storage.get_customers(db)
    score_customers = all_customers
    if customer_ids and isinstance(customer_ids, list) and customer_ids:
        score_customers = [c for c in all_customers if c.id in customer_ids]

    if not score_customers:
        raise HTTPException(status_code=400, detail="No customers to score")

    feature_importance = model.feature_importance or []
    top_drivers = sorted(feature_importance, key=lambda x: abs(x.get("importance", 0)), reverse=True)[:5]

    predictions = [
        {
            "accountId": c.account_number,
            "customerId": c.id,
            "churnProbability": c.churn_risk_score or 0,
            "riskBand": c.churn_risk_category or "low",
            "top3Drivers": [
                {
                    "feature": d.get("feature", ""),
                    "impact": round(d.get("importance", 0) * (c.churn_risk_score or 0.5), 4),
                    "direction": "positive" if d.get("importance", 0) > 0 else "negative",
                }
                for d in top_drivers[:3]
            ],
        }
        for c in score_customers
    ]

    return {"success": True, "predictions": predictions}


def _serialize(c) -> dict:
    return {
        "id": c.id,
        "accountNumber": c.account_number,
        "name": c.name,
        "region": c.region,
        "state": c.state,
        "serviceType": c.service_type,
        "tenureMonths": c.tenure_months,
        "monthlyRevenue": c.monthly_revenue,
        "contractStatus": c.contract_status,
        "valueTier": c.value_tier,
        "creditScore": c.credit_score,
        "bundleType": c.bundle_type,
        "provisionedSpeed": c.provisioned_speed,
        "actualSpeed": c.actual_speed,
        "outageCount": c.outage_count,
        "ticketCount": c.ticket_count,
        "avgResolutionHours": c.avg_resolution_hours,
        "npsScore": c.nps_score,
        "fiberAvailable": c.fiber_available,
        "competitorAvailable": c.competitor_available,
        "churnRiskScore": c.churn_risk_score,
        "churnRiskCategory": c.churn_risk_category,
        "isChurned": c.is_churned,
        "churnDate": c.churn_date.isoformat() if c.churn_date else None,
        "churnReason": c.churn_reason,
        "lastBillAmount": c.last_bill_amount,
        "paymentHistory": c.payment_history,
        "autoPayEnabled": c.auto_pay_enabled,
        "premisesType": c.premises_type,
        "lifecycleStage": c.lifecycle_stage,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
    }


def _serialize_rec(r) -> dict:
    return {
        "id": r.id,
        "customerId": r.customer_id,
        "predictionId": r.prediction_id,
        "actionType": r.action_type,
        "priority": r.priority,
        "status": r.status,
        "outcome": r.outcome,
        "estimatedImpact": r.estimated_impact,
        "estimatedCost": r.estimated_cost,
        "assignedTo": r.assigned_to,
        "notes": r.notes,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
        "executedAt": r.executed_at.isoformat() if r.executed_at else None,
    }
