"""KPI-anomaly model monitoring endpoints."""
from __future__ import annotations
import math
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="/monitoring", tags=["kpi-anomaly-monitoring"])

MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _format_month(ym: str | None) -> str:
    if ym and len(ym) == 7 and ym[4] == "-":
        try:
            y, m = int(ym[:4]), int(ym[5:7])
            return f"{MONTH_NAMES[m - 1]} {y}"
        except (ValueError, IndexError):
            pass
    return ym or "—"


@router.get("/{model_id}")
def model_monitoring(
    model_id:       int,
    prod_dataset_id: int | None = Query(None),
    db: Session = Depends(get_db),
):
    model = storage.get_ml_model(db, model_id)
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    weights  = model.model_weights or {}
    if not isinstance(weights, dict):
        weights = {}

    summary      = weights.get("summary", {}) if isinstance(weights, dict) else {}
    kpi_stats    = summary.get("kpiStats", {}) if isinstance(summary, dict) else {}
    total_anomalies = int(summary.get("totalAnomalies", 0)) if isinstance(summary, dict) else 0
    total_rows      = int(summary.get("totalRows",      0)) if isinstance(summary, dict) else 0

    stored_runs       = storage.get_model_evaluation_runs(db, model_id)
    stored_runs_sorted = sorted(stored_runs, key=lambda r: r.evaluation_month or "")

    now = datetime.now(timezone.utc)

    # Synthetic baseline (used when no stored evaluation runs)
    synthetic: list[dict] = []
    for i in range(11):
        weeks_ago   = 11 - i
        date        = (now - timedelta(weeks=weeks_ago)).strftime("%Y-%m-%d")
        noise       = math.sin(i * 1.1 + model_id * 0.5) * 0.018
        s_anom_rate = round(min(30.0, max(1.0, (total_anomalies / max(total_rows, 1)) * 100 + noise * 5)), 2)
        synthetic.append({
            "modelId":         model_id,
            "date":            date,
            "label":           f"W{i + 1}",
            "evaluationMonth": None,
            "isSynthetic":     True,
            "anomalyRate":     s_anom_rate,
            "totalRows":       total_rows,
            "totalAnomalies":  total_anomalies,
            "psi":             round(min(0.40, weeks_ago * 0.018 + abs(noise) * 0.045), 4),
            "ks":              round(min(0.30, 0.03 + weeks_ago * 0.012 + abs(noise) * 0.025), 4),
        })

    if stored_runs_sorted:
        snaps = []
        for run in stored_runs_sorted:
            run_date = (run.evaluated_at or now).strftime("%Y-%m-%d")
            label    = _format_month(run.evaluation_month)
            snaps.append({
                "modelId":         model_id,
                "date":            run_date,
                "label":           label,
                "evaluationMonth": run.evaluation_month,
                "isSynthetic":     False,
                "anomalyRate":     run.high_risk_pct or 0,
                "totalRows":       run.row_count or 0,
                "totalAnomalies":  0,
                "psi":             run.psi or 0,
                "ks":              run.ks  or 0,
            })
        real_count = len(snaps)
    else:
        snaps      = synthetic
        real_count = 0

    latest_s = snaps[-1] if snaps else {}
    prev_s   = snaps[-2] if len(snaps) >= 2 else (snaps[-1] if snaps else {})

    def _delta(key: str) -> float:
        return round((latest_s.get(key) or 0) - (prev_s.get(key) or 0), 4)

    # Recommendations
    recommendations: list[dict] = []
    latest_psi  = latest_s.get("psi") or 0
    anom_rate   = latest_s.get("anomalyRate") or 0

    if latest_psi > 0.2:
        recommendations.append({
            "id":       "rec_psi",
            "severity": "high",
            "category": "Data Drift",
            "title":    "Population Distribution Shift Detected",
            "detail":   f"PSI of {latest_psi:.3f} exceeds the 0.200 threshold.",
            "action":   "Re-run anomaly detection on a fresh data snapshot.",
            "impact":   "Restores accurate anomaly identification.",
        })

    if anom_rate > 25:
        recommendations.append({
            "id":       "rec_high_anom",
            "severity": "high",
            "category": "Anomaly Rate",
            "title":    "High Anomaly Rate Detected",
            "detail":   f"{anom_rate:.1f}% of rows flagged as anomalies — above 25% threshold.",
            "action":   "Review KPI config thresholds or check for data quality issues.",
            "impact":   "Reduces false-positive anomaly noise.",
        })

    if not recommendations:
        recommendations.append({
            "id":       "rec_healthy",
            "severity": "low",
            "category": "Model Health",
            "title":    "Anomaly Detection Healthy",
            "detail":   "All monitored metrics are within acceptable ranges.",
            "action":   "Continue regular detection runs to track KPI trends.",
            "impact":   "Proactive monitoring prevents undetected KPI degradation.",
        })

    return {
        "weeklyMetrics":  [
            {
                "date":          s["date"],
                "label":         s["label"],
                "evaluationMonth": s.get("evaluationMonth"),
                "anomalyRate":   s.get("anomalyRate", 0),
                "totalRows":     s.get("totalRows",   0),
                "totalAnomalies": s.get("totalAnomalies", 0),
                "psi":           s.get("psi", 0),
                "ks":            s.get("ks",  0),
                "isSynthetic":   s.get("isSynthetic", False),
            }
            for s in snaps[-12:]
        ],
        "kpiStats":       kpi_stats,
        "recommendations": recommendations,
        "dataSource": {
            "totalSnapshots":     len(snaps),
            "realSnapshots":      real_count,
            "syntheticSnapshots": len(snaps) - real_count,
            "hasRealData":        real_count > 0,
        },
        "summary": {
            "totalAnomalies":  total_anomalies,
            "totalRows":       total_rows,
            "anomalyRate":     round(total_anomalies / max(total_rows, 1) * 100, 2),
            "latestPsi":       latest_s.get("psi"),
            "latestKs":        latest_s.get("ks"),
            "psiDelta":        _delta("psi"),
            "anomalyRateDelta": _delta("anomalyRate"),
        },
    }
