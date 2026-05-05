"""
Promo uplift analysis script.

For each active promo mechanic (discount_depth, feature_flag, display_flag, bogo_flag),
computes TRUE causal uplift via counterfactual prediction:
  uplift_units     = units(promo ON)  - units(promo OFF, all else equal)
  pct_uplift       = uplift_units / units(promo OFF)

Only rows where the mechanic is active (> 0) receive an uplift estimate.

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
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

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
    "region",
}

DEFAULT_PROMO_COLS = ["discount_depth", "feature_flag", "display_flag", "bogo_flag"]


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


def ridge_predict_units(model: Ridge, design_matrix: pd.DataFrame) -> np.ndarray:
    yhat_log = model.predict(design_matrix)
    return np.exp(np.asarray(yhat_log).reshape(-1))


def run_promo_uplift(rows: list[dict], alpha: float = 1.0, promo_cols: list[str] | None = None) -> dict:
    model_df = _prepare_dataframe(rows)

    # Determine which promo columns are present and have non-zero activity
    candidates = promo_cols if promo_cols else DEFAULT_PROMO_COLS
    active_promo_cols = [
        c for c in candidates
        if c in model_df.columns and model_df[c].fillna(0).abs().sum() != 0
    ]
    if not active_promo_cols:
        raise ValueError(
            f"No active promo columns found. Expected at least one of: {', '.join(candidates)}"
        )

    # Feature engineering
    model_df["log_sales_units"] = np.log(model_df["sales_units"])
    # Use actual transaction price so discount_depth captures the promo component separately
    model_df["log_price"] = np.log(model_df["price"])

    model_df["avg_brand_price_store_week"] = (
        model_df.groupby(["store_id", "week_id", "brand"])["price"].transform("mean")
    )
    model_df["own_brand_price_index"] = model_df["price"] / model_df["avg_brand_price_store_week"]

    model_df["log_comp1_price"] = np.log(np.clip(model_df["COMP1_PRICE"], 1e-6, None))
    model_df["log_comp2_price"] = np.log(np.clip(model_df["COMP2_PRICE"], 1e-6, None))
    model_df["log_own_brand_price_index"] = np.log(np.clip(model_df["own_brand_price_index"], 1e-6, None))

    # Resolve channel column (accept either name)
    channel_col = next(
        (c for c in ["channel", "sales_channel_short_name", "sales_channel"] if c in model_df.columns),
        None,
    )
    if channel_col is None:
        raise ValueError("No channel column found. Expected 'channel' or 'sales_channel_short_name'")

    promo_term = " + ".join(active_promo_cols)
    formula = f"""
log_sales_units ~ log_price
    + log_comp1_price
    + log_comp2_price
    + log_own_brand_price_index
    + {promo_term}
    + seasonality_index
    + holiday_flag
    + C(month)
    + C({channel_col})
    + C(region)
    + C(store_id)
    + C(brand)
    + C(category)
"""

    y, X = dmatrices(formula, data=model_df, return_type="dataframe")
    model = Ridge(alpha=alpha, random_state=42)
    model.fit(X, np.asarray(y).reshape(-1))

    fitted_units = ridge_predict_units(model, X)
    actual_units = model_df["sales_units"].astype(float).to_numpy()

    # Counterfactual uplift for each promo mechanic
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

        # Promo ON: use actual design matrix (promo active)
        units_on = ridge_predict_units(model, X)[promo_mask.values]

        # Promo OFF: zero out only this mechanic in the design matrix
        X_off = X.copy()
        X_off.loc[promo_mask, promo_col] = 0.0
        units_off = ridge_predict_units(model, X_off)[promo_mask.values]

        model_df.loc[promo_mask, uplift_col] = units_on - units_off
        model_df.loc[promo_mask, pct_uplift_col] = (units_on - units_off) / np.maximum(units_off, 1e-9)

        uplift_cols.append(uplift_col)
        pct_uplift_cols.append(pct_uplift_col)

    # Build result dataframe with identifiers + promo values + uplift columns
    identifier_candidates = [
        "product_id", "sku_id", "item_id", "store_id", "week_id",
        "brand", "category", "date_id", "date",
    ]
    result_columns = (
        [c for c in identifier_candidates if c in model_df.columns]
        + active_promo_cols
        + uplift_cols
        + pct_uplift_cols
    )
    result_df = model_df[result_columns].copy()
    for col in result_df.select_dtypes(include=["datetime64[ns]", "datetimetz"]).columns:
        result_df[col] = result_df[col].dt.strftime("%Y-%m-%d")

    # Per-mechanic summary
    promo_summaries: dict = {}
    for promo_col in active_promo_cols:
        uplift_col = f"uplift_{promo_col}"
        pct_uplift_col = f"pct_uplift_{promo_col}"
        active_rows = model_df[model_df[promo_col] > 0]
        promo_summaries[promo_col] = {
            "activeRows": int((model_df[promo_col] > 0).sum()),
            "totalUpliftUnits": safe_float(model_df[uplift_col].sum()),
            "avgPctUplift": safe_float(
                float(active_rows[pct_uplift_col].mean()) if len(active_rows) > 0 else 0.0
            ),
        }

    summary = {
        "rowCount": int(len(model_df)),
        "featureCount": int(X.shape[1]),
        "promoColumnsUsed": active_promo_cols,
        "metrics": {
            "mae": safe_float(mean_absolute_error(actual_units, fitted_units)),
            "rmse": safe_float(math.sqrt(mean_squared_error(actual_units, fitted_units))),
            "r2": safe_float(r2_score(actual_units, fitted_units)),
        },
        "promoSummary": promo_summaries,
        "totals": {
            "actualUnits": safe_float(float(model_df["sales_units"].sum())),
            **{
                f"totalUplift_{c}": safe_float(float(model_df[f"uplift_{c}"].sum()))
                for c in active_promo_cols
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
            json.dumps({"success": False, "error": "Usage: python promo_uplift.py <input_json> <output_json>"})
            + "\n"
        )
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        with open(input_file, "r", encoding="utf-8-sig") as f:
            input_data = json.load(f)
        rows = input_data.get("data", [])
        alpha = float(input_data.get("alpha", 1.0))
        promo_cols = input_data.get("promoCols") or None

        output_data = safe_serialize(run_promo_uplift(rows, alpha=alpha, promo_cols=promo_cols))

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2)

        sys.stdout.write(
            json.dumps({
                "success": True,
                "message": f"Promo uplift complete for {output_data['summary']['rowCount']} rows",
            })
            + "\n"
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
