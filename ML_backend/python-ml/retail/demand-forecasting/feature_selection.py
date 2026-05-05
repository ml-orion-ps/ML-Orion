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


from datetime import timedelta

with open("config.txt", "r") as f:
    config = json.load(f)

data_cfg = config["data"]
model_cfg = config["model"]
baseline_usage = config["baseline_usage"]
exog_cfg = config["exog"]


def select_exog_features_correlation(df, target_col, exog_cols, corr_threshold, max_features):
    scores = []
    for c in exog_cols:
        if c not in df.columns:
            continue
        try:
            corr = df[target_col].corr(df[c])
            scores.append((c, abs(corr)))
        except Exception:
            continue
    scores.sort(key=lambda x: x[1], reverse=True)
    selected = [c for c, s in scores if s >= corr_threshold][:max_features]
    return selected

def select_exog_features_mutual_info(df, target_col, exog_cols, topk: int):
    tmp = df[[target_col] + [c for c in exog_cols if c in df.columns]].dropna()

    ## if the data points are too less, return the whole exog variable list
    if tmp.shape[0] < config["model"]["min_len_ts"]:
        return [c for c in exog_cols if c in df.columns]
    
    ## if sufficient data points, go for mutual info check and feature selection    
    X = tmp[[c for c in exog_cols if c in tmp.columns]]
    y = tmp[target_col].values
    try:
        scaler = StandardScaler()
        Xs = scaler.fit_transform(X)
    except Exception:
        Xs = X.values
    mi = mutual_info_regression(Xs, y)
    mi_scores = list(zip(X.columns.tolist(), mi))
    mi_scores.sort(key=lambda x: x[1], reverse=True)
    selected = [c for c, s in mi_scores][:topk]
    return selected


def build_exog_matrix(series_df, config, model_name):
    """
    Returns exog DataFrame aligned to series_df (which must be indexed by datetime).
    """

    data_cfg = config["data"]
    feat_cfg = config["feature_selection"]
    use_exog_flag = data_cfg["exogenous"]["use_exog"]
    candidate_exogs = data_cfg["exogenous"].get("include", [])
    baseline_col = data_cfg.get("baseline_col")
    baseline_strategy = config.get("baseline_usage", {}).get(model_name, "ignore")

    # Build initial list
    exog_list = []
    if use_exog_flag:
        exog_list += [c for c in candidate_exogs if c in series_df.columns]

    # Baseline precedence
    if baseline_strategy == "as_exog" and baseline_col in series_df.columns:
        if baseline_col not in exog_list:
            exog_list.append(baseline_col)

    if not exog_list:
        return None

    # Auto-select if requested (operates per series)
    if feat_cfg.get("auto_exog_selection", False):
        method = feat_cfg.get("exog_selection_method", "correlation")
        if method == "mutual_info":
            selected = select_exog_features_mutual_info(series_df, data_cfg["target_col"], exog_list,
                                                        topk=feat_cfg.get("mutual_info_topk", 5))
        elif method == "correlation":
            selected = select_exog_features_correlation(series_df, data_cfg["target_col"], exog_list,
                                                        corr_threshold=feat_cfg.get("correlation_threshold", 0.05),
                                                        max_features=feat_cfg.get("max_features", 5))
        exog_list = [c for c in selected if c in series_df.columns]

    if not exog_list:
        return None

    # Return DataFrame aligned to series_df index
    return series_df[exog_list].copy()




def engineer_features(df, target_col, price_col, promo_col, date_col):
    # Ensure data is sorted temporally within each style
    df = df.sort_values(by=[granularity, date_col]).copy()
    
    # Extract temporal component for Payday (First 7 days of the month)
    df['is_payday_week'] = (df[date_col].dt.day <= 7).astype(int)
    
    grouped = df.groupby(granularity)

    # # a. Lags (Target)
    df['lag_1_qty'] = grouped[target_col].shift(1)
    df['lag_4_qty'] = grouped[target_col].shift(4)

    # c. Price Elasticity (Proxies)
    # Use transform to calculate the rolling mean natively within the original index
    rolling_mean_price = grouped[price_col].transform(
        lambda x: x.shift(1).rolling(window=4, min_periods=1).mean()
    )
    df['price_index'] = df[price_col] / (rolling_mean_price + 1e-5)

    # d. Promo Features
    df['promo_lag_1'] = grouped[promo_col].shift(1)
    df['promo_rolling_2w'] = grouped[promo_col].transform(
        lambda x: x.rolling(window=2, min_periods=1).sum()
    )
    
    # f. Fourier Series for Seasonality
    # cumcount() gives us a localized time step (0, 1, 2...) for each group
    # We add 1 to start at t=1
    df['t'] = grouped.cumcount() + 1
    period = 52.143 # Average weeks in a year
    
    # Order 1 (Annual wave)
    df['sin_1'] = np.sin(2 * np.pi * 1 * df['t'] / period)
    df['cos_1'] = np.cos(2 * np.pi * 1 * df['t'] / period)
    
    # Order 2 (Bi-annual wave / 6-month cycles)
    df['sin_2'] = np.sin(2 * np.pi * 2 * df['t'] / period)
    df['cos_2'] = np.cos(2 * np.pi * 2 * df['t'] / period)
    
    # Clean up the temporary time step column
    df = df.drop(columns=['t'])
    
    return df

