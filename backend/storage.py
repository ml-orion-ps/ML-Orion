from __future__ import annotations
from typing import Any, Optional
from sqlalchemy import text, func, case, and_
from sqlalchemy.orm import Session
from models import Customer, ChurnEvent, Dataset, MlModel, Prediction, Recommendation, AuditLog, ModelEvaluationRun


# ── Customers ─────────────────────────────────────────────────────────────────

def get_customers(db: Session) -> list[Customer]:
    return db.query(Customer).order_by(Customer.churn_risk_score.desc().nullslast()).all()


def get_customer(db: Session, customer_id: int) -> Optional[Customer]:
    return db.query(Customer).filter(Customer.id == customer_id).first()


def get_customer_by_account(db: Session, account_number: str) -> Optional[Customer]:
    return db.query(Customer).filter(Customer.account_number == account_number).first()


def create_customer(db: Session, data: dict) -> Customer:
    customer = Customer(**data)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


def upsert_customer(db: Session, data: dict) -> Customer:
    existing = get_customer_by_account(db, data["account_number"])
    if existing:
        for k, v in data.items():
            if k != "account_number":
                setattr(existing, k, v)
        db.commit()
        db.refresh(existing)
        return existing
    return create_customer(db, data)


def update_customer(db: Session, customer_id: int, data: dict) -> Optional[Customer]:
    customer = get_customer(db, customer_id)
    if not customer:
        return None
    for k, v in data.items():
        setattr(customer, k, v)
    db.commit()
    db.refresh(customer)
    return customer


def get_customer_count(db: Session) -> int:
    return db.query(func.count(Customer.id)).scalar() or 0


# ── ChurnEvents ───────────────────────────────────────────────────────────────

def get_churn_events(db: Session) -> list[ChurnEvent]:
    return db.query(ChurnEvent).order_by(ChurnEvent.churn_date.desc()).all()


def create_churn_event(db: Session, data: dict) -> ChurnEvent:
    event = ChurnEvent(**data)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ── Datasets ──────────────────────────────────────────────────────────────────

def get_datasets(db: Session) -> list[Dataset]:
    return db.query(Dataset).order_by(Dataset.uploaded_at.desc()).all()


def get_dataset(db: Session, dataset_id: int) -> Optional[Dataset]:
    return db.query(Dataset).filter(Dataset.id == dataset_id).first()


def create_dataset(db: Session, data: dict) -> Dataset:
    dataset = Dataset(**data)
    db.add(dataset)
    db.commit()
    db.refresh(dataset)
    return dataset


def update_dataset(db: Session, dataset_id: int, data: dict) -> Optional[Dataset]:
    dataset = get_dataset(db, dataset_id)
    if not dataset:
        return None
    for k, v in data.items():
        setattr(dataset, k, v)
    db.commit()
    db.refresh(dataset)
    return dataset


def delete_dataset(db: Session, dataset_id: int) -> None:
    dataset = get_dataset(db, dataset_id)
    if dataset:
        db.delete(dataset)
        db.commit()


# ── MlModels ──────────────────────────────────────────────────────────────────

def get_ml_models(db: Session) -> list[MlModel]:
    return db.query(MlModel).order_by(MlModel.trained_at.desc()).all()


def get_ml_model(db: Session, model_id: int) -> Optional[MlModel]:
    return db.query(MlModel).filter(MlModel.id == model_id).first()


def create_ml_model(db: Session, data: dict) -> MlModel:
    model = MlModel(**data)
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def update_ml_model(db: Session, model_id: int, data: dict) -> Optional[MlModel]:
    model = get_ml_model(db, model_id)
    if not model:
        return None
    for k, v in data.items():
        setattr(model, k, v)
    db.commit()
    db.refresh(model)
    return model


def delete_ml_model(db: Session, model_id: int) -> None:
    db.query(Prediction).filter(Prediction.model_id == model_id).delete()
    db.query(MlModel).filter(MlModel.id == model_id).delete()
    db.commit()


# ── Predictions ───────────────────────────────────────────────────────────────

def get_predictions(db: Session, model_id: Optional[int] = None) -> list[dict]:
    q = (
        db.query(
            Prediction.id,
            Prediction.model_id,
            Prediction.customer_id,
            Prediction.churn_probability,
            Prediction.risk_category,
            Prediction.top_drivers,
            Prediction.recommended_action,
            Prediction.action_category,
            Prediction.predicted_at,
            Customer.account_number,
        )
        .join(Customer, Prediction.customer_id == Customer.id)
    )
    if model_id:
        q = q.filter(Prediction.model_id == model_id)
    q = q.order_by(Prediction.churn_probability.desc(), Prediction.predicted_at.desc())
    rows = q.all()
    keys = ["id", "model_id", "customer_id", "churn_probability", "risk_category",
            "top_drivers", "recommended_action", "action_category", "predicted_at", "account_number"]
    return [dict(zip(keys, r)) for r in rows]


