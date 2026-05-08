from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage
from schemas import MlModelOut, TrainRequest, TrainLiveRequest, ApproveRequest
from services.ml_service import (
    run_train_model,
    run_calculate_shap,
    normalize_algorithm_for_python,
)
from services.custom_features import (
    get_dataset_rows,
    get_dataset_custom_features,
    apply_custom_features,
    get_model_custom_features,
)

router = APIRouter(prefix="/api/models", tags=["models"])

USE_CASE = "tmt_customer_churn"

ALGORITHM_MAP = {
    "Gradient Boosting": "XGBoost",
    "Neural Network": "Random Forest",
    "SVM": "Random Forest",
}

SUPPORTED_ALGORITHMS = {
    "Auto", "Random Forest", "LightGBM", "XGBoost",
    "Decision Tree", "Support Vector Machine", "Gradient Boosting",
    "Neural Network", "SVM",
}


def _risk_category(prob: float) -> str:
    """Thresholds match the original ML-Orion classifyRiskCategoryFromProbability."""
    if prob > 0.85:
        return "very high"
    if prob >= 0.70:
        return "high"
    if prob >= 0.50:
        return "medium"
    return "low"


def _recommended_action(prob: float) -> tuple[str, str]:
    if prob > 0.85:
        return "Immediate retention offer — high-value priority", "urgent"
    if prob >= 0.70:
        return "Proactive outreach with loyalty incentive", "proactive"
    if prob >= 0.50:
        return "Monitor and schedule check-in", "monitor"
    return "Standard engagement", "standard"


def _estimate_impact(monthly_revenue: float, risk: str) -> float:
    months = {"very high": 12, "high": 8, "medium": 4, "low": 1}.get(risk, 4)
    return round(monthly_revenue * months, 2)


def _estimate_cost(risk: str) -> float:
    return {"very high": 180.0, "high": 120.0, "medium": 60.0, "low": 15.0}.get(risk, 60.0)


def _generate_predictions_for_model(
    db: Session,
    model,
    precomputed: list[dict] | None = None,
    prod_dataset_id: int | None = None,
) -> dict:
    storage.clear_predictions_by_model(db, model.id)

    target_dataset_id = prod_dataset_id or model.dataset_id
    ds = storage.get_dataset(db, target_dataset_id) if target_dataset_id else None

    customers = storage.get_customers(db)
    if not customers:
        return {"predicted": 0, "veryHigh": 0, "high": 0, "medium": 0, "low": 0}

    feature_importance = model.feature_importance or []
    top_drivers = sorted(feature_importance, key=lambda x: abs(x.get("importance", 0)), reverse=True)[:5] if feature_importance else []

    if precomputed:
        cust_map = {c.account_number: c for c in customers}
        preds_to_create = []
        recs_to_create = []
        summary = {"predicted": 0, "veryHigh": 0, "high": 0, "medium": 0, "low": 0}

        for p in precomputed:
            acc = p.get("accountNumber") or p.get("account_number")
            prob = float(p.get("churnProbability", p.get("churn_probability", 0.5)))
            c = cust_map.get(acc)
            if not c:
                continue
            cat = _risk_category(prob)
            action, action_cat = _recommended_action(prob)
            preds_to_create.append({
                "model_id": model.id, "customer_id": c.id,
                "churn_probability": prob, "risk_category": cat,
                "top_drivers": top_drivers, "recommended_action": action, "action_category": action_cat,
            })
            if prob >= 0.50:
                action_type = "Retention Offer" if cat == "very high" else ("Proactive Call" if cat == "high" else "Loyalty Plan")
                recs_to_create.append({
                    "customer_id": c.id, "action_type": action_type,
                    "priority": cat, "status": "pending",
                    "estimated_impact": _estimate_impact(c.monthly_revenue or 0, cat),
                    "estimated_cost": _estimate_cost(cat),
                })
            summary["predicted"] += 1
            if cat == "very high":
                summary["veryHigh"] += 1
            elif cat == "high":
                summary["high"] += 1
            elif cat == "medium":
                summary["medium"] += 1
            else:
                summary["low"] += 1

        storage.bulk_create_predictions(db, preds_to_create)
        if recs_to_create:
            storage.bulk_create_recommendations(db, recs_to_create)
        return summary

    # Fallback: use churn risk score from customer table
    preds_to_create = []
    recs_to_create = []
    summary = {"predicted": 0, "veryHigh": 0, "high": 0, "medium": 0, "low": 0}

    for c in customers:
        prob = float(c.churn_risk_score or 0.5)
        cat = _risk_category(prob)
        action, action_cat = _recommended_action(prob)
        preds_to_create.append({
            "model_id": model.id, "customer_id": c.id,
            "churn_probability": prob, "risk_category": cat,
            "top_drivers": top_drivers, "recommended_action": action, "action_category": action_cat,
        })
        if prob >= 0.50:
            action_type = "Retention Offer" if cat == "very high" else ("Proactive Call" if cat == "high" else "Loyalty Plan")
            recs_to_create.append({
                "customer_id": c.id, "action_type": action_type,
                "priority": cat, "status": "pending",
                "estimated_impact": _estimate_impact(c.monthly_revenue or 0, cat),
                "estimated_cost": _estimate_cost(cat),
            })
        summary["predicted"] += 1
        if cat == "very high":
            summary["veryHigh"] += 1
        elif cat == "high":
            summary["high"] += 1
        elif cat == "medium":
            summary["medium"] += 1
        else:
            summary["low"] += 1

    storage.bulk_create_predictions(db, preds_to_create)
    if recs_to_create:
        storage.bulk_create_recommendations(db, recs_to_create)
    return summary


