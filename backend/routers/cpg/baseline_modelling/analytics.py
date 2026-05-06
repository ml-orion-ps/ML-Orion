from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
import storage

router = APIRouter(prefix="", tags=["analytics"])


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db)):
    return storage.get_churn_analytics(db)


@router.get("/segments")
def segments(db: Session = Depends(get_db)):
    return storage.get_segment_analytics(db)


@router.get("/analytics/command-center")
def command_center(db: Session = Depends(get_db)):
    return storage.get_command_center_data(db)


@router.get("/analytics/churn-diagnostics")
def churn_diagnostics(
    source: str = "auto",
    dataset_id: int | None = None,
    model_id: int | None = None,
    db: Session = Depends(get_db),
):
    data = storage.get_churn_diagnostics(db)

    if source != "db" and (dataset_id or model_id):
        resolved_ds_id = dataset_id
        if not resolved_ds_id and model_id:
            model = storage.get_ml_model(db, model_id)
            if model:
                resolved_ds_id = model.dataset_id

        if resolved_ds_id:
            ds = storage.get_dataset(db, resolved_ds_id)
            if ds:
                try:
                    from services.ml_service import run_churn_pattern_explorer
                    from services.custom_features import get_dataset_rows
                    rows = get_dataset_rows(ds)
                    if rows:
                        import tempfile, csv, os
                        with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="") as f:
                            tmp_path = f.name
                            writer = csv.DictWriter(f, fieldnames=rows[0].keys())
                            writer.writeheader()
                            writer.writerows(rows)
                        try:
                            result = run_churn_pattern_explorer(tmp_path)
                            if isinstance(result.get("monthlyTrend"), list) and isinstance(result.get("tenureCohorts"), list):
                                data["patterns"] = {
                                    "monthlyTrend": result["monthlyTrend"],
                                    "tenureCohorts": result["tenureCohorts"],
                                }
                        finally:
                            os.unlink(tmp_path)
                except Exception:
                    pass
    return data


@router.get("/analytics/risk-intelligence")
def risk_intelligence(db: Session = Depends(get_db)):
    return storage.get_risk_intelligence(db)


@router.get("/analytics/retention")
def retention(db: Session = Depends(get_db)):
    return storage.get_retention_data(db)


@router.get("/analytics/business-impact")
def business_impact(db: Session = Depends(get_db)):
    return storage.get_business_impact(db)


@router.get("/analytics/strategy")
def strategy(db: Session = Depends(get_db)):
    return storage.get_strategy_insights(db)
