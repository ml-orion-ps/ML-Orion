# """
# Baseline prediction and unit decomposition script.

# Ported from `1. BaseLine_prediction.ipynb` into the ML_Orion python-ml
# subprocess architecture.

# Usage:
#     python baseline_prediction.py <input_json_file> <output_json_file>
# """

# from __future__ import annotations

# import json
# import math
# import subprocess
# import sys
# import warnings
# from typing import Any

# for pkg in ["pandas", "numpy", "scikit-learn", "patsy", "packaging"]:
#     try:
#         __import__(pkg.replace("-", "_") if pkg != "scikit-learn" else "sklearn")
#     except ImportError:
#         try:
#             subprocess.run([sys.executable, "-m", "pip", "install", pkg], check=False, capture_output=True)
#         except Exception:
#             pass

# import numpy as np
# import pandas as pd
# from patsy import dmatrices
# from sklearn.linear_model import Ridge
# from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# warnings.filterwarnings("ignore")


# REQUIRED_COLUMNS = {
#     "sales_units",
#     "price",
#     "base_price",
#     "store_id",
#     "week_id",
#     "brand",
#     "category",
#     "COMP1_PRICE",
#     "COMP2_PRICE",
#     "seasonality_index",
#     "holiday_flag",
#     "month",
#     "sales_channel_short_name",
#     "region",
# }


# def safe_float(value: Any, precision: int = 6) -> float | None:
#     try:
#         parsed = float(value)
#     except (TypeError, ValueError):
#         return None
#     if math.isnan(parsed) or math.isinf(parsed):
#         return None
#     return round(parsed, precision)


# def safe_serialize(obj: Any) -> Any:
#     if isinstance(obj, bool):
#         return obj
#     if isinstance(obj, dict):
#         return {k: safe_serialize(v) for k, v in obj.items()}
#     if isinstance(obj, list):
#         return [safe_serialize(v) for v in obj]
#     if isinstance(obj, (np.integer, int)):
#         return int(obj)
#     if isinstance(obj, (np.floating, float)):
#         return safe_float(obj)
#     if obj is pd.NA:
#         return None
#     return obj


# def _ensure_columns(df: pd.DataFrame) -> None:
#     missing = sorted(REQUIRED_COLUMNS - set(df.columns))
#     if missing:
#         raise ValueError(f"Missing required baseline columns: {', '.join(missing)}")


# def _prepare_dataframe(rows: list[dict]) -> pd.DataFrame:
#     if not rows:
#         raise ValueError("No rows provided for baseline prediction")

#     df = pd.DataFrame(rows).copy()
#     _ensure_columns(df)

#     if "date_id" in df.columns and not pd.api.types.is_numeric_dtype(df["date_id"]):
#         df["date_id"] = pd.to_datetime(df["date_id"], errors="coerce")
#     date_source = "date" if "date" in df.columns else "date_id"
#     if date_source in df.columns and not pd.api.types.is_numeric_dtype(df[date_source]):
#         df[date_source] = pd.to_datetime(df[date_source], errors="coerce")
#         df["year"] = df[date_source].dt.year.astype("Int64")

#     numeric_cols = [
#         "sales_units",
#         "price",
#         "base_price",
#         "COMP1_PRICE",
#         "COMP2_PRICE",
#         "seasonality_index",
#         "holiday_flag",
#         "month",
#     ]
#     promo_cols = [c for c in df.columns if c.upper().startswith("PROMO_")]
#     for col in numeric_cols + promo_cols:
#         if col in df.columns:
#             df[col] = pd.to_numeric(df[col], errors="coerce")

#     df = df[(df["price"] > 0) & (df["base_price"] > 0) & (df["sales_units"] > 0)].copy()
#     if df.empty:
#         raise ValueError("No valid rows remain after filtering positive price/base_price/sales_units")

#     return df


# def ridge_predict_units(model: Ridge, design_matrix: pd.DataFrame) -> np.ndarray:
#     yhat_log = model.predict(design_matrix)
#     return np.exp(np.asarray(yhat_log).reshape(-1))


# def run_baseline_prediction(rows: list[dict], alpha: float = 1.0) -> dict:
#     model_df = _prepare_dataframe(rows)

#     model_df["log_sales_units"] = np.log(model_df["sales_units"])
#     model_df["log_price"] = np.log(model_df["base_price"])