def clear_predictions_by_model(db: Session, model_id: int) -> None:
    pred_ids = [p.id for p in db.query(Prediction.id).filter(Prediction.model_id == model_id).all()]
    if pred_ids:
        db.query(Recommendation).filter(Recommendation.prediction_id.in_(pred_ids)).delete(synchronize_session=False)
    db.query(Prediction).filter(Prediction.model_id == model_id).delete()
    db.commit()


def clear_all_predictions(db: Session) -> None:
    pred_ids = [p.id for p in db.query(Prediction.id).all()]
    if pred_ids:
        db.query(Recommendation).filter(Recommendation.prediction_id.in_(pred_ids)).delete(synchronize_session=False)
    db.query(Prediction).delete()
    db.commit()


def create_prediction(db: Session, data: dict) -> Prediction:
    pred = Prediction(**data)
    db.add(pred)
    db.commit()
    db.refresh(pred)
    return pred


def bulk_create_predictions(db: Session, records: list[dict]) -> int:
    db.bulk_insert_mappings(Prediction, records)
    db.commit()
    return len(records)


# ── Recommendations ───────────────────────────────────────────────────────────

def get_recommendations(db: Session, customer_id: Optional[int] = None) -> list[Recommendation]:
    q = db.query(Recommendation)
    if customer_id:
        q = q.filter(Recommendation.customer_id == customer_id)
    else:
        q = q.order_by(Recommendation.created_at.desc())
    return q.all()


def create_recommendation(db: Session, data: dict) -> Recommendation:
    rec = Recommendation(**data)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


def bulk_create_recommendations(db: Session, records: list[dict]) -> None:
    db.bulk_insert_mappings(Recommendation, records)
    db.commit()


def update_recommendation(db: Session, rec_id: int, data: dict) -> Optional[Recommendation]:
    rec = db.query(Recommendation).filter(Recommendation.id == rec_id).first()
    if not rec:
        return None
    for k, v in data.items():
        if v is not None:
            setattr(rec, k, v)
    db.commit()
    db.refresh(rec)
    return rec


# ── AuditLog ──────────────────────────────────────────────────────────────────

def get_audit_log(db: Session, limit: int = 200) -> list[AuditLog]:
    return db.query(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit).all()


def create_audit_log(db: Session, data: dict) -> AuditLog:
    entry = AuditLog(**data)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


# ── ModelEvaluationRuns ───────────────────────────────────────────────────────

def create_model_evaluation_run(db: Session, data: dict) -> ModelEvaluationRun:
    existing = db.query(ModelEvaluationRun).filter(
        ModelEvaluationRun.model_id == data["model_id"],
        ModelEvaluationRun.evaluation_month == data.get("evaluation_month"),
    ).first()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        db.commit()
        db.refresh(existing)
        return existing
    run = ModelEvaluationRun(**data)
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_model_evaluation_runs(db: Session, model_id: int) -> list[ModelEvaluationRun]:
    return db.query(ModelEvaluationRun).filter(
        ModelEvaluationRun.model_id == model_id
    ).order_by(ModelEvaluationRun.evaluation_month).all()


# ── Analytics ─────────────────────────────────────────────────────────────────

