from __future__ import annotations
import math
import numpy as np
import pandas as pd

# ── Column name constants — update here if schema changes ─────────────────────
SKU_COLS        = ["sku_id", "sku_code"]
STORE_COLS      = ["store_id", "store_short_name"]
WEEK_COLS       = ["week_id", "date"]
UNITS_COL       = "sales_units"
NET_SALES_COL   = "net_sales_value"
GROSS_SALES_COL = "gross_sales_value"
REVENUE_COLS    = ["net_sales_value", "Total_revenue", "gross_sales_value"]
DISCOUNT_COL    = "discount_value"
PRICE_COL       = "price"
BASE_PRICE_COL  = "base_price"
BRAND_COL       = "brand"
CATEGORY_COL    = "category"
CHANNEL_COL     = "sales_channel_short_name"
REGION_COL      = "region"
PRICE_TIER_COL  = "price_tier (economy / mass / premium)"
PRODUCT_TYPE_COL = "product_type (core / innovation / seasonal) or (BII/BIO)"
GROSS_PROFIT_COL = "Gross_profit"
NET_PROFIT_COL  = "Net_profit"
NPM_COL         = "NPM"
SEASONALITY_COL = "seasonality_index"
HOLIDAY_COL     = "holiday_flag"
PROMO_COLS_FIXED = [f"PROMO_{i}" for i in range(1, 16)]
PROMO_SPEND_COL = "PROMO_SPENDS"
COMP1_PRICE_COL = "COMP1_PRICE"
COMP2_PRICE_COL = "COMP2_PRICE"
COMP1_VOL_COL   = "COMP1_VOLUME"
COMP2_VOL_COL   = "COMP2_VOLUME"


def _col(df: pd.DataFrame, name: str):
    return name if name in df.columns else None


def _grp_units(df: pd.DataFrame, by: str, units_col: str, label_as: str, top: int = 20) -> list[dict]:
    try:
        return (
            df.groupby(by)[units_col].sum()
            .sort_values(ascending=False).head(top)
            .reset_index()
            .rename(columns={by: label_as, units_col: "totalUnits"})
            .assign(totalUnits=lambda x: x["totalUnits"].round(2))
            .to_dict("records")
        )
    except Exception:
        return []