#     model_df["avg_brand_price_store_week"] = (
#         model_df.groupby(["store_id", "week_id", "brand"])["price"].transform("mean")
#     )
#     model_df["own_brand_price_index"] = model_df["price"] / model_df["avg_brand_price_store_week"]

#     model_df["avg_cat_price_store_week"] = (
#         model_df.groupby(["store_id", "week_id", "category"])["price"].transform("mean")
#     )
#     model_df["own_cat_price_index"] = model_df["price"] / model_df["avg_cat_price_store_week"]

#     model_df["log_comp1_price"] = np.log(np.clip(model_df["COMP1_PRICE"], 1e-6, None))
#     model_df["log_comp2_price"] = np.log(np.clip(model_df["COMP2_PRICE"], 1e-6, None))
#     model_df["log_own_brand_price_index"] = np.log(np.clip(model_df["own_brand_price_index"], 1e-6, None))
#     model_df["log_own_cat_price_index"] = np.log(np.clip(model_df["own_cat_price_index"], 1e-6, None))

#     promo_cols_all = [f"PROMO_{i}" for i in range(1, 16)]
#     promo_cols_for_model = [
#         c for c in promo_cols_all
#         if c in model_df.columns and model_df[c].fillna(0).abs().sum() != 0
#     ]
#     promo_term = " + ".join(promo_cols_for_model)

#     formula = f"""
# log_sales_units ~ log_price
#     + log_comp1_price
#     + log_comp2_price
#     + log_own_brand_price_index
#     {("+ " + promo_term) if promo_term else ""}
#     + seasonality_index
#     + holiday_flag
#     + C(month)
#     + C(sales_channel_short_name)
#     + C(region)
#     + C(store_id)
#     + C(brand)
#     + C(category)
# """

#     y, x = dmatrices(formula, data=model_df, return_type="dataframe")
#     model = Ridge(alpha=alpha, random_state=42)
#     model.fit(x, np.asarray(y).reshape(-1))

#     x_base0 = x.copy()
#     for col in promo_cols_for_model:
#         if col in x_base0.columns:
#             x_base0[col] = 0.0
#     x_base0["seasonality_index"] = 1.0
#     x_base0["holiday_flag"] = 0.0
#     x_base0["log_comp1_price"] = 0.0
#     x_base0["log_comp2_price"] = 0.0
#     x_base0["log_own_brand_price_index"] = 0.0

#     model_df["base0_units"] = ridge_predict_units(model, x_base0)

#     x_cann = x_base0.copy()
#     x_cann["log_own_brand_price_index"] = x["log_own_brand_price_index"]
#     model_df["units_cann"] = ridge_predict_units(model, x_cann)
#     model_df["cannibalization_effect_units"] = model_df["units_cann"] - model_df["base0_units"]

#     x_comp = x_cann.copy()
#     x_comp["log_comp1_price"] = x["log_comp1_price"]
#     x_comp["log_comp2_price"] = x["log_comp2_price"]
#     model_df["units_comp"] = ridge_predict_units(model, x_comp)
#     model_df["comp_price_effect_units"] = model_df["units_comp"] - model_df["units_cann"]

#     x_season = x_comp.copy()
#     x_season["seasonality_index"] = x["seasonality_index"]
#     model_df["units_season"] = ridge_predict_units(model, x_season)
#     model_df["seasonality_effect_units"] = model_df["units_season"] - model_df["units_comp"]

#     x_holiday = x_season.copy()
#     x_holiday["holiday_flag"] = x["holiday_flag"]
#     model_df["units_holiday"] = ridge_predict_units(model, x_holiday)
#     model_df["holiday_effect_units"] = model_df["units_holiday"] - model_df["units_season"]

#     x_start = x_holiday.copy()
#     for col in promo_cols_for_model:
#         if col in x_start.columns:
#             x_start[col] = 0.0

#     units_prev = ridge_predict_units(model, x_start)
#     promo_effect_cols = []
#     for col in promo_cols_for_model:
#         x_step = x_start.copy()
#         if col in x_step.columns:
#             x_step[col] = x[col]
#         units_step = ridge_predict_units(model, x_step)
#         effect_col = f"{col}_effect_units"
#         model_df[effect_col] = units_step - units_prev
#         promo_effect_cols.append(effect_col)
#         x_start = x_step
#         units_prev = units_step

