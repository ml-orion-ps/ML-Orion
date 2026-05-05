import numpy as np
import pandas as pd
import json
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.stattools import adfuller
import lightgbm as lgb

from sklearn.metrics import mean_absolute_error, root_mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.feature_selection import mutual_info_regression
from sklearn.preprocessing import StandardScaler



with open("config.txt", "r") as f:
    config = json.load(f)

data_cfg = config["data"]
model_cfg = config["model"]
baseline_usage = config["baseline_usage"]
exog_cfg = config["exog"]


def prepare_series_for_model(series_df, config, min_length):

    df = series_df.copy()

    dt_col = config["date"]["datetime_col"]
    target_col = config["date"]["target_col"]
    baseline_col = config["date"]["baseline_col"]
    group_keys = config["date"].get("groupby_keys", [])
    min_length = config["model"]["min_len_ts"]

    # convert to TS and set index and frequency
    df[dt_col] = pd.to_datetime(df[dt_col])
    df = df.sort_values(dt_col).reset_index(drop=True)
    df = df.set_index(dt_col)
    freq = config["model"]["frequency"]

    # create continous indexing (fill for missing dates)
    full_idx = pd.date_range(start=df.index.min(), end=df.index.max(), freq=freq)
    df = df.reindex(full_idx)
    df[target_col] = df[target_col].fillna(0)

    # fill for group keys (if present)
    for k in group_keys:
        if k in series_df.columns:
            val = series_df[k].dropna().unique()
            if len(val) > 0:
                df[k] = val[0]

    n_non_null_target = df[target_col].dropna().shape[0]
    if n_non_null_target < min_length:
        return df, "too_short"

    return df, None


def preprocess_demand_data(df, target_col, promo_col):
    df_clean = df.copy()
    
    # Ensure date format
    df_clean['Week_Date'] = pd.to_datetime(df_clean['Week_Date'])
    df_clean[target_col] = pd.to_numeric(df_clean[target_col], errors='coerce')

    # --- Part A: Capping Extreme Values (Non-Promo Days) ---
    baseline = df_clean[df_clean[promo_col] == 0]
    bounds = (
        baseline.groupby(granularity)[target_col]
        .agg(
            Q1=lambda s: s.quantile(0.25),
            Q3=lambda s: s.quantile(0.75)
        )
        .reset_index()
    )

    bounds['IQR'] = bounds['Q3'] - bounds['Q1']
    bounds['lower_bound'] = bounds['Q1'] - 3 * bounds['IQR']
    bounds['upper_bound'] = bounds['Q3'] + 3 * bounds['IQR']

    df_clean = df_clean.merge(
        bounds[[granularity, 'lower_bound', 'upper_bound']],
        on=granularity,
        how='left'
    )

    # Cap only baseline rows
    mask = df_clean[promo_col] == 0
    df_clean.loc[mask, target_col] = df_clean.loc[mask, target_col].clip(
        lower=df_clean.loc[mask, 'lower_bound'],
        upper=df_clean.loc[mask, 'upper_bound']
    )

    # Cleanup
    df_clean = df_clean.drop(columns=['lower_bound', 'upper_bound'])

    
    # --- Part B: Feature Scaling ---
    
    scaler = StandardScaler()
    numerical_cols = ['Final Retail Price', 'Final Cost', 'Net Invoiced (USD)']
    
    # Fill any NaNs before scaling to prevent errors
    df_clean[numerical_cols] = df_clean[numerical_cols].fillna(df_clean[numerical_cols].median())
    
    # Apply Scaling
    df_clean[numerical_cols] = scaler.fit_transform(df_clean[numerical_cols])
    
    return df_clean, scaler