def get_churn_analytics(db: Session) -> dict:
    custs = db.query(Customer).all()
    total = len(custs)
    churned = [c for c in custs if c.is_churned]
    active = [c for c in custs if not c.is_churned]
    at_risk = [c for c in active if (c.churn_risk_score or 0) > 0.6]

    avg_rev = sum(c.monthly_revenue for c in active) / max(len(active), 1)
    total_rev = sum(c.monthly_revenue for c in active)
    rev_at_risk = sum(c.monthly_revenue for c in at_risk)

    risk_dist: dict[str, int] = {}
    for c in active:
        cat = c.churn_risk_category or "Unknown"
        risk_dist[cat] = risk_dist.get(cat, 0) + 1
    risk_distribution = [{"category": k, "count": v} for k, v in risk_dist.items()]

    region_groups: dict[str, dict] = {}
    for c in custs:
        r = c.region or "Unknown"
        if r not in region_groups:
            region_groups[r] = {"total": 0, "churned": 0}
        region_groups[r]["total"] += 1
        if c.is_churned:
            region_groups[r]["churned"] += 1
    region_churn = [{"region": k, **v} for k, v in region_groups.items()]

    reason_counts: dict[str, int] = {}
    for c in churned:
        r = c.churn_reason or "Unknown"
        reason_counts[r] = reason_counts.get(r, 0) + 1
    churn_by_reason = [{"reason": k, "count": v} for k, v in reason_counts.items()]

    tenure_buckets = [
        ("0-12 months", 0, 12),
        ("12-24 months", 12, 24),
        ("24-48 months", 24, 48),
        ("48+ months", 48, 9999),
    ]
    churn_by_tenure = []
    for label, lo, hi in tenure_buckets:
        bucket = [c for c in custs if lo <= (c.tenure_months or 0) < hi]
        churned_b = [c for c in bucket if c.is_churned]
        churn_by_tenure.append({"bucket": label, "total": len(bucket), "churned": len(churned_b)})

    monthly: dict[str, dict] = {}
    for c in churned:
        if c.churn_date:
            key = c.churn_date.strftime("%Y-%m")
            if key not in monthly:
                monthly[key] = {"count": 0, "revenue": 0.0}
            monthly[key]["count"] += 1
            monthly[key]["revenue"] += c.monthly_revenue or 0
    monthly_churn_trend = [{"month": k, **v} for k, v in sorted(monthly.items())]

    return {
        "totalCustomers": total,
        "churnedCustomers": len(churned),
        "activeCustomers": len(active),
        "churnRate": round(len(churned) / max(total, 1) * 100, 1),
        "avgMonthlyRevenue": round(avg_rev, 2),
        "totalActiveRevenue": round(total_rev, 2),
        "revenueAtRisk": round(rev_at_risk, 2),
        "riskDistribution": risk_distribution,
        "regionChurn": region_churn,
        "churnByReason": churn_by_reason,
        "churnByTenure": churn_by_tenure,
        "monthlyChurnTrend": monthly_churn_trend,
    }


def get_segment_analytics(db: Session) -> dict:
    custs = db.query(Customer).all()

    def segment_group(key_fn):
        groups: dict[str, dict] = {}
        for c in custs:
            k = str(key_fn(c) or "Unknown")
            if k not in groups:
                groups[k] = {"total": 0, "churned": 0, "rev_sum": 0.0}
            groups[k]["total"] += 1
            groups[k]["rev_sum"] += c.monthly_revenue or 0
            if c.is_churned:
                groups[k]["churned"] += 1
        return groups

    def to_list(g: dict, key_name: str):
        return [
            {
                key_name: k,
                "total": v["total"],
                "churned": v["churned"],
                "avgRevenue": round(v["rev_sum"] / max(v["total"], 1), 2),
                "avgRisk": 0,
            }
            for k, v in g.items()
        ]

    by_value_tier = to_list(segment_group(lambda c: c.value_tier), "tier")
    by_contract = [
        {"status": k, "total": v["total"], "churned": v["churned"]}
        for k, v in segment_group(lambda c: c.contract_status).items()
    ]
    by_bundle = [
        {"bundle": k, "total": v["total"], "churned": v["churned"]}
        for k, v in segment_group(lambda c: c.bundle_type).items()
    ]

    def bool_group(attr):
        groups = {True: {"total": 0, "churned": 0}, False: {"total": 0, "churned": 0}}
        for c in custs:
            val = bool(getattr(c, attr, False))
            groups[val]["total"] += 1
            if c.is_churned:
                groups[val]["churned"] += 1
        return [{"value": k, **v} for k, v in groups.items()]

    return {
        "byValueTier": by_value_tier,
        "byContractStatus": by_contract,
        "byBundleType": by_bundle,
        "fiberImpact": bool_group("fiber_available"),
        "competitorImpact": bool_group("competitor_available"),
    }