#     model_df["units_with_all_promos"] = units_prev
#     model_df["promo_effect_units_sum"] = model_df[promo_effect_cols].sum(axis=1) if promo_effect_cols else 0.0
#     model_df["residual_units"] = model_df["sales_units"] - model_df["units_with_all_promos"]

#     x_baseline_without_promo = x.copy()
#     for col in promo_cols_for_model:
#         if col in x_baseline_without_promo.columns:
#             x_baseline_without_promo[col] = 0.0
#     model_df["baseline_without_promo"] = ridge_predict_units(model, x_baseline_without_promo)

#     fitted_units = ridge_predict_units(model, x)
#     actual_units = model_df["sales_units"].astype(float).to_numpy()

#     output_columns = [
#         "base0_units",
#         "baseline_without_promo",
#         "units_with_all_promos",
#         "cannibalization_effect_units",
#         "comp_price_effect_units",
#         "seasonality_effect_units",
#         "holiday_effect_units",
#         "promo_effect_units_sum",
#         "residual_units",
#     ] + promo_effect_cols

#     identifier_candidates = [
#         "product_id",
#         "sku_id",
#         "item_id",
#         "store_id",
#         "week_id",
#         "brand",
#         "category",
#         "date_id",
#         "date",
#     ]
#     result_columns = [c for c in identifier_candidates if c in model_df.columns] + output_columns
#     result_df = model_df[result_columns].copy()
#     for col in result_df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
#         result_df[col] = result_df[col].dt.strftime("%Y-%m-%d")

#     summary = {
#         "rowCount": int(len(model_df)),
#         "featureCount": int(x.shape[1]),
#         "promoColumnsUsed": promo_cols_for_model,
#         "metrics": {
#             "mae": safe_float(mean_absolute_error(actual_units, fitted_units)),
#             "rmse": safe_float(math.sqrt(mean_squared_error(actual_units, fitted_units))),
#             "r2": safe_float(r2_score(actual_units, fitted_units)),
#         },
#         "totals": {
#             "actualUnits": safe_float(model_df["sales_units"].sum()),
#             "base0Units": safe_float(model_df["base0_units"].sum()),
#             "baselineWithoutPromoUnits": safe_float(model_df["baseline_without_promo"].sum()),
#             "promoEffectUnits": safe_float(model_df["promo_effect_units_sum"].sum()),
#             "residualUnits": safe_float(model_df["residual_units"].sum()),
#         },
#     }

#     return {
#         "success": True,
#         "summary": summary,
#         "predictions": result_df.where(pd.notnull(result_df), None).to_dict(orient="records"),
#     }


# def main() -> None:
#     if len(sys.argv) < 3:
#         sys.stdout.write(json.dumps({"success": False, "error": "Usage: python baseline_prediction.py <input_json> <output_json>"}) + "\n")
#         sys.exit(1)

#     input_file = sys.argv[1]
#     output_file = sys.argv[2]

#     try:
#         with open(input_file, "r", encoding="utf-8-sig") as f:
#             input_data = json.load(f)
#         rows = input_data.get("data", [])
#         alpha = float(input_data.get("alpha", 1.0))
#         output_data = safe_serialize(run_baseline_prediction(rows, alpha=alpha))
#         with open(output_file, "w", encoding="utf-8") as f:
#             json.dump(output_data, f, indent=2)
#         sys.stdout.write(json.dumps({"success": True, "message": f"Baseline prediction complete for {output_data['summary']['rowCount']} rows"}) + "\n")
#     except Exception as exc:
#         error_data = {"success": False, "error": str(exc)}
#         try:
#             with open(output_file, "w", encoding="utf-8") as f:
#                 json.dump(error_data, f, indent=2)
#         except Exception:
#             pass
#         sys.stdout.write(json.dumps(error_data) + "\n")
#         sys.exit(1)


# if __name__ == "__main__":
#     main()

