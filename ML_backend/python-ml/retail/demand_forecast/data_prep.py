import pandas as pd
import numpy as np
from sklearn.preprocessing import StandardScaler

def prepare_demand(df):
    """
    Pipeline: 
    1. Time-series reindexing (filling date gaps)
    2. Outlier capping (IQR method)
    3. Feature scaling (StandardScaler)
    """

    df_processed = df.copy()
    
    # --- 1. CONFIGURATION MAPPING ---
    dt_col = 'Week_Date'
    target_col = 'Net Shipped'
    promo_col = 'Flag'             
    
    # Grouping levels: Store + Style Code (or P4 Style)
    group_keys = ['P3 Category','store','Style Code'] 
    
    # --- 2. TIME-SERIES REGULARIZATION ---
    df_processed[dt_col] = df_processed[dt_col].astype(str).str.strip()
    
    if dt_col in df_processed.columns:
        df_processed[dt_col] = pd.to_datetime(
            df_processed[dt_col],
            errors="coerce",
            format="mixed",
            dayfirst=True,
        )
    
    def reindex_series(group, group_name):
        group = group.sort_values(dt_col).copy()

        # Infer dominant weekday dynamically
        weekdays = group[dt_col].dropna().dt.dayofweek

        if weekdays.empty:
            return group

        dominant_day = weekdays.mode().iloc[0]

        weekday_map = {
            0: 'MON',
            1: 'TUE',
            2: 'WED',
            3: 'THU',
            4: 'FRI',
            5: 'SAT',
            6: 'SUN'
        }

        freq = f"W-{weekday_map[dominant_day]}"

        # Create a continuous weekly range for each Store-Style combination
        if isinstance(group_name, tuple):
            group_identity = dict(zip(group_keys, group_name))
        else:
            # If grouping by a single column, group.name is a single value
            group_identity = {group_keys[0]: group_name}

        full_range = pd.date_range(start=group[dt_col].min(), 
                                   end=group[dt_col].max(), 
                                   freq=freq) # Adjust freq as per your data
        
        group = group.groupby(dt_col, as_index=False).agg({
                target_col: "sum",
                promo_col: "max",
                "Net Invoiced (USD)": "sum",
                "Final Retail Price":"mean",
                "Final Cost":"mean"
            })
        reindexed = (group.set_index(dt_col)
                    .reindex(full_range)
                    .rename_axis(dt_col)
                    .reset_index() )
        

        for key, value in group_identity.items():
            reindexed[key] = value

        return reindexed
    
    # Apply reindexing per group to ensure no missing weeks
    # df_processed = df_processed.groupby(group_keys).apply(reindex_series)
    df_processed = (
        df_processed
        .groupby(group_keys)
        .apply(lambda g: reindex_series(g, g.name))
    )
    
    df_processed.reset_index(drop=True, inplace=True)

    # if dt_col in df_processed.columns:
    #     df_processed[dt_col] = pd.to_datetime(
    #         df_processed[dt_col],
    #         errors="coerce",
    #         format="mixed",
    #         dayfirst=True,
    #     ).dt.strftime("%Y-%m-%d")

    # Fill missing values after reindexing
    df_processed[target_col] = df_processed[target_col].fillna(0)
    df_processed[promo_col] = df_processed[promo_col].fillna(0)
    for col in group_keys:
        df_processed[col] = df_processed[col].ffill().bfill()

    # --- 3. OUTLIER CAPPING (Non-Promo Baseline) ---
    # Only cap values where Flag == 0 to avoid flattening genuine promo peaks
    baseline = df_processed[df_processed[promo_col] == 0]
    stats = baseline.groupby(group_keys)[target_col].agg(
        q1=lambda x: x.quantile(0.25),
        q3=lambda x: x.quantile(0.75)
    ).reset_index()


    stats['iqr'] = stats['q3'] - stats['q1']
    stats['upper_bound'] = stats['q3'] + 3 * stats['iqr']
    stats['lower_bound'] = stats['q1'] - 3 * stats['iqr']
    
    df_processed = df_processed.merge(stats, on=group_keys, how='left')
    
    # Apply clipping only to baseline periods
    mask = df_processed[promo_col] == 0
    df_processed.loc[mask, target_col] = df_processed.loc[mask, target_col].clip(
        lower=df_processed.loc[mask, 'lower_bound'],
        upper=df_processed.loc[mask, 'upper_bound']
    )

    # Drop temp columns
    df_processed = df_processed.drop(columns=['q1', 'q3', 'iqr', 'upper_bound', 'lower_bound'])

    
    return df_processed



def engineer_features(df, target_col, price_col, promo_col, date_col):
    df_eng = df.copy()
    granularity = ['store', 'Style Code']
    
    df_eng = df_eng.sort_values(by=granularity + [date_col])
    # a. Temporal & Lags
    df_eng['is_payday_week'] = (df_eng[date_col].dt.day <= 7).astype(int)

    grouped = df_eng.groupby(granularity)

    df_eng['lag_1_qty'] = grouped[target_col].shift(1)
    df_eng['lag_4_qty'] = grouped[target_col].shift(4)

    # b. Price Elasticity Proxy
    # Compares current price to the 4-week moving average
    rolling_mean_price = grouped[price_col].transform(
        lambda x: x.shift(1).rolling(window=4, min_periods=1).mean()
    )
    df_eng['price_index'] = df_eng[price_col] / (rolling_mean_price + 1e-5)
    
    df_eng['price_gap'] = df_eng['Final Retail Price'] - df_eng.groupby(['store', 'P3 Category', 'Week_Date'])['Final Retail Price'].transform('median')

    # c. Promo Dynamics
    df_eng['promo_lag_1'] = grouped[promo_col].shift(1)
    df_eng['promo_rolling_2w'] = grouped[promo_col].transform(
        lambda x: x.rolling(window=2, min_periods=1).sum()
    )
    
    # d. Fourier Series (Seasonality)
    df_eng['t'] = grouped.cumcount() + 1
    period = 52.143 
    
    for i in [1, 2]: # Annual and Semi-Annual waves
        df_eng[f'sin_{i}'] = np.sin(2 * np.pi * i * df_eng['t'] / period)
        df_eng[f'cos_{i}'] = np.cos(2 * np.pi * i * df_eng['t'] / period)
    
    return df_eng.drop(columns=['t']).fillna(0)


def preprocess_scaling(df, numerical_cols):
    df_scaled = df.copy()
    scaler = StandardScaler()
    
    # Ensure no NaNs exist before scaling
    for col in numerical_cols:
        if col in df_scaled.columns:
            df_scaled[col] = df_scaled[col].fillna(df_scaled[col].median())
    
    df_scaled[numerical_cols] = scaler.fit_transform(df_scaled[numerical_cols])
    
    return df_scaled, scaler