def get_command_center_data(db: Session) -> dict:
    custs = db.query(Customer).all()
    recs = db.query(Recommendation).all()
    total = len(custs)
    churned = [c for c in custs if c.is_churned]
    active = [c for c in custs if not c.is_churned]
    at_risk = [c for c in active if (c.churn_risk_score or 0) > 0.6]
    fiber_exposed = [c for c in active if c.fiber_available]

    running = [r for r in recs if r.status == "in_progress"]
    completed = [r for r in recs if r.status == "completed"]
    saved = [r for r in completed if r.outcome == "retained"]
    retention_rate = len(saved) / max(len(completed), 1) * 100

    rev_at_risk = sum(c.monthly_revenue or 0 for c in at_risk) * 12

    risk_dist = {"low": 0, "medium": 0, "high": 0}
    for c in active:
        s = c.churn_risk_score or 0
        if s > 0.6:
            risk_dist["high"] += 1
        elif s > 0.3:
            risk_dist["medium"] += 1
        else:
            risk_dist["low"] += 1

    monthly: dict[str, dict] = {}
    for c in churned:
        if c.churn_date:
            key = c.churn_date.strftime("%Y-%m")
            if key not in monthly:
                monthly[key] = {"count": 0, "revenue": 0.0}
            monthly[key]["count"] += 1
            monthly[key]["revenue"] += c.monthly_revenue or 0
    monthly_trend = [{"month": k, **v} for k, v in sorted(monthly.items())]

    reason_counts: dict[str, int] = {}
    for c in churned:
        r = c.churn_reason or "Unknown"
        reason_counts[r] = reason_counts.get(r, 0) + 1
    top_drivers = [
        {"driver": d, "count": cnt, "percent": round(cnt / max(len(churned), 1) * 100, 1)}
        for d, cnt in sorted(reason_counts.items(), key=lambda x: -x[1])[:5]
    ]

    seg_risk: dict[str, dict] = {}
    for c in active:
        tier = c.value_tier or "Unknown"
        if tier not in seg_risk:
            seg_risk[tier] = {"total": 0, "atRisk": 0}
        seg_risk[tier]["total"] += 1
        if (c.churn_risk_score or 0) > 0.6:
            seg_risk[tier]["atRisk"] += 1
    top_segments = [
        {"segment": k, **v, "percent": round(v["atRisk"] / max(v["total"], 1) * 100, 1)}
        for k, v in sorted(seg_risk.items(), key=lambda x: -x[1]["atRisk"])[:5]
    ]

    region_alerts: list[dict] = []
    region_groups: dict[str, dict] = {}
    for c in custs:
        r = c.region or "Unknown"
        if r not in region_groups:
            region_groups[r] = {"fiber": 0, "outages": 0, "total": 0, "churned": 0}
        region_groups[r]["total"] += 1
        if c.fiber_available:
            region_groups[r]["fiber"] += 1
        region_groups[r]["outages"] += c.outage_count or 0
        if c.is_churned:
            region_groups[r]["churned"] += 1
    for region, d in region_groups.items():
        fiber_pct = d["fiber"] / max(d["total"], 1) * 100
        churn_pct = d["churned"] / max(d["total"], 1) * 100
        if fiber_pct > 40:
            region_alerts.append({"type": "fiber_rollout", "region": region, "message": f"Fiber rollout in {region} — {fiber_pct:.0f}% exposure", "severity": "high"})
        if d["outages"] / max(d["total"], 1) > 3:
            region_alerts.append({"type": "outages", "region": region, "message": f"High outage frequency in {region}", "severity": "medium"})
        if churn_pct > 35:
            region_alerts.append({"type": "churn_spike", "region": region, "message": f"Elevated churn rate in {region} ({churn_pct:.0f}%)", "severity": "high"})

    return {
        "kpis": {
            "totalCustomers": total,
            "activeCustomers": len(active),
            "churnRate": round(len(churned) / max(total, 1) * 100, 1),
            "revenueAtRisk": round(rev_at_risk),
            "customersAtRisk": len(at_risk),
            "retentionSuccessRate": round(retention_rate, 1),
            "saveActionsRunning": len(running),
            "fiberCompetitionExposure": round(len(fiber_exposed) / max(len(active), 1) * 100, 1),
        },
        "riskDistribution": risk_dist,
        "monthlyChurnTrend": monthly_trend,
        "topDrivers": top_drivers,
        "topSegments": top_segments,
        "riskAlerts": region_alerts[:5],
    }


