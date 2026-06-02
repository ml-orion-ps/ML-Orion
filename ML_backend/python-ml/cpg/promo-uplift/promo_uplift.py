"""
Promo uplift analysis — multi-algorithm counterfactual engine.

For each active promo mechanic (discount_depth, feature_flag, display_flag, bogo_flag),
computes causal uplift via counterfactual prediction:
  uplift_units  = units(promo ON) - units(promo OFF, all else equal)
  pct_uplift    = uplift_units / units(promo OFF)

Supported algorithms:
  Linear  : Ridge (default), Lasso, ElasticNet  — use patsy design matrix + log(units)
  Tree    : RandomForest, XGBoost, GradientBoosting, LightGBM — sklearn pipeline + log(units)

Usage:
    python promo_uplift.py <input_json_file> <output_json_file>
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
import warnings
from typing import Any

for pkg in ["pandas", "numpy", "scikit-learn", "patsy", "packaging"]:
    try:
        __import__(pkg.replace("-", "_") if pkg != "scikit-learn" else "sklearn")
    except ImportError:
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", pkg], check=False, capture_output=True)
        except Exception:
            pass

import numpy as np
import pandas as pd
from patsy import dmatrices
from sklearn.linear_model import Ridge, Lasso, ElasticNet
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import OrdinalEncoder
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

try:
    from xgboost import XGBRegressor
    _HAS_XGB = True
except ImportError:
    _HAS_XGB = False

try:
    from lightgbm import LGBMRegressor
    _HAS_LGBM = True
except ImportError:
    _HAS_LGBM = False

warnings.filterwarnings("ignore")


REQUIRED_COLUMNS = {
    "sales_units", "price", "base_price",
    "store_id", "week_id", "brand", "category",
    "COMP1_PRICE", "COMP2_PRICE",
    "seasonality_index", "holiday_flag", "month", "region",
}

DEFAULT_PROMO_COLS = ["discount_depth", "feature_flag", "display_flag", "bogo_flag"]

LINEAR_ALGORITHMS = {"Ridge", "Lasso", "ElasticNet"}
TREE_ALGORITHMS   = {"RandomForest", "XGBoost", "GradientBoosting", "LightGBM"}

CAT_FEATURES = ["region", "brand", "category", "store_id", "week_id"]
NUM_FEATURES  = [
    "price", "base_price", "COMP1_PRICE", "COMP2_PRICE",
    "seasonality_index", "holiday_flag", "month",
    "discount_depth", "feature_flag", "display_flag", "bogo_flag",
]


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
        raise ValueError(f"Missing required columns for promo uplift: {', '.join(missing)}")


def _prepare_dataframe(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        raise ValueError("No rows provided for promo uplift")
    df = pd.DataFrame(rows).copy()
    _ensure_columns(df)
    numeric_cols = [
        "sales_units", "price", "base_price",
        "COMP1_PRICE", "COMP2_PRICE",
        "seasonality_index", "holiday_flag", "month",
        "discount_depth", "feature_flag", "display_flag", "bogo_flag",
    ]
    for col in numeric_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df[(df["price"] > 0) & (df["base_price"] > 0) & (df["sales_units"] > 0)].copy()
    if df.empty:
        raise ValueError("No valid rows remain after filtering positive price/base_price/sales_units")
    return df


def _make_linear_model(algorithm: str, alpha: float):
    if algorithm == "Lasso":
        return Lasso(alpha=alpha, max_iter=10000, random_state=42)
    if algorithm == "ElasticNet":
        return ElasticNet(alpha=alpha, l1_ratio=0.5, max_iter=10000, random_state=42)
    return Ridge(alpha=alpha, random_state=42)


def _make_tree_model(algorithm: str):
    if algorithm == "XGBoost":
        if not _HAS_XGB:
            raise ValueError("XGBoost is not installed. Run: pip install xgboost")
        return XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.05,
                            subsample=0.8, colsample_bytree=0.8,
                            random_state=42, verbosity=0)
    if algorithm == "GradientBoosting":
        return GradientBoostingRegressor(n_estimators=300, max_depth=5,
                                         learning_rate=0.05, subsample=0.8,
                                         random_state=42)
    if algorithm == "LightGBM":
        if not _HAS_LGBM:
            raise ValueError("LightGBM is not installed. Run: pip install lightgbm")
        return LGBMRegressor(n_estimators=300, max_depth=6, learning_rate=0.05,
                             random_state=42, verbosity=-1)
    # Default: RandomForest
    return RandomForestRegressor(n_estimators=200, max_depth=10, min_samples_leaf=5,
                                  random_state=42, n_jobs=-1)


def _predict_units(model, X: np.ndarray) -> np.ndarray:
    yhat_log = model.predict(X)
    return np.exp(np.asarray(yhat_log).reshape(-1))


# ── Linear (patsy) path ──────────────────────────────────────────────────────

def _run_linear_uplift(model_df: pd.DataFrame, algorithm: str, alpha: float,
                       active_promo_cols: list[str], channel_col: str,
                       custom_feature_names: list[str] | None = None) -> tuple:
    """Fit linear model via patsy, return (model, X_design, fitted_units, actual_units)."""
    model_df = model_df.copy()
    model_df["log_sales_units"] = np.log(model_df["sales_units"])
    model_df["log_price"] = np.log(model_df["price"])
    model_df["avg_brand_price_store_week"] = (
        model_df.groupby(["store_id", "week_id", "brand"])["price"].transform("mean")
    )
    model_df["own_brand_price_index"] = model_df["price"] / model_df["avg_brand_price_store_week"]
    model_df["log_comp1_price"] = np.log(np.clip(model_df["COMP1_PRICE"], 1e-6, None))
    model_df["log_comp2_price"] = np.log(np.clip(model_df["COMP2_PRICE"], 1e-6, None))
    model_df["log_own_brand_price_index"] = np.log(np.clip(model_df["own_brand_price_index"], 1e-6, None))

    promo_term = " + ".join(active_promo_cols)

    # Append any custom numeric features that exist in the dataframe
    custom_terms = ""
    if custom_feature_names:
        valid_custom = [
            n for n in custom_feature_names
            if n in model_df.columns and pd.api.types.is_numeric_dtype(model_df[n])
        ]
        for n in valid_custom:
            model_df[n] = pd.to_numeric(model_df[n], errors="coerce").fillna(0)
        if valid_custom:
            custom_terms = " + " + " + ".join(valid_custom)

    formula = f"""
