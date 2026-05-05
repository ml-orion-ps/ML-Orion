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


target_col = 'Net Shipped'
promo_col = 'Flag'
price_col = 'Final Retail Price'
date_col = 'Week_Date'
granularity = 'Style Code'

with open("config.txt", "r") as f:
    config = json.load(f)

data_cfg = config["data"]
model_cfg = config["model"]
baseline_usage = config["baseline_usage"]
exog_cfg = config["exog"]



def disaggregate_to_sku(df_style_forecast, df_hist_sku, target_col, date_col):
    """
    Disaggregates style-level forecasts to SKU level based on weighted historical proportions.
    """
    # 1. Setup Date Windows
    df_hist_sku[date_col] = pd.to_datetime(df_hist_sku[date_col])
    latest_date = df_hist_sku[date_col].max()
    six_months_ago = latest_date - pd.DateOffset(months=6)
    
    # Define Target Quarter for Seasonality (e.g., if forecasting for Q2 2026, look at Q2 2025)
    # For this logic, we assume the 'target' is the quarter following the latest historical date
    target_quarter = (latest_date.quarter % 4) + 1
    target_year_ly = latest_date.year - 1

    # 2. Calculate Recent Proportions (Last 6 Months) - Weight 0.7
    recent_hist = df_hist_sku[df_hist_sku[date_col] >= six_months_ago]
    
    recent_ratios = recent_hist.groupby(['Style Code', 'Item_Number'])[target_col].sum().reset_index()
    style_totals_recent = recent_ratios.groupby('Style Code')[target_col].transform('sum')
    recent_ratios['recent_ratio'] = recent_ratios[target_col] / (style_totals_recent + 1e-5)

    # 3. Calculate Seasonal Proportions (Same Quarter Last Year) - Weight 0.3
    seasonal_hist = df_hist_sku[
        (df_hist_sku[date_col].dt.quarter == target_quarter) & 
        (df_hist_sku[date_col].dt.year == target_year_ly)
    ]
    
    seasonal_ratios = seasonal_hist.groupby(['Style Code', 'Item_Number'])[target_col].sum().reset_index()
    style_totals_seasonal = seasonal_ratios.groupby('Style Code')[target_col].transform('sum')
    seasonal_ratios['seasonal_ratio'] = seasonal_ratios[target_col] / (style_totals_seasonal + 1e-5)

    # 4. Merge Ratios and Handle New SKUs
    # Outer join to capture SKUs that might exist in one window but not the other
    sku_master_ratios = pd.merge(
        recent_ratios[['Style Code', 'Item_Number', 'recent_ratio']],
        seasonal_ratios[['Style Code', 'Item_Number', 'seasonal_ratio']],
        on=['Style Code', 'Item_Number'],
        how='outer'
    ).fillna(0)

    # b. Commencement Flag: If SKU has 0 seasonal ratio but > 0 recent ratio, it's likely a new SKU
    sku_master_ratios['is_new_sku'] = (
        (sku_master_ratios['seasonal_ratio'] == 0) & 
        (sku_master_ratios['recent_ratio'] > 0)
    ).astype(int)

    # c. Apply Weights (0.7 Recent / 0.3 Seasonal)
    # If it's a new SKU, we give 100% weight to the recent 6 months to avoid dilution
    sku_master_ratios['final_ratio'] = np.where(
        sku_master_ratios['is_new_sku'] == 1,
        sku_master_ratios['recent_ratio'],
        (sku_master_ratios['recent_ratio'] * 0.7) + (sku_master_ratios['seasonal_ratio'] * 0.3)
    )

    # Re-normalize ratios per style to ensure they sum to exactly 1.0
    style_sum = sku_master_ratios.groupby('Style Code')['final_ratio'].transform('sum')
    sku_master_ratios['final_ratio'] = sku_master_ratios['final_ratio'] / (style_sum + 1e-5)

    # 5. Apply Ratios to Style Forecast
    df_sku_forecast = pd.merge(
        df_style_forecast, 
        sku_master_ratios[['Style Code', 'Item_Number', 'final_ratio']], 
        on='Style Code', 
        how='left'
    )

    # Final SKU Quantity
    df_sku_forecast['SKU_Forecast_Qty'] = df_sku_forecast['Style_Forecast_Qty'] * df_sku_forecast['final_ratio']

    return df_sku_forecast


def generate_production_forecast(df_features, model_registry, target_col, date_col, horizon=4):
    """
    Generates future predictions based on the winning model for each style.
    horizon: Number of weeks to forecast into the future.
    """
    final_forecasts = []
    
    # 1. Identify the 'Present' (The last date in our data)
    last_date = df_features[date_col].max()
    future_dates = pd.date_range(start=last_date + pd.Timedelta(weeks=1), periods=horizon, freq='W-SUN')

    for style, model_name in model_registry.items():
        style_df = df_features[df_features[granularity] == style].sort_values(date_col).copy()
        
        # --- Case A: Deterministic Rules ---
        if model_name == 'Zero_Rule':
            forecast_values = [0.0] * horizon
            
        elif model_name == 'Rolling_Avg_Fallback':
            val = style_df[target_col].tail(4).mean()
            forecast_values = [val] * horizon

        # --- Case B: Machine Learning (XGBoost/LightGBM) ---
        elif model_name == 'XGBoost':
            # Re-train on ALL data
            # (Note: In a real scenario, you'd pass optimized hyperparameters here)
            X = style_df[selected_features] # Using features from the previous step
            y = style_df[target_col] 
            
            model = xgb.XGBRegressor(n_estimators=100)
            model.fit(X, y)
            
            # For simplicity, we use the 'latest' feature row as a proxy for the future 
            # Or you can build a specific 'df_future' with upcoming promos/price plans
            latest_features = X.tail(1)
            pred = model.predict(latest_features)[0]
            forecast_values = [max(0, pred)] * horizon # Simple persistence for demo

        # --- Case C: Statistical (Prophet) ---
        elif model_name == 'Prophet':
            m = Prophet().fit(style_df.rename(columns={date_col: 'ds', target_col: 'y'}))
            future = m.make_future_dataframe(periods=horizon, freq='W')
            forecast = m.predict(future)
            forecast_values = forecast['yhat'].tail(horizon).values

        # 2. Structure the Output
        for i, date in enumerate(future_dates):
            final_forecasts.append({
                granularity: style,
                'Forecast_Date': date,
                'Style_Forecast_Qty': forecast_values[i],
                'Model_Used': model_name
            })

    return pd.DataFrame(final_forecasts)