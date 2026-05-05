@echo off
echo ==========================================
echo   ML Orion - FastAPI Backend
echo   API: http://localhost:5000
echo   Docs: http://localhost:5000/docs
echo ==========================================
cd /d "%~dp0backend"
..\\.venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 5000 --reload
