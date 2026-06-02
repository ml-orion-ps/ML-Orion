import math
import numpy as np
import pandas as pd
import statsmodels.formula.api as smf


NUMERIC_TERMS = [
    "log_price",
    "log_comp1_price",
    "log_comp2_price",
    "log_brand_idx",
    "discount_depth",
    "feature_flag",
    "display_flag",
    "bogo_flag",
    "seasonality_index",
    "holiday_flag",
]

CATEGORICAL_TERMS = ["channel", "region", "customer", "brand", "category"]


def _build_formula(df: pd.DataFrame) -> str:
    terms = []

    seen_vectors: list[pd.Series] = []

    for col in NUMERIC_TERMS:
        if col not in df.columns:
            continue
        s = df[col].astype(float)
        # Drop constant columns
        if s.std() < 1e-10:
            continue
        # Drop columns perfectly collinear with an already-included term
        collinear = any(
            abs(s.corr(prev)) > 0.9999
            for prev in seen_vectors
        )
        if collinear:
            continue
        terms.append(col)
        seen_vectors.append(s)

    for col in CATEGORICAL_TERMS:
        if col in df.columns and df[col].nunique() > 1:
            terms.append(f"C({col})")

    return "log_units ~ " + " + ".join(terms)


def train_elasticity_model(df: pd.DataFrame):

    formula = _build_formula(df)

    model = smf.mixedlm(
        formula=formula,
        data=df,
        groups=df["sku_store"],
        re_formula="~log_price"
    )

    result = model.fit(
        method="lbfgs",
        maxiter=200,
    )

    return result


def extract_sku_store_elasticities(
    df: pd.DataFrame,
    result
):

    fixed_effects = result.params

    global_price_elasticity = (
        fixed_effects.get(
            "log_price",
            np.nan
        )
    )

    random_effects = result.random_effects

    re_df = pd.DataFrame(
        random_effects
    ).T

    re_df.index.name = "sku_store"

    if "log_price" not in re_df.columns:
        re_df["log_price"] = 0.0

    re_df[
        "elasticity_price_sku_store"
    ] = (
        global_price_elasticity +
        re_df["log_price"]
    )

    sku_store_elasticities = (
        re_df[
            ["elasticity_price_sku_store"]
        ].reset_index()
    )

    sku_store_elasticities[
        ["sku_id", "store_id"]
    ] = (
        sku_store_elasticities["sku_store"]
        .str.split("-", n=1, expand=True)
    )

    sku_store_elasticities = (
        sku_store_elasticities[
            [
                "sku_id",
                "store_id",
                "elasticity_price_sku_store"
            ]
        ]
    )

    sku_store_elasticities["store_id"] = (
        sku_store_elasticities["store_id"]
        .astype(df["store_id"].dtype)
    )

    sku_store_elasticities["sku_id"] = (
        sku_store_elasticities["sku_id"]
        .astype(df["sku_id"].dtype)
    )

    return sku_store_elasticities


def _safe(v):
    """Return None for NaN/Inf so JSON serialisation never breaks."""
    if v is None:
        return None
    try:
        return None if (math.isnan(v) or math.isinf(v)) else float(v)
    except Exception:
        return None


def extract_evaluation_metrics(result, df: pd.DataFrame) -> dict:
    """Compute standard evaluation metrics from a fitted MixedLM result."""
    resid = result.resid
    y = df["log_units"].dropna()

    ss_res = float(np.sum(resid ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = _safe(1.0 - ss_res / ss_tot) if ss_tot > 0 else None

    mae  = _safe(float(np.mean(np.abs(resid))))
    rmse = _safe(float(np.sqrt(np.mean(resid ** 2))))

    aic = _safe(result.aic)  if hasattr(result, "aic") else None
    bic = _safe(result.bic)  if hasattr(result, "bic") else None
    llf = _safe(result.llf)  if hasattr(result, "llf") else None

    pvalues = getattr(result, "pvalues", {})
    bse     = getattr(result, "bse",     {})
    tvalues = getattr(result, "tvalues", {})

    return {
        "r2":               r2,
        "mae":              mae,
        "rmse":             rmse,
        "aic":              aic,
        "bic":              bic,
        "logLikelihood":    llf,
        "priceCoefPvalue":  _safe(pvalues.get("log_price")),
        "priceCoefStdErr":  _safe(bse.get("log_price")),
        "priceCoefTstat":   _safe(tvalues.get("log_price")),
    }