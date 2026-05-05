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


def metrics_dict(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = root_mean_squared_error(y_true, y_pred, squared=False)
    mape = np.mean(np.abs((y_true - y_pred) / np.maximum(np.abs(y_true), 1e-8))) * 100
    return {"MAE": float(mae), "RMSE": float(rmse), "MAPE": float(mape)}



def estimate_diff_order(y, max_d=2, significance=0.05):
    """
    Automatically estimate 'd' by testing stationarity after differencing.
    Returns the smallest d ∈ {0,1,2} where ADF p-value <= significance.
    """
    y = y.dropna()
    for d in range(max_d + 1):
        if d > 0:
            yd = y.diff(d).dropna()
        else:
            yd = y

        try:
            pvalue = adfuller(yd)[1]
        except Exception:
            pvalue = 1.0  # if ADF fails, consider non-stationary

        if pvalue <= significance:
            return d

    return max_d  # fallback


def estimate_seasonal_diff_order(y, seasonal_period, max_D=1, significance=0.05):
    """
    Estimate seasonal differencing D by applying D ∈ {0,1}
    """
    y = y.dropna()

    for D in range(max_D + 1):
        if D == 1:
            yd = y.diff(seasonal_period).dropna()
        else:
            yd = y

        try:
            pvalue = adfuller(yd)[1]
        except:
            pvalue = 1.0

        if pvalue <= significance:
            return D

    return max_D



def train_best_sarimax(
    series_df,
    target_col,
    exog_cols=None,
    seasonal_period=7,   # e.g., weekly seasonality
    max_p=2,
    max_q=2,
    max_P=1,
    max_Q=1,
    max_d=2,
    max_D=1
):
    y = series_df[target_col]

    exog = None
    if exog_cols:
        exog = series_df[exog_cols]

    # ---------- automatic d and D ----------
    d = estimate_diff_order(y, max_d=max_d)
    D = estimate_seasonal_diff_order(y, seasonal_period, max_D=max_D)

    best_model = None
    best_aic = np.inf
    best_order = None
    best_seasonal_order = None

    # ---------- grid search ----------
    for p in range(max_p + 1):
        for q in range(max_q + 1):
            for P in range(max_P + 1):
                for Q in range(max_Q + 1):
                    order = (p, d, q)
                    seasonal_order = (P, D, Q, seasonal_period)
                    try:
                        model = SARIMAX(
                            y,
                            order=order,
                            seasonal_order=seasonal_order,
                            exog=exog,
                            enforce_stationarity=False,
                            enforce_invertibility=False
                        )
                        fitted = model.fit(disp=False)

                        if fitted.aic < best_aic:
                            best_aic = fitted.aic
                            best_order = order
                            best_seasonal_order = seasonal_order
                            best_model = fitted
                    except Exception:
                        continue

    return best_model, best_order, best_seasonal_order
    

def predict_sarimax(model, forecast_horizon, exog_future=None):
    """
    model: fitted SARIMAX model
    exog_future: dataframe with future rows and same exogenous columns
    """
    if exog_future is not None:
        fc = model.get_forecast(steps=forecast_horizon, exog=exog_future)
    else:
        fc = model.get_forecast(steps=forecast_horizon)

    return fc.predicted_mean
     


# --- Helper 1: WMAPE Metric ---
def calculate_wmape(y_true, y_pred):
    """Calculates Weighted Mean Absolute Percentage Error."""
    total_abs_error = np.sum(np.abs(y_true - y_pred))
    total_volume = np.sum(np.abs(y_true))
    # Add a small epsilon to prevent division by zero
    return total_abs_error / (total_volume + 1e-5)

# --- Helper 2: Stationarity Test ---
def determine_integration_order(series, max_d=2):
    """Uses ADF test to find the order of differencing (d)."""
    # Drop NaNs created by earlier lag features
    series = series.dropna() 

    if series.nunique() <= 1:
        return 0
    
    if len(series) < 10: # Safety check for low-data styles
        return 0
        
    d = 0
    p_value = adfuller(series)[1]
    
    while p_value > 0.05 and d < max_d:
        series = series.diff().dropna()
        if len(series) < 10: break
        p_value = adfuller(series)[1]
        d += 1
        
    return d



def run_master_forecasting_pipeline(df_features, target_col, date_col, granularity, horizon=4):
    all_accuracies = []      # Accuracy Report
    all_val_forecasts = []   # For debugging (Actual vs Predicted in validation)
    all_final_forecasts = [] # Production numbers for SKU disaggregation
    
    style_codes = df_features[granularity].unique()
    tscv = TimeSeriesSplit(n_splits=3)

    drop_cols = [target_col, granularity, date_col]
    features = [c for c in df_features.columns if c not in drop_cols]

    for style in style_codes:
        style_df = df_features[df_features[granularity] == style].sort_values(date_col).copy()
        dates = style_df[date_col]
        
        # --- 1. Rule-Based Early Exits ---        
        # Scenario A: Total Zero Demand (Dead or Unlaunched Styles)
        if style_df[target_col].sum() == 0:
            print(f"  Zero demand for {style}. Assigning Zero_Rule.")
            
            # 1. Log Accuracy Report
            all_accuracies.append({
                'Style Code': style, 
                'Best Model': 'Zero_Rule', 
                'Avg WMAPE': 0.0, 
                'Integration Order': 0
            })
            
            # 2. Log Final Production Forecast (All Zeros)
            future_dates = pd.date_range(start=dates.iloc[-1] + pd.Timedelta(weeks=1), periods=horizon, freq='W-SUN')
            for f_date in future_dates:
                all_final_forecasts.append({
                    'Style Code': style, 
                    'Date': f_date, 
                    'Style_Forecast_Qty': 0.0, 
                    'Model': 'Zero_Rule'
                })
            
            # 3. Log Validation Placeholder (For consistent debug frame)
            all_val_forecasts.append({
                'Style Code': style, 'Date': dates.iloc[-1], 'Fold': -1,
                'Actual': 0.0, 'XGB_Pred': 0.0, 'Prophet_Pred': 0.0
            })
            continue

        # Scenario B: Short History (New Launches < 30 Weeks)
        if len(style_df) < 30:
            # Use a 4-week rolling average as the fallback
            fallback_val = style_df[target_col].tail(4).mean()
            print(f"  Short history for {style} ({len(style_df)} weeks). Using Rolling_Avg: {fallback_val:.2f}")
            
            # 1. Log Accuracy Report (WMAPE is NaN because CV is not possible)
            all_accuracies.append({
                'Style Code': style, 
                'Best Model': 'Rolling_Avg_Fallback', 
                'Avg WMAPE': np.nan, 
                'Integration Order': 0
            })
            
            # 2. Log Final Production Forecast
            future_dates = pd.date_range(start=dates.iloc[-1] + pd.Timedelta(weeks=1), periods=horizon, freq='W-SUN')
            for f_date in future_dates:
                all_final_forecasts.append({
                    'Style Code': style, 
                    'Date': f_date, 
                    'Style_Forecast_Qty': fallback_val, 
                    'Model': 'Rolling_Avg_Fallback'
                })
                
            # 3. Log Validation Placeholder
            all_val_forecasts.append({
                'Style Code': style, 'Date': dates.iloc[-1], 'Fold': -1,
                'Actual': style_df[target_col].iloc[-1], 
                'XGB_Pred': fallback_val, 
                'Prophet_Pred': fallback_val
            })
            continue

        # --- 2. Preprocessing & Integration (d) ---
        d = determine_integration_order(style_df[target_col])
        style_df['ml_target'] = style_df[target_col].diff(periods=d) if d > 0 else style_df[target_col]
        style_df = style_df.dropna().reset_index(drop=True)
        
        # Define Features (Assuming 'selected_features' are predefined)
        # Select features that have at least some correlation with the target
        mandatory_features = ['sin_1', 'cos_1', 'price_index', 'is_payday_week', 'promo_rolling_2w']
        

        numeric_features = style_df[features].select_dtypes(include=[np.number]).columns.tolist()
        if len(numeric_features) > 0:
            correlations = style_df[numeric_features].corrwith(style_df['ml_target']).abs()
            high_corr_features = correlations[correlations > 0.05].index.tolist()
            selected_features = list(set(mandatory_features + high_corr_features))
        else:
            selected_features = mandatory_features
        
        selected_features = [f for f in selected_features if f in style_df.columns]
        X = style_df[selected_features]
        y_ml = style_df['ml_target']
        y_raw = style_df[target_col]
        dates = style_df[date_col]

        style_model_scores = {}
        fold_logs = []

        # --- 3. The Tournament (Cross-Validation) ---
        for fold, (train_idx, val_idx) in enumerate(tscv.split(style_df)):
            # Split Data
            X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_train_ml, y_val_ml = y_ml.iloc[train_idx], y_ml.iloc[val_idx]
            y_val_raw = y_raw.iloc[val_idx]
            val_dates = dates.iloc[val_idx]

            # --- Model A: XGBoost ---
            xgb_m = xgb.XGBRegressor(n_estimators=100, max_depth=3, learning_rate=0.1)
            xgb_m.fit(X_train, y_train_ml)
            xgb_pred_ml = xgb_m.predict(X_val)
            
            # Reconstruct Raw Units
            if d > 0:
                last_actual = y_raw.iloc[train_idx[-1]]
                xgb_pred_raw = np.cumsum(np.insert(xgb_pred_ml, 0, last_actual))[1:]
            else:
                xgb_pred_raw = xgb_pred_ml

            # --- Model B: Prophet ---
            prophet_train = style_df.iloc[train_idx].rename(columns={date_col: 'ds', target_col: 'y'})
            prop_m = Prophet(yearly_seasonality=True).fit(prophet_train)
            prop_future = style_df.iloc[val_idx].rename(columns={date_col: 'ds'})
            prop_forecast = prop_m.predict(prop_future)
            prop_pred_raw = prop_forecast['yhat'].values

            # --- Evaluation ---
            xgb_wmape = calculate_wmape(y_val_raw, xgb_pred_raw)
            prop_wmape = calculate_wmape(y_val_raw, prop_pred_raw)

            # Store scores for selection
            style_model_scores['XGBoost'] = style_model_scores.get('XGBoost', 0) + xgb_wmape
            style_model_scores['Prophet'] = style_model_scores.get('Prophet', 0) + prop_wmape

            # Log validation predictions for debugging later
            for i in range(len(val_dates)):
                fold_logs.append({
                    'Style Code': style, 'Date': val_dates.iloc[i], 'Fold': fold,
                    'Actual': y_val_raw.iloc[i], 'XGB_Pred': xgb_pred_raw[i], 'Prophet_Pred': prop_pred_raw[i]
                })

        # --- 4. Selection & Winning Model Training ---
        best_model_name = min(style_model_scores, key=style_model_scores.get)
        best_score = style_model_scores[best_model_name] / tscv.n_splits
        
        all_accuracies.append({
            'Style Code': style, 'Best Model': best_model_name, 
            'Avg WMAPE': best_score, 'Integration Order': d
        })
        all_val_forecasts.extend(fold_logs)

        # --- 5. Final Production Scoring ---
        # Re-train the winner on 100% of the style history
        if best_model_name == 'XGBoost':
            final_model = xgb.XGBRegressor(n_estimators=100, max_depth=3).fit(X, y_ml)
            # Simple Persistence Forecast for example; ideally use a future feature frame
            future_val = final_model.predict(X.tail(1))[0] 
            if d > 0: future_val = y_raw.iloc[-1] + future_val
            forecast_values = [max(0, future_val)] * horizon
        else:
            final_m = Prophet().fit(style_df.rename(columns={date_col: 'ds', target_col: 'y'}))
            future_df = final_m.make_future_dataframe(periods=horizon, freq='W')
            forecast_values = final_m.predict(future_df)['yhat'].tail(horizon).values

        # Save production forecast
        future_dates = pd.date_range(start=dates.iloc[-1] + pd.Timedelta(weeks=1), periods=horizon, freq='W-SUN')
        for i, f_date in enumerate(future_dates):
            all_final_forecasts.append({
                'Style Code': style, 'Date': f_date, 'Style_Forecast_Qty': forecast_values[i], 'Model': best_model_name
            })

    return pd.DataFrame(all_accuracies), pd.DataFrame(all_val_forecasts), pd.DataFrame(all_final_forecasts)

