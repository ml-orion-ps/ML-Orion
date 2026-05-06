from __future__ import annotations
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from fastapi import Depends
from database import get_db
import storage

router = APIRouter(prefix="/api", tags=["notebook"])

_ROOT = Path(__file__).parent.parent.parent.parent.parent
_EXCEL_FILE = _ROOT / "final_latest_customer_recommendations.xlsx"


def _classify_risk(prob: float) -> str:
    if prob >= 0.8:
        return "very high"
    if prob >= 0.6:
        return "high"
    if prob >= 0.3:
        return "medium"
    return "low"


def _action_type(risk: str, drivers_text: str) -> str:
    drivers_lower = drivers_text.lower()
    if "price" in drivers_lower or "cost" in drivers_lower:
        return "Discount Offer"
    if "speed" in drivers_lower or "outage" in drivers_lower:
        return "Tech Support"
    if risk in ("very high", "high"):
        return "Retention Offer"
    if risk == "medium":
        return "Proactive Call"
    return "Loyalty Plan"


def _estimate_impact(monthly_revenue: float, risk: str) -> float:
    multiplier = {"very high": 36, "high": 24, "medium": 12, "low": 6}.get(risk, 12)
    return round(monthly_revenue * multiplier, 2)


def _estimate_cost(risk: str) -> float:
    return {"very high": 100, "high": 60, "medium": 30, "low": 15}.get(risk, 30)


@router.get("/notebook-output")
def notebook_output():
    if not _EXCEL_FILE.exists():
        return {"rows": [], "available": False}
    try:
        import pandas as pd
        df = pd.read_excel(_EXCEL_FILE)
        df = df.where(df.notna(), None)
        rows = df.to_dict(orient="records")
        return {"rows": rows, "available": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/import-notebook-predictions")
def import_notebook_predictions(db: Session = Depends(get_db)):
    if not _EXCEL_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail="Notebook output file not found. Run the notebook (Step 24) first to generate final_latest_customer_recommendations.xlsx.",
        )
    try:
        import pandas as pd
        df = pd.read_excel(_EXCEL_FILE)
        df = df.where(df.notna(), None)
        rows = df.to_dict(orient="records")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read Excel: {e}")

    if not rows:
        raise HTTPException(status_code=400, detail="Excel file is empty.")

    today = datetime.utcnow().date()
    model = storage.create_ml_model(db, {
        "name": f"Notebook Import – {today}",
        "dataset_id": 0,
        "algorithm": "Notebook (LightGBM / XGBoost / RF)",
        "status": "trained",
        "accuracy": None, "precision": None, "recall": None,
        "f1_score": None, "auc": None,
        "hyperparameters": {}, "feature_importance": [],
        "confusion_matrix": {"tp": 0, "fp": 0, "tn": 0, "fn": 0},
        "model_weights": {}, "is_deployed": False, "deployed_at": None,
    })

    imported = very_high = high = medium = low = 0

    for row in rows:
        acct = str(row.get("account_number") or "") if row.get("account_number") is not None else None
        if not acct:
            continue

        raw_prob = row.get("predicted_churn_probability_next_3m")
        try:
            prob = float(raw_prob)
            prob = max(0.0001, min(0.9999, prob))
        except (TypeError, ValueError):
            prob = 0.05

        risk = _classify_risk(prob)
        recommendation = str(row.get("final_recommendation") or "").strip() or "Monitor account."
        drivers_text = str(row.get("top_3_shap_drivers_str") or "").strip()

        monthly_rev = 50.0
        value_tier = "Platinum" if risk in ("very high", "high") else ("Gold" if risk == "medium" else "Silver")

        customer = storage.upsert_customer(db, {
            "account_number": acct,
            "name": f"Account {acct}",
            "region": "Unknown",
            "state": "N/A",
            "service_type": "Copper DSL",
            "tenure_months": 12,
            "monthly_revenue": monthly_rev,
            "contract_status": "Active",
            "value_tier": value_tier,
            "is_churned": False,
        })

        prediction = storage.create_prediction(db, {
            "model_id": model.id,
            "customer_id": customer.id,
            "churn_probability": prob,
            "risk_category": risk,
            "top_drivers": [{"feature": drivers_text}] if drivers_text else [],
            "recommended_action": recommendation,
            "action_category": "urgent" if risk in ("very high", "high") else ("proactive" if risk == "medium" else "monitor"),
        })

        storage.create_recommendation(db, {
            "customer_id": customer.id,
            "prediction_id": prediction.id,
            "action_type": _action_type(risk, drivers_text),
            "priority": risk,
            "status": "pending",
            "estimated_impact": _estimate_impact(monthly_rev, risk),
            "estimated_cost": _estimate_cost(risk),
        })

        if risk == "very high":
            very_high += 1
        elif risk == "high":
            high += 1
        elif risk == "medium":
            medium += 1
        else:
            low += 1
        imported += 1

    return {
        "success": True,
        "modelId": model.id,
        "imported": imported,
        "veryHigh": very_high,
        "high": high,
        "medium": medium,
        "low": low,
        "message": f"Imported {imported} predictions from notebook output (Very High: {very_high}, High: {high}, Medium: {medium}, Low: {low}).",
    }
