@echo off
echo ==========================================
echo   ML Orion - FastAPI Backend
echo   API: http://localhost:8000
echo   Docs: http://localhost:8000/docs
echo ==========================================
cd /d "%~dp0backend"
..\env\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
