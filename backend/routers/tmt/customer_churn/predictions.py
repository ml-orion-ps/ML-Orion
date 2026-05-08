from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
import storage
from schemas import RecommendationUpdate

router = APIRouter(prefix="/api", tags=["predictions"])

USE_CASE = "tmt_customer_churn"


@router.get("/predictions")
def get_predictions(model_id: int | None = Query(None), db: Session = Depends(get_db)):
    return storage.get_predictions(db, model_id, use_case=USE_CASE)


@router.get("/churn-events")
def get_churn_events(db: Session = Depends(get_db)):
    return storage.get_churn_events(db)


@router.get("/recommendations")
def get_recommendations(customer_id: int | None = Query(None), db: Session = Depends(get_db)):
    return storage.get_recommendations(db, customer_id)


@router.patch("/recommendations/{rec_id}")
def update_recommendation(rec_id: int, body: RecommendationUpdate, db: Session = Depends(get_db)):
    updated = storage.update_recommendation(db, rec_id, body.model_dump(exclude_none=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return updated