"""
Baseline prediction and unit decomposition script with Auto-ML Grid Search.

Ported from `1. BaseLine_prediction.ipynb` into the ML_Orion python-ml
subprocess architecture.

Usage:
    python baseline_prediction.py <input_json_file> <output_json_file>
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import warnings
from typing import Any

# Added xgboost to the auto-install list
for pkg in ["pandas", "numpy", "scikit-learn", "patsy", "packaging", "xgboost"]:
    try:
        __import__(pkg.replace("-", "_") if pkg != "scikit-learn" else "sklearn")
    except ImportError:
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", pkg], check=False, capture_output=True)
        except Exception:
            pass

import numpy as np
import pandas as pd
import xgboost as xgb
from patsy import dmatrices
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import GridSearchCV, train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score, make_scorer

warnings.filterwarnings("ignore")

REQUIRED_COLUMNS = {
    "sales_units",
    "price",
    "base_price",
    "store_id",
    "week_id",
    "brand",
    "category",
    "COMP1_PRICE",
    "COMP2_PRICE",
    "seasonality_index",
    "holiday_flag",
    "month",
    "sales_channel_short_name",
    "region",
}

def safe_float(value: Any, precision: int = 6) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return round(parsed, precision)

def safe_serialize(obj: Any) -> Any:
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, dict):
        return {k: safe_serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe_serialize(v) for v in obj]
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return safe_float(obj)
    if obj is pd.NA:
        return None
    return obj

def _ensure_columns(df: pd.DataFrame) -> None:
    missing = sorted(REQUIRED_COLUMNS - set(df.columns))
    if missing:
        raise ValueError(f"Missing required baseline columns: {', '.join(missing)}")

def _prepare_dataframe(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        raise ValueError("No rows provided for baseline prediction")

    df = pd.DataFrame(rows).copy()
    _ensure_columns(df)

    if "date_id" in df.columns and not pd.api.types.is_numeric_dtype(df["date_id"]):
        df["date_id"] = pd.to_datetime(df["date_id"], errors="coerce")
    date_source = "date" if "date" in df.columns else "date_id"
    if date_source in df.columns and not pd.api.types.is_numeric_dtype(df[date_source]):
        df[date_source] = pd.to_datetime(df[date_source], errors="coerce")
        df["year"] = df[date_source].dt.year.astype("Int64")

    numeric_cols = [
        "sales_units",
        "price",
        "base_price",
        "COMP1_PRICE",
        "COMP2_PRICE",
        "seasonality_index",
        "holiday_flag",
        "month",
    ]
    promo_cols = [c for c in df.columns if c.upper().startswith("PROMO_")]
    for col in numeric_cols + promo_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df[(df["price"] > 0) & (df["base_price"] > 0) & (df["sales_units"] > 0)].copy()
    if df.empty:
        raise ValueError("No valid rows remain after filtering positive price/base_price/sales_units")

    return df

# Helper metric: WMAPE
def wmape_for_logs(y_true_log: np.ndarray, y_pred_log: np.ndarray) -> float:
    y_true_units = np.exp(y_true_log)
    y_pred_units = np.exp(y_pred_log)
    return float(np.sum(np.abs(y_true_units - y_pred_units)) / np.sum(np.abs(y_true_units)))

# Note: Keeping the name ridge_predict_units to avoid breaking downstream logic, 
# but it works with any sklearn-compatible model (RF, XGB, etc.)
def ridge_predict_units(model: Any, design_matrix: pd.DataFrame) -> np.ndarray:
    yhat_log = model.predict(design_matrix)
    return np.exp(np.asarray(yhat_log).reshape(-1))

def run_baseline_prediction(rows: list[dict], models_to_run: list[str] = None) -> dict:
    if models_to_run is None:
        models_to_run = ["Ridge", "RF", "XGB"]
        
    model_df = _prepare_dataframe(rows)

    model_df["log_sales_units"] = np.log(model_df["sales_units"])
    model_df["log_price"] = np.log(model_df["base_price"])

    model_df["avg_brand_price_store_week"] = (
        model_df.groupby(["store_id", "week_id", "brand"])["price"].transform("mean")
    )
    model_df["own_brand_price_index"] = model_df["price"] / model_df["avg_brand_price_store_week"]

    model_df["avg_cat_price_store_week"] = (
        model_df.groupby(["store_id", "week_id", "category"])["price"].transform("mean")
    )
    model_df["own_cat_price_index"] = model_df["price"] / model_df["avg_cat_price_store_week"]

    model_df["log_comp1_price"] = np.log(np.clip(model_df["COMP1_PRICE"], 1e-6, None))
    model_df["log_comp2_price"] = np.log(np.clip(model_df["COMP2_PRICE"], 1e-6, None))
    model_df["log_own_brand_price_index"] = np.log(np.clip(model_df["own_brand_price_index"], 1e-6, None))
    model_df["log_own_cat_price_index"] = np.log(np.clip(model_df["own_cat_price_index"], 1e-6, None))

    promo_cols_all = [f"PROMO_{i}" for i in range(1, 16)]
    promo_cols_for_model = [
        c for c in promo_cols_all
        if c in model_df.columns and model_df[c].fillna(0).abs().sum() != 0
    ]
    promo_term = " + ".join(promo_cols_for_model)

    formula = f"""