@router.get("")
def list_models(db: Session = Depends(get_db)):
    return storage.get_ml_models(db, use_case=USE_CASE)


@router.get("/latest/features")
def latest_features(dataset_id: int | None = Query(None), db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    if dataset_id:
        models = [m for m in models if m.dataset_id == dataset_id]
    if not models:
        return {"features": [], "algorithm": None, "modelId": None}
    model = models[0]
    fi = model.feature_importance or []
    return {"features": fi, "algorithm": model.algorithm, "modelId": model.id}


@router.get("/{model_id}", response_model=MlModelOut)
def get_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model


@router.post("/train")
def train_model(body: TrainRequest, db: Session = Depends(get_db)):
    ds = storage.get_dataset(db, body.dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")

    if body.algorithm not in SUPPORTED_ALGORITHMS:
        raise HTTPException(status_code=400, detail=f"Algorithm '{body.algorithm}' is not supported")

    source_rows = get_dataset_rows(ds)
    custom_features = get_dataset_custom_features(ds)
    training_rows = apply_custom_features(source_rows, custom_features) if custom_features else source_rows
    custom_feature_names = [f["name"] for f in custom_features]
    python_algorithm = ALGORITHM_MAP.get(body.algorithm, body.algorithm)

    result = run_train_model(
        data=training_rows,
        target_column="isChurned",
        algorithm=python_algorithm,
        hyperparameters=body.hyperparameters,
        custom_feature_names=custom_feature_names,
    )

    metrics = result.get("metrics")
    if not metrics:
        raise HTTPException(status_code=500, detail="Training returned no metrics")

    model_name = body.name or f"{body.algorithm} - {datetime.now(timezone.utc).date()}"
    best_model = result.get("bestModel", body.algorithm)

    model = storage.create_ml_model(db, {
        "name": model_name,
        "dataset_id": body.dataset_id,
        "algorithm": f"Auto ({best_model})" if body.algorithm == "Auto" else body.algorithm,
        "use_case": USE_CASE,
        "status": "trained",
        "accuracy": metrics.get("accuracy"),
        "precision": metrics.get("precision"),
        "recall": metrics.get("recall"),
        "f1_score": metrics.get("f1Score"),
        "auc": metrics.get("auc"),
        "hyperparameters": metrics.get("bestParams") or body.hyperparameters or {},
        "feature_importance": metrics.get("featureImportance") or [],
        "confusion_matrix": metrics.get("confusionMatrix") or {"tp": 0, "fp": 0, "tn": 0, "fn": 0},
        "model_weights": {
            "customFeatures": custom_features,
            "customFeatureNames": custom_feature_names,
            "oosMetrics": {
                "auc": metrics.get("auc"),
                "f1Score": metrics.get("f1Score"),
                "recallTop10": metrics.get("recallTop10"),
                "precisionTop10": metrics.get("precisionTop10"),
                "liftTop10": metrics.get("liftTop10"),
                "recallTop20": metrics.get("recallTop20"),
                "precisionTop20": metrics.get("precisionTop20"),
                "liftTop20": metrics.get("liftTop20"),
            },
            "optimalThreshold": metrics.get("optimalThreshold"),
            "cvSummary": metrics.get("cvSummary"),
        },
        "is_deployed": False,
        "deployed_at": None,
    })

    precomputed = result.get("latestActivePredictions") or []
    summary = _generate_predictions_for_model(db, model, precomputed if precomputed else None)

    result_dict = {c.name: getattr(model, c.name) for c in model.__table__.columns}
    result_dict["predictionsGenerated"] = summary["predicted"]
    return result_dict


@router.post("/train-live")
def train_live(body: TrainLiveRequest, db: Session = Depends(get_db)):
    customers = storage.get_customers(db)
    churned = [c for c in customers if c.is_churned]
    if not customers:
        raise HTTPException(status_code=400, detail="No customers found")
    if len(churned) < 10:
        raise HTTPException(status_code=400, detail=f"Need at least 10 churned customers, found {len(churned)}")

    training_rows = [
        {
            "accountNumber": c.account_number,
            "tenureMonths": c.tenure_months,
            "monthlyRevenue": c.monthly_revenue,
            "outageCount": c.outage_count or 0,
            "ticketCount": c.ticket_count or 0,
            "npsScore": c.nps_score or 0,
            "fiberAvailable": 1 if c.fiber_available else 0,
            "competitorAvailable": 1 if c.competitor_available else 0,
            "isChurned": 1 if c.is_churned else 0,
        }
        for c in customers
    ]

    python_algorithm = ALGORITHM_MAP.get(body.algorithm, body.algorithm)
    result = run_train_model(
        data=training_rows,
        target_column="isChurned",
        algorithm=python_algorithm,
        hyperparameters=body.hyperparameters,
    )

    metrics = result.get("metrics")
    if not metrics:
        raise HTTPException(status_code=500, detail="Training returned no metrics")

    ds = storage.create_dataset(db, {
        "name": f"Live Training Data - {datetime.now(timezone.utc).date()}",
        "file_name": "live_data.json",
        "row_count": len(training_rows),
        "column_count": 9,
        "columns": [],
        "status": "uploaded",
        "data_preview": None,
    })

    model = storage.create_ml_model(db, {
        "name": body.name or f"{body.algorithm} (Live) - {datetime.now(timezone.utc).date()}",
        "dataset_id": ds.id,
        "algorithm": body.algorithm,
        "use_case": USE_CASE,
        "status": "trained",
        "accuracy": metrics.get("accuracy"),
        "precision": metrics.get("precision"),
        "recall": metrics.get("recall"),
        "f1_score": metrics.get("f1Score"),
        "auc": metrics.get("auc"),
        "hyperparameters": metrics.get("bestParams") or body.hyperparameters or {},
        "feature_importance": metrics.get("featureImportance") or [],
        "confusion_matrix": metrics.get("confusionMatrix") or {"tp": 0, "fp": 0, "tn": 0, "fn": 0},
        "model_weights": {},
        "is_deployed": False,
        "deployed_at": None,
    })

    precomputed = result.get("latestActivePredictions") or []
    summary = _generate_predictions_for_model(db, model, precomputed if precomputed else None)

    result_dict = {c.name: getattr(model, c.name) for c in model.__table__.columns}
    result_dict["predictionsGenerated"] = summary["predicted"]
    return result_dict


@router.post("/{model_id}/deploy")
def deploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    all_models = storage.get_ml_models(db, use_case=USE_CASE)
    for m in all_models:
        if m.is_deployed:
            storage.update_ml_model(db, m.id, {"is_deployed": False, "deployed_at": None})
    updated = storage.update_ml_model(db, model_id, {"is_deployed": True, "deployed_at": datetime.now(timezone.utc), "status": "deployed"})
    return updated


@router.post("/{model_id}/undeploy")
def undeploy_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {"is_deployed": False, "deployed_at": None, "status": "trained"})
    return updated


@router.post("/{model_id}/approve")
def approve_model(model_id: int, body: ApproveRequest, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    updated = storage.update_ml_model(db, model_id, {
        "approval_status": "approved",
        "approved_by": body.approved_by,
        "approved_at": datetime.now(timezone.utc),
        "approval_notes": body.notes,
    })
    return updated


@router.delete("/{model_id}")
def delete_model(model_id: int, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    storage.delete_ml_model(db, model_id)
    return {"ok": True}


@router.post("/{model_id}/predict-customers")
def predict_customers(model_id: int, body: dict = {}, db: Session = Depends(get_db)):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    prod_dataset_id = body.get("prodDatasetId")
    if prod_dataset_id:
        prod_dataset_id = int(prod_dataset_id)

    summary = _generate_predictions_for_model(db, model, prod_dataset_id=prod_dataset_id)

    # Compute prod AUC/accuracy when a prod dataset was provided
    prod_auc = prod_accuracy = prod_recall = None
    if prod_dataset_id:
        preds = storage.get_predictions(db, model_id)
        prod_ds_check = storage.get_dataset(db, prod_dataset_id)
        if prod_ds_check and preds:
            from services.custom_features import get_dataset_rows as _gdr
            prod_rows_check = _gdr(prod_ds_check)
            first = prod_rows_check[0] if prod_rows_check else {}
            has_labels = "ischurned" in first or "is_churned" in first
            if has_labels:
                lbl_col = "ischurned" if "ischurned" in first else "is_churned"
                custs = storage.get_customers(db)
                acct_map = {c.account_number: c.id for c in custs}
                cid_to_prob = {p["customer_id"]: float(p["churn_probability"]) for p in preds}
                pairs = []
                for row in prod_rows_check:
                    acct = str(row.get("account_number") or "")
                    cid = acct_map.get(acct)
                    prob = cid_to_prob.get(cid) if cid else None
                    if prob is None:
                        continue
                    y = 1 if row.get(lbl_col) in (1, "1", True) else 0
                    pairs.append((y, prob))
                if len(pairs) >= 5:
                    sorted_p = sorted(pairs, key=lambda x: -x[1])
                    pos = sum(y for y, _ in pairs)
                    neg = len(pairs) - pos
                    if pos > 0 and neg > 0:
                        tp = fp = s = pfpr = ptpr = 0.0
                        for y, prob in sorted_p:
                            if y: tp += 1
                            else: fp += 1
                            tpr, fpr = tp / pos, fp / neg
                            s += (fpr - pfpr) * (tpr + ptpr) / 2
                            pfpr, ptpr = fpr, tpr
                        prod_auc = round(s, 4)
                    tp50 = fp50 = tn50 = fn50 = 0
                    for y, prob in pairs:
                        p = 1 if prob >= 0.5 else 0
                        if p == 1 and y == 1: tp50 += 1
                        elif p == 1 and y == 0: fp50 += 1
                        elif p == 0 and y == 0: tn50 += 1
                        else: fn50 += 1
                    prod_accuracy = round((tp50 + tn50) / len(pairs), 4)
                    prod_recall = round(tp50 / max(tp50 + fn50, 1), 4)

    storage.create_audit_log(db, {
        "action": "score", "entity_type": "model", "entity_id": model.id,
        "entity_name": model.name,
        "detail": f"Scored {summary['predicted']} customers — {summary['veryHigh']} very high, {summary['high']} high, {summary['medium']} medium, {summary['low']} low risk",
        "user": "ml-ops-user", "team": "ML Ops", "status": "success",
    })
    return {"modelId": model.id, **summary, "prodAuc": prod_auc, "prodAccuracy": prod_accuracy, "prodRecall": prod_recall}


def _derive_evaluation_month(dataset_name: str, prod_rows: list[dict]) -> str:
    """Derive YYYY-MM evaluation month from dataset name or snapshot_month column."""
    import re as _re
    MONTHS = {
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "may": "05", "jun": "06", "jul": "07", "aug": "08",
        "sep": "09", "oct": "10", "nov": "11", "dec": "12",
        "january": "01", "february": "02", "march": "03", "april": "04",
        "june": "06", "july": "07", "august": "08", "september": "09",
        "october": "10", "november": "11", "december": "12",
    }
    # Try dataset name patterns like "Production_style_data_till_March_2026"
    name_lower = dataset_name.lower().replace("-", "_")
    for month_name, month_num in MONTHS.items():
        pattern = rf"{month_name}[_\s](\d{{4}})|(\d{{4}})[_\s]{month_name}"
        m = _re.search(pattern, name_lower)
        if m:
            year = m.group(1) or m.group(2)
            return f"{year}-{month_num}"
    # Try snapshot_month column values
    snap_vals = [str(r.get("snapshot_month") or r.get("snapshotMonth") or "") for r in prod_rows[:200] if r.get("snapshot_month") or r.get("snapshotMonth")]
    if snap_vals:
        latest = sorted(snap_vals)[-1]
        m2 = _re.match(r"(\d{4})-(\d{2})", latest)
        if m2:
            return f"{m2.group(1)}-{m2.group(2)}"
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _compute_psi(baseline_probs: list[float], prod_probs: list[float], bins: int = 10) -> float:
    """PSI — matches old Express implementation exactly."""
    if not baseline_probs or not prod_probs:
        return 0.0
    train_hist = [0] * bins
    prod_hist  = [0] * bins
    for p in baseline_probs:
        train_hist[min(int(min(0.9999, max(0.0, p)) * bins), bins - 1)] += 1
    for p in prod_probs:
        prod_hist[min(int(min(0.9999, max(0.0, p)) * bins), bins - 1)] += 1
    tn = max(len(baseline_probs), 1)
    n  = max(len(prod_probs), 1)
    psi_sum = 0.0
    for i in range(bins):
        expected = max(train_hist[i] / tn, 1e-4)
        actual   = max(prod_hist[i]  / n,  1e-4)
        psi_sum += (actual - expected) * math.log(actual / expected)
    return round(psi_sum, 4)


def _compute_ks(baseline_probs: list[float], prod_probs: list[float]) -> float:
    """Proper 2-sample KS statistic — matches old Express implementation exactly."""
    if not baseline_probs or not prod_probs:
        return 0.0
    sorted_train = sorted(min(0.9999, max(0.0, p)) for p in baseline_probs)
    sorted_prod  = sorted(min(0.9999, max(0.0, p)) for p in prod_probs)
    n_train, n_prod = len(sorted_train), len(sorted_prod)
    i = j = 0
    max_diff = 0.0
    while i < n_train or j < n_prod:
        next_train = sorted_train[i] if i < n_train else math.inf
        next_prod  = sorted_prod[j]  if j < n_prod  else math.inf
        x = min(next_train, next_prod)
        while i < n_train and sorted_train[i] <= x:
            i += 1
        while j < n_prod  and sorted_prod[j]  <= x:
            j += 1
        diff = abs(i / n_train - j / n_prod)
        if diff > max_diff:
            max_diff = diff
    return round(max_diff, 4)


@router.post("/{model_id}/score-production")
def score_production(model_id: int, body: dict, db: Session = Depends(get_db)):
    import math, re
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    prod_dataset_id = body.get("prodDatasetId")
    if not prod_dataset_id:
        raise HTTPException(status_code=400, detail="prodDatasetId is required")

    prod_dataset_id = int(prod_dataset_id)
    prod_ds = storage.get_dataset(db, prod_dataset_id)
    if not prod_ds:
        raise HTTPException(status_code=404, detail="Production dataset not found")

    train_ds = storage.get_dataset(db, model.dataset_id) if model.dataset_id else None
    if not train_ds:
        raise HTTPException(status_code=400, detail="Model has no training dataset")

    custom_features = get_model_custom_features(model, train_ds)
    train_rows = get_dataset_rows(train_ds)
    train_rows = apply_custom_features(train_rows, custom_features) if custom_features else train_rows

    prod_rows = get_dataset_rows(prod_ds)
    prod_rows = apply_custom_features(prod_rows, custom_features) if custom_features else prod_rows

    if not train_rows:
        raise HTTPException(status_code=400, detail="Training dataset has no data")

    stored_algo = model.algorithm or "Random Forest"
    auto_match = re.match(r"^Auto\s*\((.+)\)$", stored_algo, re.IGNORECASE)
    python_algorithm = auto_match.group(1) if auto_match else ALGORITHM_MAP.get(stored_algo, stored_algo)
    hyperparameters = model.hyperparameters if isinstance(model.hyperparameters, dict) else None
    custom_feature_names = [f["name"] for f in custom_features] if custom_features else []

    result = run_train_model(
        data=train_rows,
        target_column="isChurned",
        algorithm=python_algorithm,
        hyperparameters=hyperparameters,
        custom_feature_names=custom_feature_names,
        score_prod_data=prod_rows,
    )

    precomputed = result.get("latestActivePredictions") or []
    summary = _generate_predictions_for_model(db, model, precomputed if precomputed else None)
    prod_metrics = result.get("metrics") or {}

    # Build evaluation run snapshot
    prod_probs = [float(p.get("churnProbability", p.get("churn_probability", 0.5))) for p in precomputed]

    # Risk distribution from production predictions
    very_high_n = sum(1 for p in prod_probs if p >= 0.85)
    high_n = sum(1 for p in prod_probs if 0.70 <= p < 0.85)
    med_n = sum(1 for p in prod_probs if 0.50 <= p < 0.70)
    low_n = sum(1 for p in prod_probs if p < 0.50)
    total_prod = max(len(prod_probs), 1)
    high_risk_pct = round((very_high_n + high_n) / total_prod * 100, 1)
    med_risk_pct = round(med_n / total_prod * 100, 1)
    low_risk_pct = round(100 - high_risk_pct - med_risk_pct, 1)

    # Score histogram (10 buckets: 0-10%, 10-20%, ...)
    buckets = [0] * 10
    for p in prod_probs:
        buckets[min(int(p * 10), 9)] += 1
    score_histogram = [
        {"bucket": f"{i*10}-{(i+1)*10}%", "count": buckets[i], "pct": round(buckets[i] / total_prod * 100, 1)}
        for i in range(10)
    ]

    # Baseline = existing predictions for this model
    existing_preds = storage.get_predictions(db)
    baseline_probs = [float(p.get("churn_probability", 0.5)) for p in existing_preds if p.get("model_id") == model_id]

    # PSI and KS — proper formulas matching old Express implementation
    psi_val = _compute_psi(baseline_probs, prod_probs) if baseline_probs else 0.0
    ks_val  = _compute_ks(baseline_probs,  prod_probs) if baseline_probs else 0.0

    # Labels check (does prod data have churn labels?)
    target_col = next((c for c in ["is_churned", "isChurned", "churned", "label"] if prod_rows and c in prod_rows[0]), None)
    has_labels = target_col is not None
    positive_count = None
    negative_count = None
    if has_labels and prod_rows:
        pos = sum(1 for r in prod_rows if r.get(target_col) in (1, "1", True, "true"))
        positive_count = pos
        negative_count = len(prod_rows) - pos

    # Top feature SHAP summary from model feature importance
    fi = model.feature_importance or []
    top_shap = sorted(fi, key=lambda x: abs(x.get("importance", 0)), reverse=True)[:6]
    top_feature_shap_summary = [
        {"feature": f.get("feature", f"f{i}"), "avgShap": round(float(f.get("importance", 0)), 4), "freq": total_prod, "freqPct": 100.0}
        for i, f in enumerate(top_shap)
    ]

    # Evaluation month
    evaluation_month = _derive_evaluation_month(prod_ds.name, prod_rows)

    # Persist evaluation run
    storage.create_model_evaluation_run(db, {
        "model_id": model_id,
        "dataset_id": prod_dataset_id,
        "evaluation_month": evaluation_month,
        "auc": prod_metrics.get("auc"),
        "accuracy": prod_metrics.get("accuracy"),
        "recall": prod_metrics.get("recall"),
        "precision": prod_metrics.get("precision"),
        "f1_score": prod_metrics.get("f1Score"),
        "ks": ks_val,
        "psi": psi_val,
        "positive_count": positive_count,
        "negative_count": negative_count,
        "row_count": len(prod_rows),
        "high_risk_pct": high_risk_pct,
        "med_risk_pct": med_risk_pct,
        "low_risk_pct": low_risk_pct,
        "score_histogram": score_histogram,
        "top_feature_shap_summary": top_feature_shap_summary,
        "has_labels": has_labels,
    })

    # Return matches old Express response shape exactly
    return {
        "modelId": model.id,
        **summary,
        "evaluationMonth": evaluation_month,
        "predicted": summary.get("predicted", total_prod),
        "veryHigh":    summary.get("veryHigh", 0),
        "high":        summary.get("high", 0),
        "medium":      summary.get("medium", 0),
        "low":         summary.get("low", 0),
        "highRiskPct": high_risk_pct,
        "medRiskPct":  med_risk_pct,
        "lowRiskPct":  low_risk_pct,
        "psi":              psi_val,
        "ks":               ks_val,
        "scoreHistogram":   score_histogram,
        "topFeatureShapSummary": top_feature_shap_summary,
        "metrics": {
            "auc":       prod_metrics.get("auc"),
            "accuracy":  prod_metrics.get("accuracy"),
            "recall":    prod_metrics.get("recall"),
            "precision": prod_metrics.get("precision"),
            "f1Score":   prod_metrics.get("f1Score"),
        },
    }
