import os

from preprocessing import preprocess_data

from elasticity_model import (
    train_elasticity_model,
    extract_sku_store_elasticities,
    extract_evaluation_metrics,
)

from aggregation import (
    generate_aggregations,
)

from utils import (
    create_output_directory,
    generate_output_filename,
)


OUTPUT_DIR = "outputs/elasticity"


def run_price_elasticity_pipeline(df):

    # preprocess
    processed_df = preprocess_data(df)

    # train
    result = train_elasticity_model(
        processed_df
    )

    # evaluation metrics
    eval_metrics = extract_evaluation_metrics(result, processed_df)

    # extract
    sku_store_elasticities = (
        extract_sku_store_elasticities(
            processed_df,
            result,
        )
    )

    # merge
    merged_df = processed_df.merge(
        sku_store_elasticities,
        on=["sku_id", "store_id"],
        how="left"
    )

    # aggregations
    final_df = generate_aggregations(
        merged_df,
        result,
    )

    # save
    create_output_directory(
        OUTPUT_DIR
    )

    output_filename = (
        generate_output_filename(
            "price_elasticity"
        )
    )

    output_path = os.path.join(
        OUTPUT_DIR,
        output_filename,
    )

    final_df.to_csv(
        output_path,
        index=False
    )

    global_elas = result.params.get("log_price", None)

    brand_summary = (
        final_df[["brand", "elasticity_base_brand"]]
        .drop_duplicates(subset=["brand"])
        .dropna(subset=["elasticity_base_brand"])
        .sort_values("elasticity_base_brand")
    )
    elasticity_summary = [
        {"name": str(row["brand"]), "elasticity": float(row["elasticity_base_brand"])}
        for _, row in brand_summary.iterrows()
    ]

    # Build feature importance from fixed-effect coefficients (abs value = "importance")
    TERM_LABELS = {
        "log_price": "Own Price (log)",
        "log_comp1_price": "Competitor 1 Price (log)",
        "log_comp2_price": "Competitor 2 Price (log)",
        "log_brand_idx": "Brand Price Index (log)",
        "discount_depth": "Discount Depth",
        "feature_flag": "Feature Flag",
        "display_flag": "Display Flag",
        "bogo_flag": "BOGO Flag",
        "seasonality_index": "Seasonality Index",
        "holiday_flag": "Holiday Flag",
        "Intercept": "Intercept",
    }
    raw_params = {k: v for k, v in result.params.items()
                  if not k.startswith("C(") and "Group Var" not in k}
    feature_importance = sorted(
        [
            {
                "name": TERM_LABELS.get(k, k),
                "feature": k,
                "importance": round(abs(float(v)), 6),
                "coefficient": round(float(v), 6),
                "description": f"Fixed-effect coefficient for {TERM_LABELS.get(k, k)}",
            }
            for k, v in raw_params.items()
            if v == v  # drop NaN
        ],
        key=lambda x: x["importance"],
        reverse=True,
    )

    return {
        "status": "success",
        "rows_processed": int(len(final_df)),
        "output_file": output_path,
        "model_converged": bool(result.converged),
        "global_price_elasticity": float(global_elas) if global_elas is not None else None,
        "elasticity_summary": elasticity_summary,
        "feature_importance": feature_importance,
        "r2":                  eval_metrics.get("r2"),
        "mae":                 eval_metrics.get("mae"),
        "rmse":                eval_metrics.get("rmse"),
        "aic":                 eval_metrics.get("aic"),
        "bic":                 eval_metrics.get("bic"),
        "log_likelihood":      eval_metrics.get("logLikelihood"),
        "price_coef_pvalue":   eval_metrics.get("priceCoefPvalue"),
        "price_coef_std_err":  eval_metrics.get("priceCoefStdErr"),
        "price_coef_tstat":    eval_metrics.get("priceCoefTstat"),
    }