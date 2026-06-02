import pandas as pd
import numpy as np


REQUIRED_COLUMNS = [
    "date",
    "price",
    "sales_units",
    "store_id",
    "week_id",
    "brand",
    "category",
    "sku_id",
    "pack_size",
]


def validate_columns(df: pd.DataFrame):

    missing_cols = [
        col for col in REQUIRED_COLUMNS
        if col not in df.columns
    ]

    if missing_cols:
        raise ValueError(
            f"Missing required columns: {missing_cols}"
        )


def preprocess_data(df: pd.DataFrame):

    validate_columns(df)

    df = df.copy()

    # Date
    df["date"] = pd.to_datetime(df["date"])

    # Filter
    df = df[
        (df["price"] > 0) &
        (df["sales_units"] > 0)
    ].copy()

    # Fill competitor prices (default to own price if column absent)
    if "comp1_price" not in df.columns:
        df["comp1_price"] = df["price"]
    else:
        df["comp1_price"] = df["comp1_price"].fillna(df["price"])

    if "comp2_price" not in df.columns:
        df["comp2_price"] = df["price"]
    else:
        df["comp2_price"] = df["comp2_price"].fillna(df["price"])

    # -------------------------
    # Brand Features
    # -------------------------
    df["avg_brand_price_store_week"] = (
        df.groupby(
            ["store_id", "week_id", "brand"]
        )["price"].transform("mean")
    )

    df["own_brand_price_index"] = (
        df["price"] /
        df["avg_brand_price_store_week"]
    )

    # -------------------------
    # Category Features
    # -------------------------
    df["avg_cat_price_store_week"] = (
        df.groupby(
            ["store_id", "week_id", "category"]
        )["price"].transform("mean")
    )

    df["own_cat_price_index"] = (
        df["price"] /
        df["avg_cat_price_store_week"]
    )

    # -------------------------
    # SKU Store Key
    # -------------------------
    df["sku_store"] = (
        df["sku_id"].astype(str)
        + "-"
        + df["store_id"].astype(str)
    )

    # -------------------------
    # Clip Values
    # -------------------------
    df["own_brand_price_index"] = (
        df["own_brand_price_index"]
        .clip(lower=1e-6)
    )

    df["own_cat_price_index"] = (
        df["own_cat_price_index"]
        .clip(lower=1e-6)
    )

    # -------------------------
    # Optional columns — default to zero/neutral if absent
    # -------------------------
    for col, default in [
        ("discount_depth", 0.0),
        ("feature_flag", 0),
        ("display_flag", 0),
        ("bogo_flag", 0),
        ("seasonality_index", 1.0),
        ("holiday_flag", 0),
    ]:
        if col not in df.columns:
            df[col] = default

    for col in ("channel", "region", "customer"):
        if col not in df.columns:
            df[col] = "default"

    # -------------------------
    # Log Features
    # -------------------------
    df["log_units"] = np.log(
        df["sales_units"]
    )

    df["log_price"] = np.log(
        df["price"].clip(lower=1e-6)
    )

    df["log_comp1_price"] = np.log(
        df["comp1_price"].clip(lower=1e-6)
    )

    df["log_comp2_price"] = np.log(
        df["comp2_price"].clip(lower=1e-6)
    )

    df["log_brand_idx"] = np.log(
        df["own_brand_price_index"]
    )

    df["log_cat_idx"] = np.log(
        df["own_cat_price_index"]
    )

    df["log_pack_size"] = np.log(
        df["pack_size"].clip(lower=1)
    )

    return df