log_sales_units ~ log_price
    + log_comp1_price
    + log_comp2_price
    + log_own_brand_price_index
    {("+ " + promo_term) if promo_term else ""}
    + seasonality_index
    + holiday_flag
    + C(month)
    + C(sales_channel_short_name)
    + C(region)
    + C(store_id)
    + C(brand)
    + C(category)
"""

    y, x = dmatrices(formula, data=model_df, return_type="dataframe")
    y_ravel = np.asarray(y).reshape(-1)
    
    # Sanitize column names for XGBoost
    x.columns = x.columns.str.replace(r'[\[\]<]', '_', regex=True)

    # ---- NEW AUTO-ML LOGIC ----
    X_train, X_test, y_train, y_test = train_test_split(x, y_ravel, test_size=0.2, random_state=42)
    wmape_scorer = make_scorer(wmape_for_logs, greater_is_better=False)

    all_available_models = {
        'Ridge': (Ridge(random_state=42), {'alpha': [0.1, 1.0, 10.0]}),
        'RF': (RandomForestRegressor(random_state=42), {'n_estimators': [50, 100], 'max_depth': [None, 10, 20]}),
        'XGB': (xgb.XGBRegressor(random_state=42, objective='reg:squarederror'), {'n_estimators': [50, 100], 'learning_rate': [0.05, 0.1], 'max_depth': [3, 5]})
    }

    active_models = {k: v for k, v in all_available_models.items() if k in models_to_run}
    if not active_models:
        raise ValueError(f"No valid models selected. Available options are: {list(all_available_models.keys())}")

    best_val_wmape = float('inf')
    best_model_name = ""
    best_model_instance = None
    best_params = {}

    for name, (estimator, param_grid) in active_models.items():
        grid = GridSearchCV(estimator, param_grid, cv=3, scoring=wmape_scorer, n_jobs=-1)
        grid.fit(X_train, y_train)

        preds_log = grid.predict(X_test)
        val_wmape = wmape_for_logs(y_test, preds_log)

        if val_wmape < best_val_wmape:
            best_val_wmape = val_wmape
            best_model_name = name
            best_model_instance = grid.best_estimator_
            best_params = grid.best_params_

    # Retrain winning model on 100% of data
    model = best_model_instance
    model.fit(x, y_ravel)
    # ---------------------------

    # Decompositions use the optimal retrained model automatically
    x_base0 = x.copy()
    for col in promo_cols_for_model:
        if col in x_base0.columns:
            x_base0[col] = 0.0
    x_base0["seasonality_index"] = 1.0
    x_base0["holiday_flag"] = 0.0
    x_base0["log_comp1_price"] = 0.0
    x_base0["log_comp2_price"] = 0.0
    x_base0["log_own_brand_price_index"] = 0.0

    model_df["base0_units"] = ridge_predict_units(model, x_base0)

    x_cann = x_base0.copy()
    x_cann["log_own_brand_price_index"] = x["log_own_brand_price_index"]
    model_df["units_cann"] = ridge_predict_units(model, x_cann)
    model_df["cannibalization_effect_units"] = model_df["units_cann"] - model_df["base0_units"]

    x_comp = x_cann.copy()
    x_comp["log_comp1_price"] = x["log_comp1_price"]
    x_comp["log_comp2_price"] = x["log_comp2_price"]
    model_df["units_comp"] = ridge_predict_units(model, x_comp)
    model_df["comp_price_effect_units"] = model_df["units_comp"] - model_df["units_cann"]

    x_season = x_comp.copy()
    x_season["seasonality_index"] = x["seasonality_index"]
    model_df["units_season"] = ridge_predict_units(model, x_season)
    model_df["seasonality_effect_units"] = model_df["units_season"] - model_df["units_comp"]

    x_holiday = x_season.copy()
    x_holiday["holiday_flag"] = x["holiday_flag"]
    model_df["units_holiday"] = ridge_predict_units(model, x_holiday)
    model_df["holiday_effect_units"] = model_df["units_holiday"] - model_df["units_season"]

    x_start = x_holiday.copy()
    for col in promo_cols_for_model:
        if col in x_start.columns:
            x_start[col] = 0.0

    units_prev = ridge_predict_units(model, x_start)
    promo_effect_cols = []
    for col in promo_cols_for_model:
        x_step = x_start.copy()
        if col in x_step.columns:
            x_step[col] = x[col]
        units_step = ridge_predict_units(model, x_step)
        effect_col = f"{col}_effect_units"
        model_df[effect_col] = units_step - units_prev
        promo_effect_cols.append(effect_col)
        x_start = x_step
        units_prev = units_step

    model_df["units_with_all_promos"] = units_prev
    model_df["promo_effect_units_sum"] = model_df[promo_effect_cols].sum(axis=1) if promo_effect_cols else 0.0
    model_df["residual_units"] = model_df["sales_units"] - model_df["units_with_all_promos"]

    x_baseline_without_promo = x.copy()
    for col in promo_cols_for_model:
        if col in x_baseline_without_promo.columns:
            x_baseline_without_promo[col] = 0.0
    model_df["baseline_without_promo"] = ridge_predict_units(model, x_baseline_without_promo)

    fitted_units = ridge_predict_units(model, x)
    actual_units = model_df["sales_units"].astype(float).to_numpy()

    output_columns = [
        "base0_units",
        "baseline_without_promo",
        "units_with_all_promos",
        "cannibalization_effect_units",
        "comp_price_effect_units",
        "seasonality_effect_units",
        "holiday_effect_units",
        "promo_effect_units_sum",
        "residual_units",
    ] + promo_effect_cols

    identifier_candidates = [
        "product_id",
        "sku_id",
        "item_id",
        "store_id",
        "week_id",
        "brand",
        "category",
        "date_id",
        "date",
    ]
    result_columns = [c for c in identifier_candidates if c in model_df.columns] + output_columns
    result_df = model_df[result_columns].copy()
    for col in result_df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        result_df[col] = result_df[col].dt.strftime("%Y-%m-%d")

    summary = {
        "rowCount": int(len(model_df)),
        "featureCount": int(x.shape[1]),
        "promoColumnsUsed": promo_cols_for_model,
        "bestModel": best_model_name,
        "bestParams": best_params,
        "metrics": {
            "test_wmape": safe_float(best_val_wmape),
            "mae": safe_float(mean_absolute_error(actual_units, fitted_units)),
            "rmse": safe_float(math.sqrt(mean_squared_error(actual_units, fitted_units))),
            "r2": safe_float(r2_score(actual_units, fitted_units)),
        },
        "totals": {
            "actualUnits": safe_float(model_df["sales_units"].sum()),
            "base0Units": safe_float(model_df["base0_units"].sum()),
            "baselineWithoutPromoUnits": safe_float(model_df["baseline_without_promo"].sum()),
            "promoEffectUnits": safe_float(model_df["promo_effect_units_sum"].sum()),
            "residualUnits": safe_float(model_df["residual_units"].sum()),
        },
    }

    return {
        "success": True,
        "summary": summary,
        "predictions": result_df.where(pd.notnull(result_df), None).to_dict(orient="records"),
    }

def main() -> None:
    if len(sys.argv) < 3:
        sys.stdout.write(json.dumps({"success": False, "error": "Usage: python baseline_prediction.py <input_json> <output_json>"}) + "\n")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        with open(input_file, "r", encoding="utf-8-sig") as f:
            input_data = json.load(f)
        
        rows = input_data.get("data", [])
        
        # Read the list of models from JSON. Default to all three if missing.
        models_to_run = input_data.get("models_to_run", ["Ridge", "RF", "XGB"])
        
        output_data = safe_serialize(run_baseline_prediction(rows, models_to_run=models_to_run))
        
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2)
            
        sys.stdout.write(json.dumps({
            "success": True, 
            "message": f"Baseline prediction complete for {output_data['summary']['rowCount']} rows using {output_data['summary']['bestModel']}."
        }) + "\n")
        
    except Exception as exc:
        error_data = {"success": False, "error": str(exc)}
        try:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(error_data, f, indent=2)
        except Exception:
            pass
        sys.stdout.write(json.dumps(error_data) + "\n")
        sys.exit(1)

if __name__ == "__main__":
    main()