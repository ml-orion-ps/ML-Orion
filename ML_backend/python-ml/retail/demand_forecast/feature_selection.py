from sklearn.feature_selection import mutual_info_regression
from sklearn.preprocessing import StandardScaler
import pandas as pd

def select_features_mutual_info(df, target_col, candidate_cols, topk=5):
    """
    Performs SKU-level feature selection using Mutual Information.
    """
    # 1. Clean data for the specific SKU/Style
    temp = df[[target_col] + [c for c in candidate_cols if c in df.columns]].dropna()

    # 2. Safety Check: If data is too sparse, keep all features to avoid bias
    if temp.shape[0] < 10: 
        return [c for c in candidate_cols if c in df.columns]
    
    X = temp[[c for c in candidate_cols if c in temp.columns]]
    y = temp[target_col].values
    
    # 3. Scaling for MI (MI works better when features are on similar scales)
    try:
        Xs = StandardScaler().fit_transform(X)
    except:
        Xs = X.values
        
    # 4. Calculate Mutual Information
    # This captures non-linear relationships like promo spikes
    mi = mutual_info_regression(Xs, y, random_state=42)
    mi_scores = sorted(zip(X.columns, mi), key=lambda x: x[1], reverse=True)
    
    # 5. Return the names of the Top K drivers
    return [c for c, s in mi_scores][:topk]

def build_sku_exog_matrix(style_df, target_col='Net Shipped', topk=5):
    """
    Orchestrates the selection and returns a filtered dataframe.
    """
    # Automatically identify potential drivers (Lags, Price, Promo, Fourier)
    # Exclude non-numeric and target columns
    candidate_exogs = [
        col for col in style_df.columns 
        if col not in [target_col, 'Week_Date', 'store', 'Style Code', 'P3 Catego', 'P4 Style']
        and style_df[col].dtype in ['float64', 'int64']
    ]


    if not candidate_exogs:
        return None

    # Perform Style-level selection
    selected_features = select_features_mutual_info(
        style_df, 
        target_col=target_col, 
        candidate_cols=candidate_exogs, 
        topk=topk
    )

    # 3. FORCED PAIR STRATEGY
    # We create a final list and look for missing partners
    final_features = list(selected_features)
    
    for feat in selected_features:
        partner = None
        if feat.startswith('sin_'):
            partner = feat.replace('sin_', 'cos_')
        elif feat.startswith('cos_'):
            partner = feat.replace('cos_', 'sin_')
            
        # If a partner exists in the dataframe but wasn't selected by MI, add it now
        if partner and partner in style_df.columns and partner not in final_features:
            final_features.append(partner)

    # Return only the useful features for this specific SKU
    return style_df[final_features].copy()


# Assuming df_featured contains all your Lags, Fourier, and Price features
def process_style_group(group):
    if isinstance(group.name, tuple):
        store_val, style_val = group.name
    else:
        # Fallback if only one key is used
        store_val = group.name
        style_val = "Unknown" # Or handle as per your data

    # This ensures each Store-Style combination gets its own 'Best' features
    selected_exog = build_sku_exog_matrix(group, target_col='Net Shipped', topk=5)
    
    # Combine the original identity columns with only the selected features
    identity_cols = pd.DataFrame({
        'store': [store_val] * len(group),
        'Style Code': [style_val] * len(group),
        'Week_Date': group['Week_Date'].values,
        'Net Shipped': group['Net Shipped'].values
    }, index=group.index) # Keep the original index for a perfect merge


    return pd.concat([identity_cols, selected_exog], axis=1)
