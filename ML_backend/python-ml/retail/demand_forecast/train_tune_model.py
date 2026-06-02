import pandas as pd
import numpy as np
import json
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.statespace.sarimax import SARIMAX
from statsmodels.tsa.stattools import adfuller
from sklearn.metrics import mean_squared_error, r2_score
import xgboost as xgb
import lightgbm as lgb
import warnings
import re
import itertools
from sklearn.model_selection import RandomizedSearchCV
warnings.filterwarnings("ignore")

# Ordered list of engineered exogenous features fed to SARIMAX / XGBoost / LightGBM.
# Custom features (built via feature builder) are appended dynamically after these.
EXOG_FEATURES = [
    'Final Retail Price',
    'Flag',
    'lag_1_qty',
    'lag_4_qty',
    # 'promo_rolling_2w',
    # 'is_payday_week',
    # 'price_index',
    # 'promo_lag_1',
    'sin_1', 'cos_1',
    'sin_2', 'cos_2',
]

# --- EVALUATION ---
import numpy as np

def evaluate_metrics(y_true, y_pred):
    y_true = np.array(y_true).astype(float)
    y_pred = np.array(y_pred).astype(float)

    # --- MAPE (with your zero-handling logic) ---
    with np.errstate(divide='ignore', invalid='ignore'):
        ape = np.abs((y_true - y_pred) / y_true)
        ape = np.where(y_true == 0, np.where(y_pred == 0, 0.0, 1.0), ape) # If y_true is 0, check if y_pred is also 0.
    mape = np.mean(ape) * 100

    # --- WMAPE RECTIFICATION ---
    total_actual = np.sum(y_true)
    total_abs_error = np.sum(np.abs(y_true - y_pred))
    if total_actual == 0:
        wmape = 0.0 if total_abs_error == 0 else 100.0
    else:
        wmape = (total_abs_error / total_actual) * 100
    
    # --- RMSE (Scale-dependent: tells you error in actual units) ---
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    
    # --- R^2 (Goodness of fit) ---
    # Note: R^2 can be negative if the model is worse than a horizontal line
    r2 = r2_score(y_true, y_pred)
    
    return {
        "mape": round(float(mape), 2),
        "wmape": round(float(wmape), 2),
        "rmse": round(float(rmse), 2),
        "r2": round(float(r2), 4)
    }

def infer_d(series, alpha=0.05):

    try:
        pvalue = adfuller(series.dropna())[1]

        return 0 if pvalue < alpha else 1

    except:
        return 1

# --- MODEL FUNCTIONS ---
def run_exp_smoothing(train_y, test_len):
    # Fallback model: No exogenous features required
    model = ExponentialSmoothing(train_y, trend='add', seasonal=None, initialization_method="estimated")
    fit_model = model.fit()
    return fit_model.forecast(test_len).values

def run_sarima(train_y, test_len):
    # Define a small grid for (p, d, q) ranging from 0 to 1
    p = d = q = range(0, 2) 
    pdq = list(itertools.product(p, d, q))
    
    best_aic = float("inf")
    best_order = (1, 1, 1) # Fallback if loop fails
    
    # Simple search for the lowest AIC
    for order in pdq:
        try:
            # enforce_stationarity=False helps prevent crashes on volatile retail data
            tmp_model = SARIMAX(train_y, order=order, enforce_stationarity=False, enforce_invertibility=False)
            res = tmp_model.fit(disp=False)
            if res.aic < best_aic:
                best_aic = res.aic
                best_order = order
        except:
            continue
            
    # Final fit with the winning parameters
    model = SARIMAX(train_y, order=best_order, enforce_stationarity=False, enforce_invertibility=False)
    fit_model = model.fit(disp=False)
    
    return fit_model.forecast(test_len).values

# def run_sarimax(train_y, train_X, test_X, test_len):
#     # Define a small grid for (p, d, q)
#     p = q = range(0, 2) # (0, 1)
#     d = [0,1]
#     pdq = list(itertools.product(p, d, q))
    
#     best_aic = float("inf")
#     best_order = (1, 1, 1)
    
#     # Simple search for the lowest AIC (Akaike Information Criterion)
#     for order in pdq:
#         try:
#             tmp_model = SARIMAX(train_y, exog=train_X, order=order, enforce_stationarity=False)
#             res = tmp_model.fit(disp=False)
#             if res.aic < best_aic:
#                 best_aic = res.aic
#                 best_order = order
#         except:
#             continue
            
