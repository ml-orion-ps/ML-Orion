from __future__ import annotations
import math
import numpy as np
import pandas as pd

SKU_COLS   = ["sku_id", "sku_code"]
STORE_COLS = ["store_id", "store_short_name"]
WEEK_COLS  = ["week_id", "date"]
UNITS_COL  = "sales_units"
PRICE_COL  = "price"
BRAND_COL  = "brand"
CATEGORY_COL = "category"
COMP1_PRICE_COL = "comp1_price"
COMP2_PRICE_COL = "comp2_price"
PACK_SIZE_COL   = "pack_size"


def _col(df, name):
    return name if name in df.columns else None


def _grp_units(df, by, units_col, label_as, top=20):
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
    price_col    = _col(df, PRICE_COL)
    brand_col    = _col(df, BRAND_COL)
    category_col = _col(df, CATEGORY_COL)
    comp1_col    = _col(df, COMP1_PRICE_COL)
    comp2_col    = _col(df, COMP2_PRICE_COL)

    def _safe_mean(col):
        try:
            return round(float(df[col].dropna().astype(float).mean()), 4) if col else None
        except Exception:
            return None

    def _safe_sum(col):
        try:
            return round(float(df[col].dropna().astype(float).sum()), 2) if col else None
        except Exception:
            return None

    # ── Overview ──────────────────────────────────────────────────────────────
    overview = {
        "totalRows":     n,
        "skuCount":      int(df[sku_col].nunique())      if sku_col      else None,
        "storeCount":    int(df[store_col].nunique())    if store_col    else None,
        "weekCount":     int(df[week_col].nunique())     if week_col     else None,
        "brandCount":    int(df[brand_col].nunique())    if brand_col    else None,
        "categoryCount": int(df[category_col].nunique()) if category_col else None,
        "avgPrice":      _safe_mean(price_col),
        "avgComp1Price": _safe_mean(comp1_col),
        "avgComp2Price": _safe_mean(comp2_col),
        "totalSalesUnits": _safe_sum(units_col),
        "features":          len(df.columns),
        "numericFeatures":   len(numeric_cols),
        "categoricalFeatures": len(cat_cols),
    }

    # ── Weekly time trends ────────────────────────────────────────────────────
    time_trends: list[dict] = []
    if week_col and units_col:
        try:
            agg: dict = {"totalUnits": (units_col, "sum")}
            if price_col:
                agg["avgPrice"] = (price_col, "mean")
            if comp1_col:
                agg["avgComp1Price"] = (comp1_col, "mean")
            if comp2_col:
                agg["avgComp2Price"] = (comp2_col, "mean")
            weekly = df.groupby(week_col).agg(**agg).reset_index().sort_values(week_col)
            time_trends = []
            for _, row in weekly.iterrows():
                entry: dict = {
                    "week": str(row[week_col]),
                    "totalUnits": round(float(row["totalUnits"]), 2),
                }
                if "avgPrice" in weekly.columns and not pd.isna(row.get("avgPrice")):
                    entry["avgPrice"] = round(float(row["avgPrice"]), 4)
                if "avgComp1Price" in weekly.columns and not pd.isna(row.get("avgComp1Price")):
                    entry["avgComp1Price"] = round(float(row["avgComp1Price"]), 4)
                if "avgComp2Price" in weekly.columns and not pd.isna(row.get("avgComp2Price")):
                    entry["avgComp2Price"] = round(float(row["avgComp2Price"]), 4)
                time_trends.append(entry)
        except Exception:
            pass

    # ── Top SKUs ──────────────────────────────────────────────────────────────
    top_skus: list[dict] = []
    if sku_col and units_col:
        top_skus = _grp_units(df, sku_col, units_col, "sku", top=15)

    # ── Store distribution ────────────────────────────────────────────────────
    store_dist: list[dict] = []
    if store_col and units_col:
        store_dist = _grp_units(df, store_col, units_col, "store", top=20)

    # ── Brand distribution ────────────────────────────────────────────────────
    brand_dist: list[dict] = []
    if brand_col and units_col:
        try:
            grp = df.groupby(brand_col).agg(
                totalUnits=(units_col, "sum"),
                **({ "avgPrice": (price_col, "mean") } if price_col else {})
            ).sort_values("totalUnits", ascending=False).head(20).reset_index()
            grp["totalUnits"] = grp["totalUnits"].round(2)
            if "avgPrice" in grp.columns:
                grp["avgPrice"] = grp["avgPrice"].round(4)
            brand_dist = grp.rename(columns={brand_col: "brand"}).to_dict("records")
        except Exception:
            pass

    # ── Category distribution ─────────────────────────────────────────────────
    category_dist: list[dict] = []
    if category_col and units_col:
        try:
            grp = df.groupby(category_col).agg(
                totalUnits=(units_col, "sum"),
                **({ "avgPrice": (price_col, "mean") } if price_col else {})
            ).sort_values("totalUnits", ascending=False).head(20).reset_index()
            grp["totalUnits"] = grp["totalUnits"].round(2)
            if "avgPrice" in grp.columns:
                grp["avgPrice"] = grp["avgPrice"].round(4)
            category_dist = grp.rename(columns={category_col: "category"}).to_dict("records")
        except Exception:
            pass

    # ── Competitor pricing ────────────────────────────────────────────────────
    competitor_pricing: dict = {}
    if comp1_col and comp2_col and price_col:
        try:
            own = df[price_col].dropna().astype(float)
            cp1 = df[comp1_col].dropna().astype(float)
            cp2 = df[comp2_col].dropna().astype(float)
            competitor_pricing = {
                "ownPriceAvg":       round(float(own.mean()), 4),
                "comp1PriceAvg":     round(float(cp1.mean()), 4),
                "comp2PriceAvg":     round(float(cp2.mean()), 4),
                "ownPriceMedian":    round(float(own.median()), 4),
                "priceIndexVsComp1": round(float(own.mean() / max(cp1.mean(), 0.01)), 4),
                "priceIndexVsComp2": round(float(own.mean() / max(cp2.mean(), 0.01)), 4),
            }
        except Exception:
            pass

    # ── Numeric stats ─────────────────────────────────────────────────────────
    numeric_stats: dict = {}
    for col in numeric_cols[:40]:
        series = df[col].dropna().astype(float)
        if len(series) == 0:
            continue
        hist_vals, edges = np.histogram(series, bins=15)
        q1 = float(series.quantile(0.25)) if len(series) > 3 else None
        q3 = float(series.quantile(0.75)) if len(series) > 3 else None
        numeric_stats[col] = {
            "mean":        round(float(series.mean()), 4),
            "median":      round(float(series.median()), 4),
            "stdDev":      round(float(series.std()), 4) if len(series) > 1 else 0,
            "min":         float(series.min()),
            "max":         float(series.max()),
            "q1":          round(q1, 4) if q1 is not None else None,
            "q3":          round(q3, 4) if q3 is not None else None,
            "nullCount":   int(df[col].isna().sum()),
            "completeness": round((1 - df[col].isna().sum() / max(n, 1)) * 100, 1),
            "histogram": [
                {"label": f"{edges[i]:.2f}–{edges[i+1]:.2f}", "count": int(hist_vals[i])}
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
    try:
        duplicates = int(df.astype(str).duplicated().sum())
    except Exception:
        duplicates = 0
    null_risks = [
        {"column": col, "nullCount": int(df[col].isna().sum()), "nullPercent": round(df[col].isna().sum() / max(n, 1) * 100, 1)}
        for col in df.columns if df[col].isna().sum() > 0
    ]
    outlier_cols, low_variance = [], []
    for col in numeric_cols[:20]:
        series = pd.to_numeric(df[col], errors="coerce").dropna()
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
        insights.append(f"{int(df[brand_col].nunique())} brands detected.")
    if category_col:
        insights.append(f"{int(df[category_col].nunique())} categories detected.")
    if comp1_col and comp2_col:
        insights.append("Competitor pricing columns (comp1_price, comp2_price) detected — price index analysis available.")
    if duplicates > 0:
        insights.append(f"{duplicates} duplicate rows detected.")
    if null_risks:
        insights.append(f"Missing values in {len(null_risks)} column(s). Consider imputing before modelling.")
    if correlation_matrix:
        top = correlation_matrix[0]
        insights.append(f"Strongest correlation: {top['col1']} vs {top['col2']} ({top['corr']}).")

    legacy_distributions = [
        {"feature": col, "mean": s["mean"], "median": s["median"], "stdDev": s["stdDev"],
         "min": s["min"], "max": s["max"], "skewness": 0, "histogram": s.get("histogram", [])}
        for col, s in list(numeric_stats.items())[:20]
    ]

    return {
        "usecase":        "price_elasticity",
        "overview":       overview,
        "timeTrends":     time_trends,
        "topSkus":        top_skus,
        "storeDist":      store_dist,
        "brandDist":      brand_dist,
        "categoryDist":   category_dist,
        "competitorPricing": competitor_pricing,
        "numericStats":   numeric_stats,
        "catStats":       cat_stats,
        "correlationMatrix": correlation_matrix[:30],
        "dataRisks": {
            "duplicates":  duplicates,
            "nullRisks":   null_risks,
            "outliers":    outlier_cols,
            "lowVariance": low_variance,
        },
        "insights":       insights,
        "distributions":  legacy_distributions,
        "correlations":   [],
    }