def get_churn_diagnostics(db: Session) -> dict:
    custs = db.query(Customer).all()
    churned = [c for c in custs if c.is_churned]
    active = [c for c in custs if not c.is_churned]

    monthly: dict[str, dict] = {}
    for c in churned:
        if c.churn_date:
            key = c.churn_date.strftime("%Y-%m")
            if key not in monthly:
                monthly[key] = {"count": 0, "revenue": 0.0}
            monthly[key]["count"] += 1
            monthly[key]["revenue"] += c.monthly_revenue or 0
    monthly_trend = [{"month": k, **v} for k, v in sorted(monthly.items())]

    tenure_buckets = [
        ("0-6 mo", 0, 6), ("6-12 mo", 6, 12), ("12-24 mo", 12, 24),
        ("24-48 mo", 24, 48), ("48+ mo", 48, 9999),
    ]
    tenure_cohorts = []
    for label, lo, hi in tenure_buckets:
        bucket = [c for c in custs if lo <= (c.tenure_months or 0) < hi]
        churned_b = [c for c in bucket if c.is_churned]
        churn_rate = len(churned_b) / max(len(bucket), 1) * 100
        tenure_cohorts.append({
            "bucket": label, "total": len(bucket), "churned": len(churned_b),
            "retentionRate": round(100 - churn_rate, 1), "churnRate": round(churn_rate, 1),
        })

    def group_and_count(field: str):
        groups: dict[str, dict] = {}
        for c in custs:
            k = str(getattr(c, field, None) or "Unknown")
            if k not in groups:
                groups[k] = {"total": 0, "churned": 0, "rev_sum": 0.0}
            groups[k]["total"] += 1
            groups[k]["rev_sum"] += c.monthly_revenue or 0
            if c.is_churned:
                groups[k]["churned"] += 1
        return [
            {"name": k, "total": v["total"], "churned": v["churned"],
             "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1),
             "avgRevenue": round(v["rev_sum"] / max(v["total"], 1))}
            for k, v in groups.items()
        ]

    fiber_zone = [c for c in custs if c.fiber_available]
    non_fiber = [c for c in custs if not c.fiber_available]

    def churn_rate_for(lst):
        ch = [c for c in lst if c.is_churned]
        return round(len(ch) / max(len(lst), 1) * 100, 1)

    segment_comparisons = {
        "fiberVsNonFiber": {
            "fiber": {"total": len(fiber_zone), "churned": len([c for c in fiber_zone if c.is_churned]), "churnRate": churn_rate_for(fiber_zone)},
            "nonFiber": {"total": len(non_fiber), "churned": len([c for c in non_fiber if c.is_churned]), "churnRate": churn_rate_for(non_fiber)},
        }
    }

    total_ch = len(churned) or 1
    driver_contributions = [
        {"driver": "Fiber Competition", "count": sum(1 for c in churned if c.fiber_available)},
        {"driver": "Service Quality", "count": sum(1 for c in churned if (c.outage_count or 0) > 3 or (c.nps_score or 10) < 5)},
        {"driver": "Pricing", "count": sum(1 for c in churned if c.churn_reason and ("price" in c.churn_reason.lower() or "cost" in c.churn_reason.lower()))},
        {"driver": "Technology Gap", "count": sum(1 for c in churned if c.churn_reason and ("speed" in c.churn_reason.lower() or "technology" in c.churn_reason.lower()))},
        {"driver": "Competitor Presence", "count": sum(1 for c in churned if c.competitor_available)},
        {"driver": "Contract Status", "count": sum(1 for c in churned if c.contract_status == "month-to-month")},
    ]
    total_counts = sum(d["count"] for d in driver_contributions) or 1
    for d in driver_contributions:
        d["percent"] = round(d["count"] / total_counts * 100, 1)
    driver_contributions.sort(key=lambda x: -x["percent"])

    rev_by_reason: dict[str, float] = {}
    rev_by_segment: dict[str, float] = {}
    rev_by_region: dict[str, float] = {}
    for c in churned:
        ann = (c.monthly_revenue or 0) * 12
        rev_by_reason[c.churn_reason or "Unknown"] = rev_by_reason.get(c.churn_reason or "Unknown", 0) + ann
        rev_by_segment[c.value_tier or "Unknown"] = rev_by_segment.get(c.value_tier or "Unknown", 0) + ann
        rev_by_region[c.region or "Unknown"] = rev_by_region.get(c.region or "Unknown", 0) + ann

    total_rev_lost = sum(rev_by_reason.values())

    def to_arr(d: dict):
        return [{"name": k, "value": round(v)} for k, v in sorted(d.items(), key=lambda x: -x[1])]

    return {
        "patterns": {"monthlyTrend": monthly_trend, "tenureCohorts": tenure_cohorts},
        "segments": {
            "byValueTier": group_and_count("value_tier"),
            "byBundle": group_and_count("bundle_type"),
            "byRegion": group_and_count("region"),
            "byContract": group_and_count("contract_status"),
            "segmentComparisons": segment_comparisons,
        },
        "drivers": {
            "contributions": driver_contributions,
            "byRegion": [
                {
                    "name": region,
                    "churnRate": round(len([c for c in grp if c.is_churned]) / max(len(grp), 1) * 100, 1),
                    "fiberImpact": round(len([c for c in grp if c.is_churned and c.fiber_available]) / max(len([c for c in grp if c.is_churned]), 1) * 100, 1),
                    "qualityImpact": round(len([c for c in grp if c.is_churned and (c.outage_count or 0) > 3]) / max(len([c for c in grp if c.is_churned]), 1) * 100, 1),
                }
                for region, grp in {
                    r: [c for c in custs if (c.region or "Unknown") == r]
                    for r in set(c.region or "Unknown" for c in custs)
                }.items()
            ],
            "bySegment": [
                {
                    "name": tier,
                    "churnRate": round(len([c for c in grp if c.is_churned]) / max(len(grp), 1) * 100, 1),
                    "fiberImpact": round(len([c for c in grp if c.is_churned and c.fiber_available]) / max(len([c for c in grp if c.is_churned]), 1) * 100, 1),
                    "qualityImpact": round(len([c for c in grp if c.is_churned and (c.outage_count or 0) > 3]) / max(len([c for c in grp if c.is_churned]), 1) * 100, 1),
                }
                for tier, grp in {
                    t: [c for c in custs if (c.value_tier or "Unknown") == t]
                    for t in set(c.value_tier or "Unknown" for c in custs)
                }.items()
            ],
        },
        "financialImpact": {
            "revenueLostByReason": to_arr(rev_by_reason),
            "revenueLostBySegment": to_arr(rev_by_segment),
            "revenueLostByRegion": to_arr(rev_by_region),
            "kpis": {
                "totalAnnualRevenueLost": round(total_rev_lost),
                "avgRevenuePerChurned": round(total_rev_lost / max(len(churned), 1)),
                "revenueAtRisk": round(sum((c.monthly_revenue or 0) * 12 for c in active if (c.churn_risk_score or 0) > 0.6)),
            },
        },
    }


