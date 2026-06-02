
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
_CPG_ELASTICITY_DIR = (Path(__file__).parent.parent.parent/ "ML_backend"/ "python-ml"/ "cpg"/ "price_elasticity")
_RETAIL_DEMANDFORECAST_DIR = Path(__file__).parent.parent.parent / "ML_backend" / "python-ml" / "retail" / "demand_forecast"
_CPG_PROMO_DIR   = Path(__file__).parent.parent.parent / "ML_backend" / "python-ml" / "cpg" / "promo-uplift"
_retail_ANOMALY_DIR = Path(__file__).parent.parent.parent / "ML_backend" / "python-ml" / "retail" / "kpi-anomaly"
_PYTHON = sys.executable
_ENV_FILE = Path(__file__).parent.parent / ".env"

def _read_env_key(key: str) -> str:
    """Read a key from os.environ, falling back to a direct .env parse.

    This lets the key be picked up without restarting the server after editing .env.
    """
    value = os.environ.get(key, "").strip()
    if value:
        return value
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(f"{key}="):
                value = line[len(key) + 1:].strip().strip('"').strip("'")
                if value:
                    os.environ[key] = value  # cache so next call hits os.environ
                return value
    return ""

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
    models_to_run: Optional[List[str]] = None,
    custom_feature_names: Optional[List[str]] = None,
) -> dict:
    """Run the RGM baseline prediction/decomposition workflow."""
   
    # Default to testing all three if the user doesn't specify
    if models_to_run is None:
        models_to_run = ["Ridge", "RF", "XGB"]
       
    payload = {
        "data": data,
        "models_to_run": models_to_run,
        "custom_feature_names": custom_feature_names or [],
    }
   
    return _run_script("baseline_prediction.py", payload, script_dir=_CPG_BASELINE_DIR)

def run_price_elasticity(data: list[dict],) -> dict:

    payload = {
        "data": data,
    }

    return _run_script(
        "price_elas.py",
        payload,
        script_dir=_CPG_ELASTICITY_DIR,
    )

def run_retail_demand_fc_service(
    data: list[dict],
    models_to_run: Optional[List[str]] = None,
    custom_feature_names: Optional[List[str]] = None,
) -> dict:
    """Run the RGM baseline prediction/decomposition workflow."""
   
    # Default to testing all three if the user doesn't specify
    if models_to_run is None:
        models_to_run = ["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost","LightGBM"]
       
    payload = {
        "data": data,
        "models_to_run": models_to_run,
        "custom_feature_names": custom_feature_names or [],
    }
   
    return _run_script("retail_demand_forecast_main.py", payload, script_dir=_RETAIL_DEMANDFORECAST_DIR)

def _load_promo_uplift_mod():
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location(
        "_promo_uplift_inproc", str(_CPG_PROMO_DIR / "promo_uplift.py")
    )
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_promo_uplift(
    data: list[dict],
    algorithm: str = "Ridge",
    alpha: float = 1.0,
    promo_cols: list[str] | None = None,
    custom_feature_names: list[str] | None = None,
) -> dict:
    """Run promo uplift in-process (avoids subprocess permission issues on Windows)."""
    try:
        mod = _load_promo_uplift_mod()
        result = mod.run_promo_uplift(
            data, algorithm=algorithm, alpha=alpha,
            promo_cols=promo_cols, custom_feature_names=custom_feature_names,
        )
        return mod.safe_serialize(result)
    except Exception as exc:
        return {"success": False, "error": str(exc)}
    

def _load_feature_suggestions_mod():
    import importlib.util as _ilu
    import sys as _sys
    promo_dir = str(_CPG_PROMO_DIR)
    if promo_dir not in _sys.path:
        _sys.path.insert(0, promo_dir)
    spec = _ilu.spec_from_file_location(
        "_feature_suggestions_inproc", str(_CPG_PROMO_DIR / "feature_suggestions.py")
    )
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_promo_feature_suggestions(dataset_info: dict) -> dict:
    """Get LLM-based feature suggestions for CPG promo-uplift (in-process)."""
    try:
        mod = _load_feature_suggestions_mod()

        columns        = dataset_info.get("columns", [])
        promo_columns  = dataset_info.get("promoColumns", [])
        entity_column  = dataset_info.get("entityColumn")
        time_column    = dataset_info.get("timeColumn")
        dataset_name   = dataset_info.get("datasetName", "Dataset")
        column_details = dataset_info.get("columnDetails", [{"name": c, "type": "unknown"} for c in columns])
        sample_rows    = dataset_info.get("sampleRows", [])

        groq_api_key = _read_env_key("GROQ_API_KEY")
        source = "fallback"
        raw_suggestions = None

        if groq_api_key:
            user_prompt = mod.build_user_prompt(
                dataset_name=dataset_name,
                columns=columns,
                column_details=column_details,
                sample_rows=sample_rows,
                promo_columns=promo_columns,
                entity_column=entity_column,
                time_column=time_column,
            )
            raw_suggestions = mod._call_groq(groq_api_key, user_prompt)
            if raw_suggestions:
                source = "llm"

        if not raw_suggestions:
            raw_suggestions = mod._build_fallback_suggestions(
                columns, promo_columns, entity_column, time_column
            )

        suggestions = mod._clean_suggestions(raw_suggestions)
        return {"success": True, "suggestions": suggestions, "source": source}
    except Exception as exc:
        import sys as _sys, traceback as _tb
        _sys.stderr.write(f"[run_promo_feature_suggestions] error: {_tb.format_exc()}\n")
        return {"success": False, "suggestions": [], "source": "error", "error": str(exc)}



def _load_kpi_anomaly_mod():
    import importlib.util as _ilu
    spec = _ilu.spec_from_file_location(
        "_kpi_anomaly_inproc", str(_retail_ANOMALY_DIR / "kpi_anomaly.py")
    )
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_kpi_anomaly(
    data: list[dict],
    kpi_config: dict | None = None,
    kpi_names: list[str] | None = None,
    date_col: str = "Week_Start_Date",
) -> dict:
    """Run KPI anomaly detection in-process (avoids subprocess permission issues on Windows)."""
    try:
        mod    = _load_kpi_anomaly_mod()
        result = mod.run_kpi_anomaly(
            data,
            kpi_config=kpi_config,
            kpi_names=kpi_names,
            date_col=date_col,
        )
        return mod.safe_serialize(result)
    except Exception as exc:
        return {"success": False, "error": str(exc)}



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
