from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from database import get_db
import storage
from schemas import AuditLogCreate, AuditLogOut

router = APIRouter(prefix="/api/audit-log", tags=["audit"])


@router.get("", response_model=list[AuditLogOut])
def get_audit_log(limit: int = Query(200, le=500), db: Session = Depends(get_db)):
    return storage.get_audit_log(db, limit)


@router.post("", response_model=AuditLogOut)
def create_audit_log(body: AuditLogCreate, db: Session = Depends(get_db)):
    return storage.create_audit_log(db, body.model_dump())
