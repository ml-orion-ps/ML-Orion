
from __future__ import annotations
import sys
import os
import json
import tempfile
import subprocess
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
from typing import List, Optional
 

# Resolve paths to the python-ml directories
_SCRIPT_DIR = Path(__file__).parent.parent.parent / "ML_backend" / "python-ml" / "tmt" / "customer_churn"
_CPG_BASELINE_DIR = Path(__file__).parent.parent.parent / "ML_backend" / "python-ml" / "cpg" / "baseline_modelling"
_PYTHON = sys.executable


def _find_python() -> str:
    """Find the correct Python interpreter (venv-aware)."""
    root = Path(__file__).parent.parent.parent
    candidates = [
        root / "env" / "Scripts" / "python.exe",
        root / "env" / "bin" / "python",
        root / ".venv" / "Scripts" / "python.exe",
        root / ".venv" / "bin" / "python",
        Path(os.environ.get("PYTHON_PATH", "")),
    ]
    for p in candidates:
        if p and p.exists():
            return str(p)
    return sys.executable


def _run_script(script_name: str, input_data: dict, extra_args: list[str] | None = None, script_dir: Path | None = None) -> dict:
    """
    Run a Python ML script by passing JSON via temp files.
    This is the same pattern as the Node.js python-executor.ts
    but cleaner since it's pure Python.
    """
    # python = _find_python()
    python = sys.executable
    base_dir = script_dir if script_dir is not None else _SCRIPT_DIR
    script_path = str(base_dir / script_name)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as in_f:
        json.dump(input_data, in_f)
        in_path = in_f.name

    out_path = in_path.replace(".json", "_out.json")

    try:
        cmd = [python, script_path, in_path, out_path] + (extra_args or [])

        # Use CREATE_NEW_PROCESS_GROUP on Windows so uvicorn --reload signals
        # (CTRL_C_EVENT / SIGINT) don't cascade into the ML subprocess.
        # import sys as _sys
        # extra_kwargs: dict = {}
        # if _sys.platform == "win32":
        #     extra_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        # else:
        #     extra_kwargs["start_new_session"] = True

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,
            cwd=str(base_dir),
            # **extra_kwargs,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"Script {script_name} failed:\n{proc.stderr[-2000:]}")

        if not Path(out_path).exists():
            raise RuntimeError(f"Script {script_name} did not produce output file")

        with open(out_path, "r", encoding="utf-8") as f:
            return json.load(f)
    finally:
        for p in [in_path, out_path]:
            try:
                os.unlink(p)
            except FileNotFoundError:
                pass


def run_baseline_prediction(
    data: list[dict],
    models_to_run: Optional[List[str]] = None
) -> dict:
    """Run the RGM baseline prediction/decomposition workflow."""
   
    # Default to testing all three if the user doesn't specify
    if models_to_run is None:
        models_to_run = ["Ridge", "RF", "XGB"]
       
    payload = {
        "data": data,
        "models_to_run": models_to_run
    }
   
    return _run_script("baseline_prediction.py", payload, script_dir=_CPG_BASELINE_DIR)



def run_train_model(
    data: list[dict],
    target_column: str,
    algorithm: str = "Auto",
    hyperparameters: dict | None = None,
    custom_feature_names: list[str] | None = None,
    score_prod_data: list[dict] | None = None,
) -> dict:
    """Train a model using train_model.py directly."""
    payload: dict = {
        "data": data,
        "targetColumn": target_column,
        "hyperparameters": hyperparameters,
        "customFeatureNames": custom_feature_names or [],
    }
    if score_prod_data is not None:
        payload["scoreProdData"] = score_prod_data

    return _run_script("train_model.py", payload, [algorithm])


def run_calculate_shap(
    train_data: list[dict],
    score_data: list[dict],
    target_column: str,
    algorithm: str = "Random Forest",
    model_weights: dict | None = None,
) -> dict:
    """Calculate SHAP values using calculate_shap.py."""
    payload = {
        "trainData": train_data,
        "scoreData": score_data,
        "targetColumn": target_column,
        "algorithm": algorithm,
        "modelWeights": model_weights or {},
    }
    return _run_script("calculate_shap.py", payload, [algorithm])


def run_feature_suggestions(data_path: str, dataset_info: dict | None = None) -> list[dict]:
    """Get AI feature suggestions using feature_suggestions.py."""
    payload = {"dataPath": data_path, "datasetInfo": dataset_info or {}}
    result = _run_script("feature_suggestions.py", payload)
    return result.get("suggestions", [])


def run_churn_pattern_explorer(data_path: str) -> dict:
    """Run churn pattern analysis using churn_pattern_explorer.py."""
    payload = {"cwd": str(Path.cwd()), "dataPath": data_path}
    return _run_script("churn_pattern_explorer.py", payload)


def run_churn_driver_analysis(data_path: str) -> dict:
    """Run churn driver analysis using churn_driver_analysis.py."""
    payload = {"dataPath": data_path}
    return _run_script("churn_driver_analysis.py", payload)


def run_churn_financial_impact(data_path: str) -> dict:
    """Run financial impact analysis using churn_financial_impact.py."""
    payload = {"dataPath": data_path}
    return _run_script("churn_financial_impact.py", payload)


def run_churn_segment_intelligence(data_path: str) -> dict:
    """Run segment intelligence analysis using churn_segment_intelligence.py."""
    payload = {"dataPath": data_path}
    return _run_script("churn_segment_intelligence.py", payload)


def normalize_algorithm_for_python(algorithm: str) -> str:
    """Map frontend algorithm names to Python-compatible names."""
    mapping = {
        "gradient boosting": "XGBoost",
        "neural network": "Random Forest",
        "svm": "Random Forest",
        "support vector machine": "Random Forest",
        "decision tree": "Random Forest",
    }
    raw = algorithm.lower()
    if raw.startswith("auto ("):
        inner = algorithm[6:-1]
        return inner
    return mapping.get(raw, algorithm)