def get_risk_intelligence(db: Session) -> dict:
    custs = db.query(Customer).all()
    active = [c for c in custs if not c.is_churned]

    def cat(score: float) -> str:
        if score > 0.6:
            return "high"
        if score > 0.3:
            return "medium"
        return "low"

    risk_dist = {"low": 0, "medium": 0, "high": 0}
    for c in active:
        risk_dist[cat(c.churn_risk_score or 0)] += 1

    risk_by_region: dict[str, dict] = {}
    for c in active:
        r = c.region or "Unknown"
        if r not in risk_by_region:
            risk_by_region[r] = {"low": 0, "medium": 0, "high": 0}
        risk_by_region[r][cat(c.churn_risk_score or 0)] += 1
    risk_by_region_list = [{"region": k, **v} for k, v in risk_by_region.items()]

    def tenure_label(t: int) -> str:
        if t < 12:
            return "0-12 mo"
        if t < 24:
            return "12-24 mo"
        if t < 48:
            return "24-48 mo"
        return "48+ mo"

    risk_by_tenure: dict[str, dict] = {}
    for c in active:
        b = tenure_label(c.tenure_months or 0)
        if b not in risk_by_tenure:
            risk_by_tenure[b] = {"low": 0, "medium": 0, "high": 0, "total": 0}
        risk_by_tenure[b][cat(c.churn_risk_score or 0)] += 1
        risk_by_tenure[b]["total"] += 1
    risk_by_tenure_list = [{"tenure": k, **v} for k, v in risk_by_tenure.items()]

    prob_edges = [i / 10 for i in range(11)]
    prob_curve = []
    for i in range(len(prob_edges) - 1):
        lo, hi = prob_edges[i], prob_edges[i + 1]
        bucket = [c for c in active if lo <= (c.churn_risk_score or 0) < hi]
        avg_rev = sum(c.monthly_revenue or 0 for c in bucket) / max(len(bucket), 1)
        prob_curve.append({"range": f"{int(lo*100)}-{int(hi*100)}%", "count": len(bucket), "avgRevenue": round(avg_rev)})

    early_warnings = []
    for c in sorted([c for c in active if (c.churn_risk_score or 0) > 0.5], key=lambda c: -(c.churn_risk_score or 0))[:20]:
        signals = []
        if c.fiber_available:
            signals.append("Fiber competitor present")
        if (c.outage_count or 0) > 3:
            signals.append(f"{c.outage_count} outages recorded")
        if (c.nps_score or 10) < 5:
            signals.append(f"Low NPS score ({c.nps_score})")
        if c.contract_status == "month-to-month":
            signals.append("Month-to-month contract")
        if (c.ticket_count or 0) > 5:
            signals.append(f"High ticket volume ({c.ticket_count})")
        early_warnings.append({
            "id": c.id, "name": c.name, "accountNumber": c.account_number,
            "riskScore": c.churn_risk_score, "revenue": c.monthly_revenue,
            "region": c.region, "signals": signals,
        })

    return {
        "riskDistribution": risk_dist,
        "riskByRegion": risk_by_region_list,
        "riskByTenure": risk_by_tenure_list,
        "probabilityCurve": prob_curve,
        "earlyWarnings": early_warnings,
    }


