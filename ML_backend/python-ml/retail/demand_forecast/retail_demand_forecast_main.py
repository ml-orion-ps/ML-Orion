import numpy as np
import pandas as pd
from data_prep import prepare_demand, engineer_features, preprocess_scaling
from feature_selection import process_style_group
from train_tune_model import execute_demand_forecast
from datetime import datetime
import json
import sys
import math
from typing import Any

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


def run_retail_demand_forecast(
    rows: list[dict],
    models_to_run: list[str] = None,
    custom_feature_names: list[str] = None,):

    raw_data = pd.DataFrame(rows)
    raw_data["Net Shipped"] = pd.to_numeric(raw_data["Net Shipped"], errors='coerce').fillna(0)
    print(raw_data.columns)
    df_prep = prepare_demand(raw_data)
    print(df_prep.columns)
    print("stage out:",df_prep['Net Shipped'].sum())

    if models_to_run is None:
        models_to_run = ["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost","LightGBM"]

    custom_feature_names = custom_feature_names or []
    for col in custom_feature_names:
        series = pd.to_numeric(df_prep[col], errors="coerce")
        fill_value = series.median()
        if pd.isna(fill_value):
            fill_value = 0.0
        df_prep[col] = series.fillna(fill_value)

    

    print("--------------- PREPARE DEMAND DONE -----------------")
    print(df_prep.columns)
    df_featured = engineer_features(
        df_prep, 
        target_col='Net Shipped', 
        price_col='Final Retail Price', 
        promo_col='Flag', 
        date_col='Week_Date'
    )

    df_featured.drop(['Net Invoiced (USD)','P3 Category','Final Cost','price_gap'], axis=1, inplace=True)
    
    print("--------------- FEATURE ENGINEERING DONE -----------------")

    # df_featured = df_featured.groupby(['store', 'Style Code'], group_keys=False).apply(process_style_group) # optional


    # print("--------------- FEATURE SELECTION DONE -----------------")

    # cols_to_scale = custom_feature_names

    cols_to_scale = [
        'Final Retail Price', 
        'lag_1_qty', 'lag_4_qty', 'price_index', 'promo_rolling_2w'
    ] + custom_feature_names
    df_final_prep, demand_scaler = preprocess_scaling(df_featured, cols_to_scale)

    print("--------------- FEATURE SCALING DONE -----------------")

    distinct_comb = df_final_prep[['store','Style Code']].drop_duplicates().shape[0]

    # 1. GLOBAL AGGREGATION
    # Summing sales across all stores/styles to find the "Business Trend"
    agg_dict = {'Net Shipped': 'sum', 'Final Retail Price': 'mean', 'Flag': 'max'}
    for col in (custom_feature_names or []):
        agg_dict[col] = 'mean'

    df_global = df_final_prep.groupby('Week_Date').agg(agg_dict).reset_index()
    df_global = df_global.sort_values('Week_Date').reset_index(drop=True)

    # Re-engineer time-series features on the global aggregated series.
    # Per-group features in df_final_prep are lost during aggregation, so we
    # recompute them from the global totals so the model-selection step sees
    # the same feature set as the SKU-level runs.
    df_global['lag_1_qty'] = df_global['Net Shipped'].shift(1).fillna(0)
    df_global['lag_4_qty'] = df_global['Net Shipped'].shift(4).fillna(0)
    _roll_price = df_global['Final Retail Price'].shift(1).rolling(4, min_periods=1).mean()
    # df_global['price_index'] = df_global['Final Retail Price'] / (_roll_price + 1e-5)
    # df_global['promo_lag_1'] = df_global['Flag'].shift(1).fillna(0)
    # df_global['promo_rolling_2w'] = df_global['Flag'].rolling(2, min_periods=1).sum()
    # df_global['is_payday_week'] = (df_global['Week_Date'].dt.day <= 7).astype(int)
    _t = np.arange(1, len(df_global) + 1)
    _period = 52.143
    for _i in [1, 2]:
        df_global[f'sin_{_i}'] = np.sin(2 * np.pi * _i * _t / _period)
        df_global[f'cos_{_i}'] = np.cos(2 * np.pi * _i * _t / _period)
    df_global = df_global.fillna(0)

    print(df_global.columns)
    # 2. FIND GLOBAL BEST MODEL
    global_results_json = execute_demand_forecast(
        df=df_global, 
        target_col='Net Shipped', 
        horizon=4, 
        forced_model=models_to_run
    )
    
    global_summary = json.loads(global_results_json)
    winner = global_summary['summary']['bestModel']
    print("Global level done and winner is: ", winner)

    # 3. APPLY WINNER TO ALL COMBINATIONS
    # We "Force" the winner to ensure consistency across the dashboard
    results_list = (
        df_final_prep.groupby(['store', 'Style Code'])
        .apply(lambda group: execute_demand_forecast(
            df=group, 
            target_col='Net Shipped', 
            horizon=4, 
            forced_model=[winner] # Only run the winner
        ))
    )
    
    print("local level done")
    # 4. FINAL PAYLOAD ASSEMBLY
    # Extract predictions and per-SKU WMAPE from each SKU-level run.
    # Use .items() to get (store, Style Code) group keys and stamp them onto
    # each prediction row — the columns can be null inside the group slice
    # depending on the pandas version.
    sku_predictions = []
    sku_wmapes = []
    for (store_val, style_val), res in results_list.items():
        sku_data = json.loads(res)
        for pred in sku_data['summary']['predictions']:
            pred['store'] = store_val
            pred['Style Code'] = style_val
        sku_predictions.extend(sku_data['summary']['predictions'])
        wmape_val = sku_data['summary']['metrics'].get('WMAPE')
        if wmape_val is not None:
            try:
                w = float(wmape_val)
                if not math.isnan(w) and not math.isinf(w):
                    sku_wmapes.append(round(w, 2))
            except (TypeError, ValueError):
                pass

    print("sucess stage 1")
    final_response = {
        "success": True,
        "summary": global_summary['summary'],
        "unique_combinations": distinct_comb,
        "data": sku_predictions,
        "sku_wmapes": sku_wmapes,
    }

    return final_response, distinct_comb



def main() -> None:
    if len(sys.argv) < 3:
        sys.stdout.write(json.dumps({"success": False, "error": "Usage: python retail_demand_forecast_main.py <input_json> <output_json>"}) + "\n")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        with open(input_file, "r", encoding="utf-8-sig") as f:
            input_data = json.load(f)
        
        rows = input_data.get("data", [])
        
        # Read the list of models from JSON. Default to all three if missing.
        models_to_run = input_data.get("models_to_run", ["Exponential Smoothing", "SARIMA", "SARIMAX", "XGBoost","LightGBM"])
        
        custom_feature_names = input_data.get("custom_feature_names", [])

        processed_results, distinct_combination = run_retail_demand_forecast(
                                                rows,
                                                models_to_run=models_to_run,
                                                custom_feature_names=custom_feature_names,
                                            )
        output_data = safe_serialize(processed_results)
        
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output_data, f, indent=2)
            
        sys.stdout.write(json.dumps({
            "success": True, 
            "message": f"Demand Forecasting completed for {distinct_combination} combinations."
        }) + "\n")
        
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