def run(df: pd.DataFrame) -> dict:
    n = len(df)
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
    cat_cols = df.select_dtypes(exclude=[np.number]).columns.tolist()

    sku_col      = next((c for c in SKU_COLS   if c in df.columns), None)
    store_col    = next((c for c in STORE_COLS if c in df.columns), None)
    week_col     = next((c for c in WEEK_COLS  if c in df.columns), None)
    units_col    = _col(df, UNITS_COL)
    rev_col      = next((c for c in REVENUE_COLS if c in df.columns), None)
    discount_col = _col(df, DISCOUNT_COL)
    price_col    = _col(df, PRICE_COL)
    brand_col    = _col(df, BRAND_COL)
    category_col = _col(df, CATEGORY_COL)
    channel_col  = _col(df, CHANNEL_COL)
    region_col   = _col(df, REGION_COL)
    price_tier_col    = _col(df, PRICE_TIER_COL)
    product_type_col  = _col(df, PRODUCT_TYPE_COL)
    gross_profit_col  = _col(df, GROSS_PROFIT_COL)
    net_profit_col    = _col(df, NET_PROFIT_COL)
    npm_col           = _col(df, NPM_COL)
    seasonality_col   = _col(df, SEASONALITY_COL)
    holiday_col       = _col(df, HOLIDAY_COL)
    comp1_price_col   = _col(df, COMP1_PRICE_COL)
    comp2_price_col   = _col(df, COMP2_PRICE_COL)
    comp1_vol_col     = _col(df, COMP1_VOL_COL)
    comp2_vol_col     = _col(df, COMP2_VOL_COL)

    promo_cols = [c for c in PROMO_COLS_FIXED if c in df.columns]
    promo_spend_present = PROMO_SPEND_COL in df.columns

    # ── Overview ──────────────────────────────────────────────────────────────
    def _safe_mean(col):
        try:
            return round(float(df[col].dropna().astype(float).mean()), 2) if col else None
        except Exception:
            return None

    def _safe_sum(col):
        try:
            return round(float(df[col].dropna().astype(float).sum()), 2) if col else None
        except Exception:
            return None

    overview = {
        "totalRows": n,
        "skuCount":      int(df[sku_col].nunique())      if sku_col      else None,
        "storeCount":    int(df[store_col].nunique())    if store_col    else None,
        "weekCount":     int(df[week_col].nunique())     if week_col     else None,
        "brandCount":    int(df[brand_col].nunique())    if brand_col    else None,
        "categoryCount": int(df[category_col].nunique()) if category_col else None,
        "channelCount":  int(df[channel_col].nunique())  if channel_col  else None,
        "regionCount":   int(df[region_col].nunique())   if region_col   else None,
        "promoColumnCount": len(promo_cols),
        "promoCols": promo_cols,
        "hasPromoSpends": promo_spend_present,
        "hasCompetitorData": bool(comp1_price_col and comp2_price_col),
        "features": len(df.columns),
        "numericFeatures": len(numeric_cols),
        "categoricalFeatures": len(cat_cols),
        "totalSalesUnits": _safe_sum(units_col),
        "totalNetSales":   _safe_sum(rev_col),
        "totalGrossProfit": _safe_sum(gross_profit_col),
        "totalNetProfit":   _safe_sum(net_profit_col),
        "avgPrice":         _safe_mean(price_col),
        "avgBasePrice":     _safe_mean(BASE_PRICE_COL if BASE_PRICE_COL in df.columns else None),
        "avgDiscount":      _safe_mean(discount_col),
        "avgNPM":           _safe_mean(npm_col),
    }

    # ── Weekly sales trend ────────────────────────────────────────────────────
    time_trends: list[dict] = []
    if week_col and units_col:
        try:
            agg_dict: dict = {
                "totalUnits": (units_col, "sum"),
                "avgUnits":   (units_col, "mean"),
                "rowCount":   (units_col, "count"),
            }
            if rev_col:
                agg_dict["totalRevenue"] = (rev_col, "sum")
            if discount_col:
                agg_dict["avgDiscount"] = (discount_col, "mean")
            weekly = df.groupby(week_col).agg(**agg_dict).reset_index().sort_values(week_col)
            time_trends = [
                {
                    "week": str(row[week_col]),
                    "totalUnits": round(float(row["totalUnits"]), 2),
                    "avgUnits":   round(float(row["avgUnits"]), 2),
                    "rowCount":   int(row["rowCount"]),
                    "totalRevenue": round(float(row["totalRevenue"]), 2) if "totalRevenue" in weekly.columns and not pd.isna(row.get("totalRevenue")) else None,
                    "avgDiscount":  round(float(row["avgDiscount"]), 2)  if "avgDiscount"  in weekly.columns and not pd.isna(row.get("avgDiscount"))  else None,
                }
                for _, row in weekly.iterrows()
            ]
        except Exception:
            pass

    # ── Promo coverage ────────────────────────────────────────────────────────
    def _is_active(x):
        return x not in (0, None, "", "0", False, "false", "N", "n")

    promo_coverage: list[dict] = []
    for col in promo_cols:
        active = int(df[col].apply(_is_active).sum())
        avg_spend = None
        if promo_spend_present:
            try:
                mask = df[col].apply(_is_active)
                avg_spend = round(float(df.loc[mask, PROMO_SPEND_COL].dropna().astype(float).mean()), 2)
            except Exception:
                pass
        promo_coverage.append({
            "column": col,
            "activeRows": active,
            "coveragePercent": round(active / max(n, 1) * 100, 1),
            "avgPromoSpend": avg_spend,
        })

    # ── Top SKUs by volume ────────────────────────────────────────────────────
    top_skus: list[dict] = []
    if sku_col and units_col:
        top_skus = _grp_units(df, sku_col, units_col, "sku", top=15)

    # ── Store distribution ────────────────────────────────────────────────────
    store_dist: list[dict] = []
    if store_col and units_col:
        store_dist = _grp_units(df, store_col, units_col, "store", top=20)

    # ── Revenue by SKU ────────────────────────────────────────────────────────
    revenue_by_sku: list[dict] = []
    if sku_col and rev_col:
        try:
            revenue_by_sku = (
                df.groupby(sku_col)[rev_col].sum()
                .sort_values(ascending=False).head(15)
                .reset_index()
                .rename(columns={sku_col: "sku", rev_col: "totalRevenue"})
                .assign(totalRevenue=lambda x: x["totalRevenue"].round(2))
                .to_dict("records")
            )
        except Exception:
            pass

    # ── Brand distribution ────────────────────────────────────────────────────
    brand_dist: list[dict] = []
    if brand_col and units_col:
        brand_dist = _grp_units(df, brand_col, units_col, "brand", top=20)

    # ── Category distribution ─────────────────────────────────────────────────
    category_dist: list[dict] = []
    if category_col and units_col:
        category_dist = _grp_units(df, category_col, units_col, "category", top=20)

    # ── Channel distribution ──────────────────────────────────────────────────
    channel_dist: list[dict] = []
    if channel_col and units_col:
        channel_dist = _grp_units(df, channel_col, units_col, "channel", top=20)

    # ── Region distribution ───────────────────────────────────────────────────
    region_dist: list[dict] = []
    if region_col and units_col:
        region_dist = _grp_units(df, region_col, units_col, "region", top=20)

    # ── Price tier distribution ───────────────────────────────────────────────
    price_tier_dist: list[dict] = []
    if price_tier_col and units_col:
        price_tier_dist = _grp_units(df, price_tier_col, units_col, "tier", top=20)

    # ── Product type distribution ─────────────────────────────────────────────
    product_type_dist: list[dict] = []
    if product_type_col and units_col:
        product_type_dist = _grp_units(df, product_type_col, units_col, "productType", top=20)

    # ── Holiday impact ────────────────────────────────────────────────────────
    holiday_impact: list[dict] = []
    if holiday_col and units_col:
        try:
            for hval in sorted(df[holiday_col].dropna().unique()):
                grp = df[df[holiday_col] == hval]
                holiday_impact.append({
                    "label": str(hval),
                    "rowCount": len(grp),
                    "totalUnits": round(float(grp[units_col].sum()), 2),
                    "avgUnits":   round(float(grp[units_col].mean()), 2),
                    "avgRevenue": round(float(grp[rev_col].dropna().astype(float).mean()), 2) if rev_col else None,
                })
        except Exception:
            pass

    # ── Competitor pricing ────────────────────────────────────────────────────
    competitor_pricing: dict = {}
    if comp1_price_col and comp2_price_col:
        try:
            own   = df[price_col].dropna().astype(float)   if price_col    else None
            cp1   = df[comp1_price_col].dropna().astype(float)
            cp2   = df[comp2_price_col].dropna().astype(float)
            competitor_pricing = {
                "ownPriceAvg":    round(float(own.mean()), 2)  if own  is not None else None,
                "comp1PriceAvg":  round(float(cp1.mean()), 2),
                "comp2PriceAvg":  round(float(cp2.mean()), 2),
                "ownPriceMedian": round(float(own.median()), 2) if own is not None else None,
                "priceIndexVsComp1": round(float(own.mean() / max(cp1.mean(), 0.01)), 3) if own is not None else None,
                "priceIndexVsComp2": round(float(own.mean() / max(cp2.mean(), 0.01)), 3) if own is not None else None,
            }
            if comp1_vol_col and comp2_vol_col:
                cv1 = df[comp1_vol_col].dropna().astype(float)
                cv2 = df[comp2_vol_col].dropna().astype(float)
                competitor_pricing["comp1VolumeAvg"] = round(float(cv1.mean()), 2)
                competitor_pricing["comp2VolumeAvg"] = round(float(cv2.mean()), 2)
                if units_col:
                    competitor_pricing["ownVolumeAvg"] = round(float(df[units_col].dropna().astype(float).mean()), 2)
        except Exception:
            pass

    # ── Financial KPIs ────────────────────────────────────────────────────────
    financial_kpis: dict = {}
    try:
        financial_kpis = {
            "avgGrossProfit":  _safe_mean(gross_profit_col),
            "avgNetProfit":    _safe_mean(net_profit_col),
            "avgNPM":          _safe_mean(npm_col),
            "totalGrossProfit": _safe_sum(gross_profit_col),
            "totalNetProfit":   _safe_sum(net_profit_col),
            "avgSeasonalityIndex": _safe_mean(seasonality_col),
            "avgDiscountValue": _safe_mean(discount_col),
            "discountPct": (
                round(float(
                    df[discount_col].dropna().astype(float).sum() /
                    max(df[GROSS_SALES_COL].dropna().astype(float).sum(), 0.01) * 100
                ), 2)
                if discount_col and GROSS_SALES_COL in df.columns else None
            ),
        }
    except Exception:
        pass

    # ── Numeric stats (with promo/non-promo split) ────────────────────────────
    numeric_stats: dict = {}
    first_promo = promo_cols[0] if promo_cols else None
    for col in numeric_cols[:40]:
        series = df[col].dropna().astype(float)
        if len(series) == 0:
            continue
        hist_vals, edges = np.histogram(series, bins=15)
        promo_mean = non_promo_mean = None
        if first_promo:
            try:
                pmask = df[first_promo].apply(_is_active)
                promo_mean     = round(float(series[series.index.isin(pmask[pmask].index)].mean()), 3)     or None
                non_promo_mean = round(float(series[series.index.isin(pmask[~pmask].index)].mean()), 3) or None
            except Exception:
                pass
        q1 = float(series.quantile(0.25)) if len(series) > 3 else None
        q3 = float(series.quantile(0.75)) if len(series) > 3 else None
        numeric_stats[col] = {
            "mean":        round(float(series.mean()), 3),
            "median":      round(float(series.median()), 3),
            "stdDev":      round(float(series.std()), 3) if len(series) > 1 else 0,
            "min":         float(series.min()),
            "max":         float(series.max()),
            "q1":          round(q1, 3) if q1 is not None else None,
            "q3":          round(q3, 3) if q3 is not None else None,
            "nullCount":   int(df[col].isna().sum()),
            "completeness": round((1 - df[col].isna().sum() / max(n, 1)) * 100, 1),
            "promoMean":    promo_mean,
            "nonPromoMean": non_promo_mean,
            "histogram": [
                {"label": f"{edges[i]:.1f}–{edges[i+1]:.1f}", "count": int(hist_vals[i])}
                for i in range(len(hist_vals))
            ],
        }

    # ── Categorical stats ─────────────────────────────────────────────────────
    cat_stats: dict = {}
    for col in cat_cols[:30]:
        counts = df[col].value_counts().head(15)
        cat_stats[col] = {
            "nullCount":   int(df[col].isna().sum()),
            "uniqueCount": int(df[col].nunique()),
            "top": [{"label": str(val), "count": int(cnt)} for val, cnt in counts.items()],
        }

    # ── Correlation matrix ────────────────────────────────────────────────────
    correlation_matrix: list[dict] = []
    if len(numeric_cols) > 1:
        try:
            corr_df = df[numeric_cols].corr()
            for i, c1 in enumerate(numeric_cols):
                for c2 in numeric_cols[i + 1:]:
                    val = corr_df.loc[c1, c2]
                    if math.isnan(val) or math.isinf(val) or abs(val) <= 0.2:
                        continue
                    correlation_matrix.append({"col1": c1, "col2": c2, "corr": round(float(val), 3)})
            correlation_matrix.sort(key=lambda x: -abs(x["corr"]))
        except Exception:
            pass

    # ── Data risks ────────────────────────────────────────────────────────────
    duplicates = int(df.duplicated().sum())
    null_risks = [
        {
            "column": col,
            "nullCount": int(df[col].isna().sum()),
            "nullPercent": round(df[col].isna().sum() / max(n, 1) * 100, 1),
        }
        for col in df.columns if df[col].isna().sum() > 0
    ]
    outlier_cols, low_variance = [], []
    for col in numeric_cols[:20]:
        series = df[col].dropna().astype(float)
        if len(series) < 4:
            continue
        q1_v, q3_v = series.quantile(0.25), series.quantile(0.75)
        iqr = q3_v - q1_v
        outlier_n = int(((series < q1_v - 1.5 * iqr) | (series > q3_v + 1.5 * iqr)).sum())
        if outlier_n > n * 0.05:
            outlier_cols.append({"column": col, "outlierCount": outlier_n, "percent": round(outlier_n / n * 100, 1)})
        if series.std() < 0.001:
            low_variance.append({"column": col, "std": round(float(series.std()), 6)})

    # ── Insights ──────────────────────────────────────────────────────────────
    insights: list[str] = []
    if not sku_col:
        insights.append(f"No SKU column detected. Expected: {', '.join(SKU_COLS)}.")
    if not store_col:
        insights.append(f"No store column detected. Expected: {', '.join(STORE_COLS)}.")
    if not week_col:
        insights.append("No week/date column detected. Time trends not generated.")
    if not units_col:
        insights.append(f"'{UNITS_COL}' column not found. Volume analysis skipped.")
    if brand_col:
        insights.append(f"{int(df[brand_col].nunique())} brands detected in column '{brand_col}'.")
    if category_col:
        insights.append(f"{int(df[category_col].nunique())} categories in '{category_col}'.")
    if promo_cols:
        insights.append(f"{len(promo_cols)} PROMO column(s) detected: {', '.join(promo_cols[:5])}{'...' if len(promo_cols) > 5 else ''}.")
    else:
        insights.append("No PROMO_1..PROMO_15 columns detected.")
    if promo_spend_present:
        insights.append("PROMO_SPENDS column present — promo ROI analysis available.")
    if comp1_price_col and comp2_price_col:
        insights.append("Competitor pricing columns (COMP1_PRICE, COMP2_PRICE) detected.")
    if duplicates > 0:
        insights.append(f"{duplicates} duplicate rows detected.")
    if null_risks:
        insights.append(f"Missing values in {len(null_risks)} column(s). Consider imputing before training.")
    if correlation_matrix:
        top = correlation_matrix[0]
        insights.append(f"Strongest correlation: {top['col1']} vs {top['col2']} ({top['corr']}).")

    legacy_distributions = [
        {
            "feature": col, "mean": s["mean"], "median": s["median"], "stdDev": s["stdDev"],
            "min": s["min"], "max": s["max"], "skewness": 0, "histogram": s.get("histogram", []),
        }
        for col, s in list(numeric_stats.items())[:20]
    ]

    return {
        "usecase": "baseline",
        "overview": overview,
        "timeTrends": time_trends,
        "promoCoverage": promo_coverage,
        "topSkus": top_skus,
        "storeDist": store_dist,
        "revenueBySkus": revenue_by_sku,
        "brandDist": brand_dist,
        "categoryDist": category_dist,
        "channelDist": channel_dist,
        "regionDist": region_dist,
        "priceTierDist": price_tier_dist,
        "productTypeDist": product_type_dist,
        "competitorPricing": competitor_pricing,
        "holidayImpact": holiday_impact,
        "financialKpis": financial_kpis,
        "numericStats": numeric_stats,
        "catStats": cat_stats,
        "correlationMatrix": correlation_matrix[:30],
        "dataRisks": {
            "duplicates": duplicates,
            "nullRisks": null_risks,
            "outliers": outlier_cols,
            "lowVariance": low_variance,
        },
        "insights": insights,
        "distributions": legacy_distributions,
        "correlations": [],
    }