def get_retention_data(db: Session) -> dict:
    recs = db.query(Recommendation).all()
    custs = db.query(Customer).all()
    cust_map = {c.id: c for c in custs}

    ACTION_COST = {
        "Discount Offer": 50, "Loyalty Plan": 100, "Proactive Call": 15,
        "Tech Support": 30, "Service Upgrade": 80, "Retention Offer": 60,
    }

    enriched = []
    for r in recs:
        c = cust_map.get(r.customer_id)
        risk = c.churn_risk_score if c else 0
        enriched.append({
            "id": r.id, "customer_id": r.customer_id, "action_type": r.action_type,
            "priority": r.priority, "status": r.status, "outcome": r.outcome,
            "estimated_impact": r.estimated_impact, "estimated_cost": r.estimated_cost,
            "assigned_to": r.assigned_to, "notes": r.notes,
            "created_at": r.created_at, "executed_at": r.executed_at,
            "prediction_id": r.prediction_id,
            "customerName": c.name if c else "Unknown",
            "customerRegion": c.region if c else "Unknown",
            "customerRevenue": c.monthly_revenue if c else 0,
            "riskScore": risk or 0,
            "roi": round((r.estimated_impact or 0) / max(r.estimated_cost or 1, 1), 1),
        })

    completed = [r for r in enriched if r["status"] == "completed"]
    saved = [r for r in completed if r["outcome"] == "retained"]
    high_risk_pending = [r for r in enriched if r["status"] == "pending" and r["riskScore"] > 0.6]

    total_impact = round(sum(
        (cust_map[r["customer_id"]].monthly_revenue or 0) * 12
        for r in saved if r["customer_id"] in cust_map
    ))
    total_cost = round(sum(ACTION_COST.get(r["action_type"], r["estimated_cost"] or 30) for r in completed))

    res_days_list = [
        (r["executed_at"] - r["created_at"]).total_seconds() / 86400
        for r in completed if r["executed_at"] and r["created_at"]
    ]
    avg_res_days = round(sum(res_days_list) / max(len(res_days_list), 1), 1)

    return {
        "recommendedActions": sorted(enriched, key=lambda x: -x["riskScore"])[:50],
        "queue": {
            "pending": high_risk_pending,
            "inProgress": [r for r in enriched if r["status"] == "in_progress"],
            "completed": completed,
            "declined": [r for r in enriched if r["status"] == "declined"],
        },
        "tracker": {
            "actionsTriggered": len(set(r["customer_id"] for r in recs)),
            "actionsExecuted": len(completed),
            "saveSuccessRate": round(len(saved) / max(len(completed), 1) * 100, 1),
            "avgResolutionDays": avg_res_days,
            "totalCostSpent": total_cost,
            "totalImpactGenerated": total_impact,
        },
    }


def get_business_impact(db: Session) -> dict:
    recs = db.query(Recommendation).all()
    custs = db.query(Customer).all()
    cust_map = {c.id: c for c in custs}
    active = [c for c in custs if not c.is_churned]

    completed = [r for r in recs if r.status == "completed"]
    saved = [r for r in completed if r.outcome == "retained"]

    rev_protected = sum(r.estimated_impact or 0 for r in saved)
    intervention_cost = sum(r.estimated_cost or 0 for r in completed)
    roi_multiple = round(rev_protected / max(intervention_cost, 1), 1)

    by_action: dict[str, dict] = {}
    for r in completed:
        t = r.action_type or "Other"
        if t not in by_action:
            by_action[t] = {"count": 0, "cost": 0.0, "impact": 0.0, "saved": 0}
        by_action[t]["count"] += 1
        by_action[t]["cost"] += r.estimated_cost or 0
        if r.outcome == "retained":
            by_action[t]["impact"] += r.estimated_impact or 0
            by_action[t]["saved"] += 1

    roi_by_action = [
        {"action": k, "count": v["count"], "cost": round(v["cost"]), "impact": round(v["impact"]),
         "roi": round(v["impact"] / max(v["cost"], 1), 1),
         "successRate": round(v["saved"] / max(v["count"], 1) * 100, 1)}
        for k, v in by_action.items()
    ]

    saved_by_seg: dict[str, float] = {}
    saved_by_reg: dict[str, float] = {}
    for r in saved:
        c = cust_map.get(r.customer_id)
        if c:
            seg = c.value_tier or "Unknown"
            reg = c.region or "Unknown"
            saved_by_seg[seg] = saved_by_seg.get(seg, 0) + (r.estimated_impact or 0)
            saved_by_reg[reg] = saved_by_reg.get(reg, 0) + (r.estimated_impact or 0)

    fiber_eligible = [c for c in active if c.fiber_available]
    migration_rev = sum(c.monthly_revenue or 0 for c in fiber_eligible) * 12

    def to_arr(d: dict):
        return [{"name": k, "value": round(v)} for k, v in sorted(d.items(), key=lambda x: -x[1])]

    return {
        "revenueProtection": {
            "revenueProtected": round(rev_protected),
            "interventionCost": round(intervention_cost),
            "roiMultiple": roi_multiple,
            "savedBySegment": to_arr(saved_by_seg),
            "savedByRegion": to_arr(saved_by_reg),
        },
        "roiByAction": roi_by_action,
        "migrationEconomics": {
            "fiberEligibleCustomers": len(fiber_eligible),
            "migrationPotentialRevenue": round(migration_rev),
            "avgRevenuePerMigration": round(migration_rev / max(len(fiber_eligible), 1)),
            "currentChurnInFiberZones": round(sum(1 for c in fiber_eligible if (c.churn_risk_score or 0) > 0.6) / max(len(fiber_eligible), 1) * 100, 1),
        },
    }