#     # Final fit with best order
#     model = SARIMAX(train_y, exog=train_X, order=best_order)
#     fit_model = model.fit(disp=False)
#     return fit_model.forecast(test_len, exog=test_X).values


def run_sarimax(train_y, train_X, test_X, test_len):
    d = infer_d(train_y)
    # No seasonal ARMA term — Fourier features (sin_1/cos_1/sin_2/cos_2) in train_X
    # already capture seasonality, so seasonal_order=(1,0,0,52) is redundant and
    # makes fitting ~20x slower with many exog columns.
    model = SARIMAX(
        train_y,
        order=(1, d, 0),
        exog=train_X,
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    fit_model = model.fit(disp=False)
    return fit_model.forecast(test_len, exog=test_X).values

def run_xgboost(train_X, train_y, test_X):
    # 1. Define Hyperparameter Grid
    param_grid = {
        'n_estimators': [50, 100, 200],
        'max_depth': [3, 4, 5],
        'learning_rate': [0.01, 0.05, 0.1],
        'subsample': [0.8, 1.0]
    }
    
    # 2. Tuning (Using 3-fold CV)
    # objective='reg:squarederror' stops warnings in newer XGBoost versions
    base_model = xgb.XGBRegressor(random_state=42, objective='reg:squarederror')
    tuner = RandomizedSearchCV(base_model, param_grid, n_iter=4, cv=2, random_state=42)
    tuner.fit(train_X, train_y)
    
    # 3. Predict with Best Model
    best_model = tuner.best_estimator_
    preds = best_model.predict(test_X)
    
    # 4. Extract Feature Importance safely
    raw_imp = best_model.feature_importances_.astype(float)
    importance = dict(zip(train_X.columns, np.round(raw_imp / (sum(raw_imp) + 1e-10), 4)))
    
    return preds, importance

def run_lightgbm(train_X, train_y, test_X):
    # Tree-based model
    param_grid = {
        'n_estimators': [50, 100, 200],
        'max_depth': [3, 5, 7],
        'learning_rate': [0.01, 0.05, 0.1],
        'num_leaves': [15, 31, 63]
    }
    base_model = lgb.LGBMRegressor(verbose=-1, random_state=42)
    tuner = RandomizedSearchCV(base_model, param_grid, n_iter=4, cv=2, random_state=42)
    tuner.fit(train_X, train_y)

    best_model = tuner.best_estimator_
    preds = best_model.predict(test_X)

    # Importance logic
    raw_imp = best_model.feature_importances_
    importance = dict(zip(train_X.columns, np.round(raw_imp / (sum(raw_imp) + 1e-10), 4)))

    return preds, importance



def execute_demand_forecast(df, target_col='Net Shipped', date_col='Week_Date', horizon=4, forced_model=["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost","LightGBM"]):
    """
    Executes the demand forecast pipeline for a single SKU/Store group.
    """
    df = df.sort_values(date_col).reset_index(drop=True)
    df[target_col] = pd.to_numeric(df[target_col], errors='coerce').fillna(0)
    first_sale_idx = df[df[target_col] > 0].index.min() # ---HANDLE NEW PRODUCTS (Trim Leading Zeros) ---
    
    
    if pd.isna(first_sale_idx): # Case: Product has never sold
        return json.dumps({
            "success": True,
            "summary":{
            "featureCount": 0,
            "featuresUsed": [], 
            "bestModel": "Naive_Zero_Baseline",
            "Model_Type": "Baseline",
            "metrics": {"WMAPE": 0.0, "MAPE": 0.0, "RMSE":0.0, "R2": 0.0},
            "totals": {"actualUnits": 0.0, "forecastUnits": 0.0},
            "Feature_Importance": {},         
            "Fallback_Triggered": True,
            "predictions": [],
            }
        }, indent=4)
    
    
    active_df = df.loc[first_sale_idx:].reset_index(drop=True)
    total_active_len = len(active_df)
    

    # FALLBACK 2: Cold Start (History too short to even split for testing)
    if total_active_len <= (horizon+2):
        return json.dumps({
            "success": True,
            "summary":{
            "featureCount": 0,
            "featuresUsed": [], 
            "bestModel": "Naive_Mean_Cold_Start",
            "Model_Type": "Baseline",
            "metrics": {"WMAPE": 0.0, "MAPE": 0.0, "RMSE":0.0, "R2": 0.0},
            "totals": {"actualUnits": float(active_df[target_col].sum()), "forecastUnits": 0.0},
            "Feature_Importance": {},
            "Fallback_Triggered": True,
            "predictions": []
            }, 
        }, indent=4)
    
    # --- 2. EXOG FEATURE SELECTION ---
    id_cols = ['store', 'Style Code', 'P3 Catego', 'P4 Style']
    known_non_features = set(id_cols + [target_col, date_col])

    # Any extra columns not in the hardcoded list (e.g. custom-built features) get appended
    extra_cols = [c for c in active_df.columns if c not in known_non_features and c not in EXOG_FEATURES]
    candidate_features = EXOG_FEATURES + extra_cols

    potential_exogs = [
        c for c in candidate_features
        if c in active_df.columns
        and active_df[c].notna().all()
        and active_df[c].nunique() > 1
    ]
    total_active_len = len(active_df)
    
    # --- 1. SPARSITY & LENGTH CHECK (Fallback Logic) ---
    force_fallback = total_active_len < (horizon * 2)

    # --- 2. TRAIN / TEST SPLIT ---
    train = active_df.iloc[:-horizon]
    test = active_df.iloc[-horizon:]
    
    train_y, test_y = train[target_col], test[target_col]
    train_X = train[potential_exogs] if potential_exogs else None
    test_X = test[potential_exogs] if potential_exogs else None

    # --- 3. MODEL EXECUTION DICTIONARY ---
    results = {}

    models_to_attempt = [forced_model] if isinstance(forced_model, str) else \
                        (forced_model if forced_model else ["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost", "LightGBM"])
    
    if force_fallback:
        preds = run_exp_smoothing(train_y, horizon)
        results['Exponential Smoothing'] = (preds, {}, "Time Series")
        
    else:
        if "Exponential Smoothing" in models_to_attempt:
            results['Exponential Smoothing'] = (run_exp_smoothing(train_y, horizon), {}, "Time Series")
        if "SARIMA" in models_to_attempt:
            preds = run_sarima(train_y, horizon)
            results['SARIMA'] = (preds, {}, "Time Series")
        if "SARIMAX" in models_to_attempt and potential_exogs:
            preds = run_sarimax(train_y, train_X, test_X, horizon)
            results['SARIMAX'] = (preds, {}, "Time Series")
        if "XGBoost" in models_to_attempt and potential_exogs:
            preds, imp = run_xgboost(train_X, train_y, test_X)
            results['XGBoost'] = (preds, imp, "Tree Based")
        if "LightGBM" in models_to_attempt and potential_exogs:
            preds, imp = run_lightgbm(train_X, train_y, test_X)
            results['LightGBM'] = (preds, imp, "Tree Based")
            
    # --- 4. EVALUATION & BEST FIT SELECTION ---
    best_model_name = None
    best_wmape = float('inf')
    best_metrics = {}
    best_importance = {}
    best_type = ""
    best_predictions_array = None
    
    for m_name, (preds, imp, m_type) in results.items():
        # Ensure predictions don't drop below zero for retail
        preds = np.clip(preds, 0, None)
        metrics = evaluate_metrics(test_y, preds)
        
        if metrics['wmape'] < best_wmape:
            best_wmape = metrics['wmape']
            best_metrics = metrics
            best_model_name = m_name
            best_importance = imp
            best_type = m_type
            best_predictions_array = preds

    result_df = test.copy()
    result_df['Forecast'] = best_predictions_array
    
    if date_col in result_df.columns:
        result_df[date_col] = pd.to_datetime(
            result_df[date_col],
            errors="coerce",
            format="mixed",
            dayfirst=True,
        ).dt.strftime("%Y-%m-%d")
    
    predictions_list = result_df.where(pd.notnull(result_df), None).to_dict(orient="records")

    summary = {
        "featureCount": len(potential_exogs) if potential_exogs and best_model_name in ["SARIMAX", "XGBoost", "LightGBM"] else 0,
        "featuresUsed": potential_exogs if best_model_name in ["SARIMAX", "XGBoost", "LightGBM"] else [],
        "bestModel": best_model_name,
        "modelType": best_type,
        "metrics": {
            "WMAPE": best_metrics.get('wmape'),
            "MAPE": best_metrics.get('mape'),
            "RMSE": best_metrics.get('rmse'), # NEW CHANGE
            "R2": best_metrics.get('r2')
        },
        "totals": {
            "actualUnits": float(test_y.sum()),
            "forecastUnits": float(best_predictions_array.sum())
        },
        "Feature_Importance": best_importance,
        "Fallback_Triggered": bool(force_fallback),
        "predictions": predictions_list
    }
    
    final_return = {
        "success": True,
        "summary": summary
    }
    
    return json.dumps(final_return, indent=4)