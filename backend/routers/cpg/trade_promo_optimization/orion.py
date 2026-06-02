from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage
from services.custom_features import get_dataset_rows

router = APIRouter(prefix="/orion", tags=["orion"])

USE_CASE = "cpg_trade_promo_optimization"


@router.get("/overview")
def orion_overview(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    datasets = storage.get_datasets(db)
    customers = storage.get_customers(db)
    predictions = storage.get_predictions(db)
    recs = storage.get_recommendations(db)

    deployed = [m for m in models if m.is_deployed]
    active = [c for c in customers if not c.is_churned]
    at_risk = [c for c in active if (c.churn_risk_score or 0) > 0.6]
    churned = [c for c in customers if c.is_churned]

    completed_recs = [r for r in recs if r.status == "completed"]
    saved_recs = [r for r in completed_recs if r.outcome == "retained"]
    retention_rate = round(len(saved_recs) / max(len(completed_recs), 1) * 100, 1)
    rev_at_risk = round(sum(c.monthly_revenue or 0 for c in at_risk) * 12)
    churn_rate = round(len(churned) / max(len(customers), 1) * 100, 1)

    deployed_aucs = [m.auc for m in deployed if m.auc is not None]
    avg_auc = round(sum(deployed_aucs) / len(deployed_aucs), 4) if deployed_aucs else None

    unique_scored = len(set(p["customer_id"] for p in predictions))

    risk_dist = {"low": 0, "medium": 0, "high": 0, "veryHigh": 0}
    for c in active:
        s = c.churn_risk_score or 0
        if s >= 0.8:
            risk_dist["veryHigh"] += 1
        elif s >= 0.6:
            risk_dist["high"] += 1
        elif s >= 0.3:
            risk_dist["medium"] += 1
        else:
            risk_dist["low"] += 1

    model_performance = [
        {
            "id": m.id, "name": m.name, "algorithm": m.algorithm,
            "accuracy": m.accuracy, "auc": m.auc, "f1": m.f1_score,
            "precision": m.precision, "recall": m.recall,
            "isDeployed": m.is_deployed, "trainedAt": m.trained_at,
        }
        for m in models[:6]
    ]

    return {
        "kpis": {
            "totalModels": len(models),
            "deployedModels": len(deployed),
            "avgAuc": avg_auc,
            "totalPredictions": len(predictions),
            "customersScored": unique_scored,
            "totalDatasets": len(datasets),
            "retentionSuccessRate": retention_rate,
            "revenueAtRisk": rev_at_risk,
        },
        "churnRate": churn_rate,
        "revenueAtRisk": rev_at_risk,
        "riskDistribution": risk_dist,
        "modelPerformance": model_performance,
        "activeModel": {
            "id": deployed[0].id, "name": deployed[0].name,
            "algorithm": deployed[0].algorithm, "auc": deployed[0].auc,
            "accuracy": deployed[0].accuracy, "f1Score": deployed[0].f1_score,
            "isDeployed": True, "trainedAt": deployed[0].trained_at,
        } if deployed else None,
        "recentModels": [
            {"id": m.id, "name": m.name, "algorithm": m.algorithm,
             "auc": m.auc, "status": m.status, "trainedAt": m.trained_at}
            for m in models[:5]
        ],
    }


@router.get("/risk-distribution")
def risk_distribution(
    model_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    predictions = storage.get_predictions(db, model_id)
    if not predictions:
        customers = storage.get_customers(db)
        distribution = {"veryHigh": 0, "high": 0, "medium": 0, "low": 0}
        for c in customers:
            s = c.churn_risk_score or 0
            if s >= 0.8:
                distribution["veryHigh"] += 1
            elif s >= 0.6:
                distribution["high"] += 1
            elif s >= 0.3:
                distribution["medium"] += 1
            else:
                distribution["low"] += 1
        return {"distribution": distribution, "source": "customers"}

    distribution = {"veryHigh": 0, "high": 0, "medium": 0, "low": 0}
    for p in predictions:
        cat = p.get("risk_category", "")
        if cat == "very high":
            distribution["veryHigh"] += 1
        elif cat == "high":
            distribution["high"] += 1
        elif cat == "medium":
            distribution["medium"] += 1
        else:
            distribution["low"] += 1
    return {"distribution": distribution, "source": "predictions", "totalPredictions": len(predictions)}


@router.get("/customer-dataset")
def customer_dataset(db: Session = Depends(get_db)):
    customers = storage.get_customers(db)
    return [
        {
            "id": c.id, "accountNumber": c.account_number, "name": c.name,
            "region": c.region, "serviceType": c.service_type,
            "tenureMonths": c.tenure_months, "monthlyRevenue": c.monthly_revenue,
            "contractStatus": c.contract_status, "valueTier": c.value_tier,
            "churnRiskScore": c.churn_risk_score, "churnRiskCategory": c.churn_risk_category,
            "isChurned": c.is_churned, "fiberAvailable": c.fiber_available,
            "competitorAvailable": c.competitor_available,
        }
        for c in customers
    ]


@router.get("/governance")
def governance(db: Session = Depends(get_db)):
    models = storage.get_ml_models(db, use_case=USE_CASE)
    audit = storage.get_audit_log(db, 100)

    approved = [m for m in models if m.approval_status == "approved"]
    pending = [m for m in models if m.approval_status == "pending"]
    deployed = [m for m in models if m.is_deployed]

    return {
        "modelInventory": [
            {
                "id": m.id, "name": m.name, "algorithm": m.algorithm,
                "status": m.status, "approvalStatus": m.approval_status,
                "isDeployed": m.is_deployed, "trainedAt": m.trained_at,
                "approvedBy": m.approved_by, "approvedAt": m.approved_at,
            }
            for m in models
        ],
        "summary": {
            "totalModels": len(models),
            "approvedModels": len(approved),
            "pendingApproval": len(pending),
            "deployedModels": len(deployed),
        },
        "recentActivity": [
            {
                "id": a.id, "action": a.action, "entityType": a.entity_type,
                "entityName": a.entity_name, "detail": a.detail,
                "user": a.user, "team": a.team, "status": a.status,
                "createdAt": a.created_at,
            }
            for a in audit[:20]
        ],
    }


@router.get("/eda-live")
def eda_live(db: Session = Depends(get_db)):
    customers = storage.get_customers(db)
    if not customers:
        return {"error": "No customer data available"}

    import statistics

    churned = [c for c in customers if c.is_churned]
    n = len(customers)
    churned_n = len(churned)

    # overview
    revenues = [c.monthly_revenue for c in customers if c.monthly_revenue]
    tenures = [c.tenure_months for c in customers if c.tenure_months]
    overview = {
        "totalRows": n, "churnedRows": churned_n, "retainedRows": n - churned_n,
        "churnRate": round(churned_n / max(n, 1) * 100, 1),
        "features": 8, "numericFeatures": 5, "categoricalFeatures": 3,
    }

    # numericStats
    def _hist(values: list[float], bins: int = 12) -> list[dict]:
        if not values:
            return []
        mn, mx = min(values), max(values)
        if mn == mx:
            return [{"label": str(round(mn, 1)), "count": len(values)}]
        step = (mx - mn) / bins
        hist: dict[int, int] = {}
        for v in values:
            bucket = min(bins - 1, int((v - mn) / step))
            hist[bucket] = hist.get(bucket, 0) + 1
        return [{"label": f"{round(mn + i * step, 1)}–{round(mn + (i+1)*step, 1)}", "count": hist.get(i, 0)} for i in range(bins)]

    def _num_stat(field: str, label: str = None) -> tuple[str, dict]:
        vals = [getattr(c, field) for c in customers if getattr(c, field) is not None]
        churn_vals = [getattr(c, field) for c in churned if getattr(c, field) is not None]
        ret_vals = [getattr(c, field) for c in customers if not c.is_churned and getattr(c, field) is not None]
        null_c = n - len(vals)
        if not vals:
            return (label or field, {"mean": 0, "median": 0, "stdDev": 0, "min": 0, "max": 0, "q1": None, "q3": None, "nullCount": n, "completeness": 0, "histogram": []})
        sorted_v = sorted(vals)
        mid = len(sorted_v) // 2
        median = sorted_v[mid] if len(sorted_v) % 2 else (sorted_v[mid - 1] + sorted_v[mid]) / 2
        mean = sum(vals) / len(vals)
        std = (sum((v - mean) ** 2 for v in vals) / max(len(vals) - 1, 1)) ** 0.5
        q1 = sorted_v[len(sorted_v) // 4]
        q3 = sorted_v[3 * len(sorted_v) // 4]
        return (label or field, {
            "mean": round(mean, 2), "median": round(median, 2), "stdDev": round(std, 2),
            "min": round(min(vals), 2), "max": round(max(vals), 2),
            "q1": round(q1, 2), "q3": round(q3, 2),
            "nullCount": null_c, "completeness": round((1 - null_c / max(n, 1)) * 100, 1),
            "churnMean": round(sum(churn_vals) / max(len(churn_vals), 1), 2) if churn_vals else None,
            "retainedMean": round(sum(ret_vals) / max(len(ret_vals), 1), 2) if ret_vals else None,
            "histogram": _hist([float(v) for v in vals]),
        })

    numeric_stats = dict([
        _num_stat("monthly_revenue", "monthly_revenue"),
        _num_stat("tenure_months", "tenure_months"),
        _num_stat("outage_count", "outage_count"),
        _num_stat("ticket_count", "ticket_count"),
        _num_stat("nps_score", "nps_score"),
    ])

    # catStats
    def _cat_stat(field: str) -> tuple[str, dict]:
        counts: dict[str, dict] = {}
        for c in customers:
            val = str(getattr(c, field, None) or "Unknown")
            if val not in counts:
                counts[val] = {"count": 0, "churnCount": 0}
            counts[val]["count"] += 1
            if c.is_churned:
                counts[val]["churnCount"] += 1
        top = sorted([{"label": k, **v} for k, v in counts.items()], key=lambda x: -x["count"])[:10]
        return (field, {"nullCount": 0, "uniqueCount": len(counts), "top": top})

    cat_stats = dict([_cat_stat("region"), _cat_stat("value_tier"), _cat_stat("contract_status")])

    # bivariate
    risk_category_data = [
        {"label": k, "total": v["total"], "churned": v["churned"],
         "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1)}
        for k, v in {
            cat: {"total": sum(1 for c in customers if (c.churn_risk_category or "").lower() == cat),
                  "churned": sum(1 for c in churned if (c.churn_risk_category or "").lower() == cat)}
            for cat in ["high", "medium", "low"]
        }.items()
    ]
    value_tier_data = [
        {"label": k, "count": v["total"], "total": v["total"], "churned": v["churned"],
         "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1),
         "avgRevenue": round(v["rev"] / max(v["total"], 1), 2)}
        for k, v in sorted({
            str(c.value_tier or "Unknown"): None for c in customers
        }.keys() and {
            str(c.value_tier or "Unknown"): {
                "total": sum(1 for x in customers if str(x.value_tier or "Unknown") == str(c.value_tier or "Unknown")),
                "churned": sum(1 for x in churned if str(x.value_tier or "Unknown") == str(c.value_tier or "Unknown")),
                "rev": sum(x.monthly_revenue or 0 for x in customers if str(x.value_tier or "Unknown") == str(c.value_tier or "Unknown")),
            } for c in customers
        }.items(), key=lambda x: -x[1]["total"])
    ]

    # multivariate
    multivariate: list[dict] = []
    seen_mv: set = set()
    for c in customers:
        tier = str(c.value_tier or "Unknown")
        contract = str(c.contract_status or "Unknown")
        key = (tier, contract)
        if key in seen_mv:
            continue
        seen_mv.add(key)
        grp = [x for x in customers if str(x.value_tier or "Unknown") == tier and str(x.contract_status or "Unknown") == contract]
        ch = sum(1 for x in grp if x.is_churned)
        avg_rev = round(sum(x.monthly_revenue or 0 for x in grp) / max(len(grp), 1), 2)
        multivariate.append({"valueTier": tier, "contractStatus": contract, "total": len(grp),
                              "churned": ch, "churnRate": round(ch / max(len(grp), 1) * 100, 1), "avgRevenue": avg_rev})
    multivariate = sorted(multivariate, key=lambda x: -x["total"])[:20]

    # timeTrends
    time_trends: list[dict] = []
    for label, lo, hi in [("0-6 mo", 0, 6), ("6-12 mo", 6, 12), ("12-24 mo", 12, 24), ("24-48 mo", 24, 48), ("48+ mo", 48, 9999)]:
        grp = [c for c in customers if lo <= (c.tenure_months or 0) < hi]
        ch = sum(1 for c in grp if c.is_churned)
        avg_rev = round(sum(c.monthly_revenue or 0 for c in grp) / max(len(grp), 1), 2)
        time_trends.append({"bucket": label, "total": len(grp), "churned": ch,
                             "churnRate": round(ch / max(len(grp), 1) * 100, 1), "avgRevenue": avg_rev})

    # correlationMatrix
    fields = [("tenure_months", lambda c: c.tenure_months), ("monthly_revenue", lambda c: c.monthly_revenue),
              ("outage_count", lambda c: c.outage_count), ("ticket_count", lambda c: c.ticket_count)]
    correlation_matrix: list[dict] = []
    for i, (n1, f1) in enumerate(fields):
        for n2, f2 in fields[i + 1:]:
            vals1 = [f1(c) for c in customers if f1(c) is not None and f2(c) is not None]
            vals2 = [f2(c) for c in customers if f1(c) is not None and f2(c) is not None]
            if len(vals1) < 5:
                continue
            mean1, mean2 = sum(vals1) / len(vals1), sum(vals2) / len(vals2)
            num = sum((a - mean1) * (b - mean2) for a, b in zip(vals1, vals2))
            d1 = sum((a - mean1) ** 2 for a in vals1) ** 0.5
            d2 = sum((b - mean2) ** 2 for b in vals2) ** 0.5
            corr = num / (d1 * d2) if d1 * d2 > 0 else 0
            correlation_matrix.append({"col1": n1, "col2": n2, "corr": round(corr, 3)})
    correlation_matrix.sort(key=lambda x: -abs(x["corr"]))

    # dataRisks
    data_risks = {
        "classImbalance": round(churned_n / max(n, 1) * 100, 1),
        "duplicates": 0,
        "nullRisks": [
            {"column": "nps_score", "nullCount": sum(1 for c in customers if c.nps_score is None),
             "nullPercent": round(sum(1 for c in customers if c.nps_score is None) / max(n, 1) * 100, 1)},
        ],
        "outliers": [],
        "lowVariance": [],
    }

    return {
        "overview": overview, "numericStats": numeric_stats, "catStats": cat_stats,
        "bivariate": {"riskCategory": risk_category_data, "valueTier": value_tier_data},
        "multivariate": multivariate, "timeTrends": time_trends,
        "correlationMatrix": correlation_matrix,
        "dataRisks": data_risks,
        "correlations": [{"feature1": c["col1"], "feature2": c["col2"], "correlation": c["corr"]} for c in correlation_matrix],
        "distributions": [],
    }


def _group_churn(customers, field: str) -> list[dict]:
    groups: dict[str, dict] = {}
    for c in customers:
        key = str(getattr(c, field, None) or "Unknown")
        if key not in groups:
            groups[key] = {"total": 0, "churned": 0}
        groups[key]["total"] += 1
        if c.is_churned:
            groups[key]["churned"] += 1
    return [
        {"name": k, "total": v["total"], "churned": v["churned"],
         "churnRate": round(v["churned"] / max(v["total"], 1) * 100, 1)}
        for k, v in sorted(groups.items(), key=lambda x: -x[1]["total"])
    ]


# /api/orion/algorithms is handled by routers/code.py (reads from train_model.py)