def get_strategy_insights(db: Session) -> dict:
    custs = db.query(Customer).all()
    active = [c for c in custs if not c.is_churned]

    def churn_rate(lst):
        return round(sum(1 for c in lst if c.is_churned) / max(len(lst), 1) * 100, 1)

    fiber_zone = [c for c in custs if c.fiber_available]
    non_fiber = [c for c in custs if not c.fiber_available]
    comp_zone = [c for c in custs if c.competitor_available]
    non_comp = [c for c in custs if not c.competitor_available]

    fiber_cr = churn_rate(fiber_zone)
    non_fiber_cr = churn_rate(non_fiber)
    comp_cr = churn_rate(comp_zone)
    non_comp_cr = churn_rate(non_comp)

    fiber_eligible = [c for c in active if c.fiber_available]
    migration_rev = sum(c.monthly_revenue or 0 for c in fiber_eligible) * 12

    outage_buckets = [0, 1, 2, 3, 5, 8, 12, 20]
    outage_correlation = []
    for i in range(len(outage_buckets) - 1):
        lo, hi = outage_buckets[i], outage_buckets[i + 1]
        bucket = [c for c in custs if lo <= (c.outage_count or 0) < hi]
        ch = [c for c in bucket if c.is_churned]
        if bucket:
            outage_correlation.append({"range": f"{lo}-{hi}", "total": len(bucket), "churned": len(ch), "churnRate": round(len(ch) / max(len(bucket), 1) * 100, 1)})

    speed_buckets = [
        ("0-10%", 0, 0.1), ("10-20%", 0.1, 0.2), ("20-30%", 0.2, 0.3),
        ("30-50%", 0.3, 0.5), ("50%+", 0.5, 1.0),
    ]
    speed_correlation = []
    for label, lo, hi in speed_buckets:
        bucket = [c for c in custs if c.provisioned_speed and c.actual_speed and lo <= (c.provisioned_speed - c.actual_speed) / c.provisioned_speed < hi]
        ch = [c for c in bucket if c.is_churned]
        if bucket:
            speed_correlation.append({"range": label, "total": len(bucket), "churned": len(ch), "churnRate": round(len(ch) / max(len(bucket), 1) * 100, 1)})

    return {
        "competitiveLandscape": {
            "fiberZones": {"churnRate": fiber_cr, "total": len(fiber_zone), "churned": sum(1 for c in fiber_zone if c.is_churned)},
            "nonFiberZones": {"churnRate": non_fiber_cr, "total": len(non_fiber), "churned": sum(1 for c in non_fiber if c.is_churned)},
            "competitorZones": {"churnRate": comp_cr, "total": len(comp_zone), "churned": sum(1 for c in comp_zone if c.is_churned)},
            "nonCompetitorZones": {"churnRate": non_comp_cr, "total": len(non_comp), "churned": sum(1 for c in non_comp if c.is_churned)},
            "churnLiftFromFiber": round(fiber_cr - non_fiber_cr, 1),
            "churnLiftFromCompetitor": round(comp_cr - non_comp_cr, 1),
        },
        "migrationIntelligence": {
            "eligibleCustomers": len(fiber_eligible),
            "migrationRevenuePotential": round(migration_rev),
            "avgRevenuePerCustomer": round(migration_rev / max(len(fiber_eligible), 1)),
            "highRiskEligible": sum(1 for c in fiber_eligible if (c.churn_risk_score or 0) > 0.6),
        },
        "networkHealth": {
            "outageCorrelation": outage_correlation,
            "speedCorrelation": speed_correlation,
        },
    }


def get_unique_account_counts(db: Session) -> list[dict]:
    datasets = db.query(Dataset).all()
    result = []
    for ds in datasets:
        dp = ds.data_preview or {}
        sample = dp.get("sample", [])
        preview = dp.get("preview", [])
        rows = sample or preview
        if rows:
            account_col = next((k for k in (rows[0].keys() if rows else []) if "account" in k.lower()), None)
            if account_col:
                unique = len(set(r.get(account_col) for r in rows if r.get(account_col)))
                result.append({"datasetId": ds.id, "uniqueAccountCount": unique})
            else:
                result.append({"datasetId": ds.id, "uniqueAccountCount": len(rows)})
        else:
            result.append({"datasetId": ds.id, "uniqueAccountCount": 0})
    return result
