"""KPI-anomaly notebook output endpoints."""
from __future__ import annotations
from pathlib import Path
from fastapi import APIRouter, HTTPException
from sqlalchemy.orm import Session
from fastapi import Depends
from database import get_db
import storage

router = APIRouter(prefix="", tags=["kpi-anomaly-notebook"])

_ROOT        = Path(__file__).parent.parent.parent
_EXCEL_FILE  = _ROOT / "kpi_anomaly_output.xlsx"


@router.get("/notebook-output")
def notebook_output():
    if not _EXCEL_FILE.exists():
        return {"rows": [], "available": False}
    try:
        import pandas as pd
        df   = pd.read_excel(_EXCEL_FILE)
        df   = df.where(df.notna(), None)
        rows = df.to_dict(orient="records")
        return {"rows": rows, "available": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/import-notebook-predictions")
def import_notebook_predictions(db: Session = Depends(get_db)):
    if not _EXCEL_FILE.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Notebook output file not found. "
                "Run the KPI anomaly notebook first to generate kpi_anomaly_output.xlsx."
            ),
        )
    try:
        import pandas as pd
        df   = pd.read_excel(_EXCEL_FILE)
        df   = df.where(df.notna(), None)
        rows = df.to_dict(orient="records")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read Excel: {exc}")

    if not rows:
        raise HTTPException(status_code=400, detail="Excel file is empty.")

    return {
        "success":  True,
        "imported": len(rows),
        "message":  f"Loaded {len(rows)} rows from kpi_anomaly_output.xlsx.",
        "preview":  rows[:10],
    }
