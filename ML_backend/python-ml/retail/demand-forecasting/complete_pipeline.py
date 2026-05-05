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



# Execute:
df_processed, price_scaler = preprocess_demand_data(raw_data, target_col=target_col, promo_col=promo_col)
print("Preprocessing complete........")

df_features = engineer_features(df_processed,target_col=target_col, price_col=price_col, promo_col=promo_col, date_col=date_col)
print("Feature engineering complete........")

df_features.drop(['P4 Style', 'Final Cost'], axis=1, inplace=True)
accuracy,val_fc, all_fc = run_master_forecasting_pipeline(df_features, target_col=target_col, date_col=date_col, granularity=granularity, horizon=4)
print("Modelling complete........")

sku_level_result = disaggregate_to_sku(df_style_forecast= all_fc, df_hist_sku = item_level_raw, target_col=target_col, date_col=date_col)
print("Disaggregation complete........")

accuracy.to_csv("acc_v1.csv", index=False)
val_fc.to_csv("val_fc_v1.csv", index=False)
all_fc.to_csv("all_fc_v1.csv", index=False)

sku_level_result.to_csv("all_sku_fc_v1.csv", index=False)