log_sales_units ~ log_price
    + log_comp1_price + log_comp2_price + log_own_brand_price_index
    + {promo_term}
    + seasonality_index + holiday_flag
    + C(month) + C({channel_col}) + C(region) + C(store_id) + C(brand) + C(category){custom_terms}
"""
    y, X = dmatrices(formula, data=model_df, return_type="dataframe")
    model = _make_linear_model(algorithm, alpha)
    model.fit(X, np.asarray(y).reshape(-1))
    fitted_units = _predict_units(model, X)
    actual_units = model_df["sales_units"].astype(float).to_numpy()
    return model, X, model_df, fitted_units, actual_units


def _linear_counterfactual(model, X: pd.DataFrame, model_df: pd.DataFrame,
                            active_promo_cols: list[str]) -> tuple[list[str], list[str]]:
    """Compute counterfactual uplift columns in model_df, return (uplift_cols, pct_cols)."""
    uplift_cols: list[str] = []
    pct_uplift_cols: list[str] = []
    for promo_col in active_promo_cols:
        uplift_col = f"uplift_{promo_col}"
        pct_uplift_col = f"pct_uplift_{promo_col}"
        model_df[uplift_col] = 0.0
        model_df[pct_uplift_col] = np.nan
        promo_mask = model_df[promo_col] > 0
        if promo_mask.sum() == 0:
            continue
        units_on  = _predict_units(model, X)[promo_mask.values]
        X_off = X.copy()
        if promo_col in X_off.columns:
            X_off.loc[promo_mask, promo_col] = 0.0
        units_off = _predict_units(model, X_off)[promo_mask.values]
        model_df.loc[promo_mask, uplift_col] = units_on - units_off
        model_df.loc[promo_mask, pct_uplift_col] = (units_on - units_off) / np.maximum(units_off, 1e-9)
        uplift_cols.append(uplift_col)
        pct_uplift_cols.append(pct_uplift_col)
    return uplift_cols, pct_uplift_cols


# ── Tree path ────────────────────────────────────────────────────────────────

def _run_tree_uplift(model_df: pd.DataFrame, algorithm: str,
                     active_promo_cols: list[str],
                     custom_feature_names: list[str] | None = None) -> tuple:
    """Fit tree model via sklearn pipeline, return (model, enc, X_arr, fitted_units, actual_units)."""
    df = model_df.copy()
    df["log_sales_units"] = np.log(df["sales_units"])

    # Build available feature lists; include any detected promo cols not in NUM_FEATURES
    num_feats = [c for c in NUM_FEATURES if c in df.columns]
    for _pc in active_promo_cols:
        if _pc in df.columns and _pc not in num_feats:
            num_feats.append(_pc)
    cat_feats  = [c for c in CAT_FEATURES if c in df.columns]

    # Append custom features (numeric only) that aren't already in the feature lists
    if custom_feature_names:
        existing = set(num_feats) | set(cat_feats)
        for n in custom_feature_names:
            if n in df.columns and n not in existing:
                df[n] = pd.to_numeric(df[n], errors="coerce").fillna(0)
                num_feats.append(n)

    # Fill missing numeric cols with 0
    for c in num_feats:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)

    # Ordinal-encode categoricals
    enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)
    cat_arr = enc.fit_transform(df[cat_feats].astype(str)) if cat_feats else np.empty((len(df), 0))
    num_arr = df[num_feats].values.astype(float)
    X = np.hstack([num_arr, cat_arr])

    y = df["log_sales_units"].values
    model = _make_tree_model(algorithm)
    model.fit(X, y)

    fitted_units = _predict_units(model, X)
    actual_units = df["sales_units"].astype(float).to_numpy()
    return model, enc, df, X, num_feats, cat_feats, fitted_units, actual_units


def _tree_counterfactual(model, enc, model_df: pd.DataFrame, X: np.ndarray,
                          num_feats: list[str], cat_feats: list[str],
                          active_promo_cols: list[str]) -> tuple[list[str], list[str]]:
    uplift_cols: list[str] = []
    pct_uplift_cols: list[str] = []
    for promo_col in active_promo_cols:
        uplift_col = f"uplift_{promo_col}"
        pct_uplift_col = f"pct_uplift_{promo_col}"
        model_df[uplift_col] = 0.0
        model_df[pct_uplift_col] = np.nan
        promo_mask = model_df[promo_col] > 0
        if promo_mask.sum() == 0:
            continue
        # Build X_off: same as X but promo column zeroed
        X_off = X.copy()
        if promo_col in num_feats:
            col_idx = num_feats.index(promo_col)
            X_off[promo_mask.values, col_idx] = 0.0
        units_on  = _predict_units(model, X)[promo_mask.values]
        units_off = _predict_units(model, X_off)[promo_mask.values]
        model_df.loc[promo_mask, uplift_col] = units_on - units_off
        model_df.loc[promo_mask, pct_uplift_col] = (units_on - units_off) / np.maximum(units_off, 1e-9)
        uplift_cols.append(uplift_col)
        pct_uplift_cols.append(pct_uplift_col)
    return uplift_cols, pct_uplift_cols


# ── Shared summary builder ────────────────────────────────────────────────────

def _build_promo_summary(model_df: pd.DataFrame, active_promo_cols: list[str]) -> dict:
    summaries: dict = {}
    for promo_col in active_promo_cols:
        uplift_col = f"uplift_{promo_col}"
        pct_uplift_col = f"pct_uplift_{promo_col}"
        if uplift_col not in model_df.columns:
            continue
        active_rows = model_df[model_df[promo_col] > 0]
        summaries[promo_col] = {
            "activeRows": int((model_df[promo_col] > 0).sum()),
            "totalUpliftUnits": safe_float(float(model_df[uplift_col].sum())),
            "avgPctUplift": safe_float(
                float(active_rows[pct_uplift_col].mean()) if len(active_rows) > 0 and pct_uplift_col in active_rows.columns else 0.0
            ),
        }
    return summaries


def _build_result_df(model_df: pd.DataFrame, active_promo_cols: list[str],
                     uplift_cols: list[str], pct_cols: list[str]) -> pd.DataFrame:
    identifier_candidates = [
        "product_id", "sku_id", "item_id", "store_id", "week_id",
        "brand", "category", "date_id", "date",
    ]
    result_cols = (
        [c for c in identifier_candidates if c in model_df.columns]
        + active_promo_cols + uplift_cols + pct_cols
    )
    df = model_df[result_cols].copy()
    for col in df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        df[col] = df[col].dt.strftime("%Y-%m-%d")
    return df


# ── Main entry ───────────────────────────────────────────────────────────────

def run_promo_uplift(rows: list[dict], algorithm: str = "Ridge",
                     alpha: float = 1.0, promo_cols: list[str] | None = None,
                     custom_feature_names: list[str] | None = None) -> dict:
    import re as _re
    algorithm = algorithm.strip()
    model_df = _prepare_dataframe(rows)

    candidates = promo_cols if promo_cols else DEFAULT_PROMO_COLS
    active_promo_cols = [
        c for c in candidates
        if c in model_df.columns and model_df[c].fillna(0).abs().sum() != 0
    ]
    # Fallback: auto-detect PROMO_N columns (e.g. PROMO_1 … PROMO_15)
    if not active_promo_cols:
        active_promo_cols = sorted(
            [c for c in model_df.columns
             if _re.match(r'^PROMO_\d+$', c, _re.IGNORECASE)
             and model_df[c].fillna(0).abs().sum() != 0],
            key=lambda c: int(_re.search(r'\d+', c).group()),
        )
    if not active_promo_cols:
        all_candidates = list(candidates) + ["PROMO_N (e.g. PROMO_1, PROMO_2, ...)"]
        raise ValueError(
            f"No active promo columns found. Expected at least one of: {', '.join(all_candidates)}"
        )

    if algorithm in LINEAR_ALGORITHMS:
        channel_col = next(
            (c for c in ["channel", "sales_channel_short_name", "sales_channel"] if c in model_df.columns),
            None,
        )
        if channel_col is None:
            raise ValueError("No channel column found. Expected 'channel' or 'sales_channel_short_name'")
        model, X_design, model_df, fitted_units, actual_units = _run_linear_uplift(
            model_df, algorithm, alpha, active_promo_cols, channel_col,
            custom_feature_names=custom_feature_names,
        )
        uplift_cols, pct_cols = _linear_counterfactual(model, X_design, model_df, active_promo_cols)
        feature_count = int(X_design.shape[1])
    else:
        model, enc, model_df, X_arr, num_feats, cat_feats, fitted_units, actual_units = _run_tree_uplift(
            model_df, algorithm, active_promo_cols,
            custom_feature_names=custom_feature_names,
        )
        uplift_cols, pct_cols = _tree_counterfactual(
            model, enc, model_df, X_arr, num_feats, cat_feats, active_promo_cols
        )
        feature_count = len(num_feats) + len(cat_feats)

    promo_summaries = _build_promo_summary(model_df, active_promo_cols)
    result_df = _build_result_df(model_df, active_promo_cols, uplift_cols, pct_cols)

    summary = {
        "algorithm": algorithm,
        "rowCount": int(len(model_df)),
        "featureCount": feature_count,
        "promoColumnsUsed": active_promo_cols,
        "metrics": {
            "mae":  safe_float(mean_absolute_error(actual_units, fitted_units)),
            "rmse": safe_float(math.sqrt(mean_squared_error(actual_units, fitted_units))),
            "r2":   safe_float(r2_score(actual_units, fitted_units)),
        },
        "promoSummary": promo_summaries,
        "totals": {
            "actualUnits": safe_float(float(model_df["sales_units"].sum())),
            **{
                f"totalUplift_{c}": safe_float(float(model_df[f"uplift_{c}"].sum()))
                for c in active_promo_cols
                if f"uplift_{c}" in model_df.columns
            },
        },
    }

    return {
        "success": True,
        "summary": summary,
        "predictions": result_df.where(pd.notnull(result_df), None).to_dict(orient="records"),
    }


def main() -> None:
    if len(sys.argv) < 3:
        sys.stdout.write(
            json.dumps({"success": False, "error": "Usage: python promo_uplift.py <input_json> <output_json>"}) + "\n"
        )
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        with open(input_file, "r", encoding="utf-8-sig") as f:
            input_data = json.load(f)
        rows       = input_data.get("data", [])
        algorithm  = str(input_data.get("algorithm", "Ridge"))
        alpha      = float(input_data.get("alpha", 1.0))
        promo_cols = input_data.get("promoCols") or None

        output_data = safe_serialize(run_promo_uplift(rows, algorithm=algorithm, alpha=alpha, promo_cols=promo_cols))

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2)

        sys.stdout.write(
            json.dumps({
                "success": True,
                "message": f"[{algorithm}] Promo uplift complete for {output_data['summary']['rowCount']} rows",
            }) + "\n"
        )
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
