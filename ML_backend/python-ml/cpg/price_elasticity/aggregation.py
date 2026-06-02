import numpy as np


def compute_weighted_elasticity(
    df_in,
    group_cols,
    elast_col,
    weight_col,
    out_name,
):

    df_valid = df_in[
        df_in[weight_col] > 0
    ].copy()

    grouped = (
        df_valid
        .groupby(group_cols)
        .apply(
            lambda g: np.average(
                g[elast_col],
                weights=g[weight_col]
            )
        )
        .reset_index(name=out_name)
    )

    return grouped


def generate_aggregations(
    df_merged,
    result
):

    sku_elast = compute_weighted_elasticity(
        df_merged,
        ["sku_id"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_sku"
    )

    brand_elast = compute_weighted_elasticity(
        df_merged,
        ["brand"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_brand"
    )

    cat_elast = compute_weighted_elasticity(
        df_merged,
        ["category"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_category"
    )

    region_elast = compute_weighted_elasticity(
        df_merged,
        ["region"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_region"
    )

    store_elast = compute_weighted_elasticity(
        df_merged,
        ["store_id"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_store"
    )

    channel_elast = compute_weighted_elasticity(
        df_merged,
        ["channel"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_channel"
    )

    customer_elast = compute_weighted_elasticity(
        df_merged,
        ["customer"],
        "elasticity_price_sku_store",
        "sales_units",
        "elasticity_base_customer"
    )

    df_merged["Comp1_elasticity"] = (
        result.params.get("log_comp1_price", np.nan)
    )

    df_merged["Comp2_elasticity"] = (
        result.params.get("log_comp2_price", np.nan)
    )

    final_df = df_merged.copy()

    final_df = final_df.merge(
        sku_elast,
        on="sku_id",
        how="left"
    )

    final_df = final_df.merge(
        brand_elast,
        on="brand",
        how="left"
    )

    final_df = final_df.merge(
        cat_elast,
        on="category",
        how="left"
    )

    final_df = final_df.merge(
        region_elast,
        on="region",
        how="left"
    )

    final_df = final_df.merge(
        store_elast,
        on="store_id",
        how="left"
    )

    final_df = final_df.merge(
        channel_elast,
        on="channel",
        how="left"
    )

    final_df = final_df.merge(
        customer_elast,
        on="customer",
        how="left"
    )

    return final_df