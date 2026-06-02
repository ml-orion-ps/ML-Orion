"""
Computes lag, rolling, trend, ratio, flag, segment_tag, and interaction features.
Supports business_logic features for both:
  - CPG Baseline Modelling / Promo-Uplift (price-index / promo features)
  - Retail Demand Forecast (category / seasonality / demand-index features)
Extensible registry pattern architecture decouples concerns for zero-disruption additions of future use cases.
"""
from __future__ import annotations
import gzip
import base64
import io
import csv
from typing import Any
import pandas as pd
import numpy as np


TIME_AWARE_TYPES = {"lag", "rolling", "trend"}


# Global synonym map — kept for backward compatibility with generic solvers
SYNONYMS = {
    "price": ["price", "gross_price", "selling_price",
              "Final Retail Price", "Final Cost", "final_retail_price", "retail_price"],
    "brand": ["brand", "brand_family", "Brand"],
    "store_id": ["store_id", "store", "Store", "store_short_name", "store_name"],
    "week_id": ["week_id", "week", "date_id", "date",
                "Week_Date", "week_date", "Date", "snapshot_month"],
    "category": ["category", "category_id", "P3 Category", "p3_category",
                 "category_name", "Category"],
    "sales_units": ["sales_units", "sales", "quantity", "units",
                    "Net Shipped", "net_shipped", "shipped_units", "volume"],
    "sku_id": ["sku_id", "sku_code", "sku", "item_id", "product_id",
               "SKU", "SKU Code", "Style Code", "style_code"],
    "COMP1_PRICE": ["COMP1_PRICE", "competitor_price", "comp1_price", "COMP2_PRICE"],
    "discount_value": ["discount_value", "discount", "discount_depth"],
    "revenue": ["Net Invoiced (USD)", "net_invoiced_usd", "revenue", "Revenue"],
}


def _resolve_column(expected: str, column_names: list[str]) -> str | None:
    if expected in SYNONYMS:
        for syn in SYNONYMS[expected]:
            if syn in column_names:
                return syn
    if expected in column_names:
        return expected
    for col in column_names:
        if col.lower() == expected.lower():
            return col
    return None


def _to_number(value: Any) -> float | None:
    if value is None or value == "" or value != value:  # NaN check
        return None
    try:
        result = float(value)
        return result if result == result else None  # NaN guard
    except (ValueError, TypeError):
        return None


def _safe_divide(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


def _to_week_numeric(series: pd.Series) -> pd.Series:
    series_clean = series.dropna()
    if len(series_clean) == 0:
        return pd.Series(dtype=float, index=series.index)
        
    first_val = series_clean.iloc[0]
    first_val_str = str(first_val)
    
    # ISO week format: YYYY-Www
    if isinstance(first_val_str, str) and "-W" in first_val_str:
        dt = pd.to_datetime(series + "-1", format="%G-W%V-%u", errors="coerce")
        return (dt - pd.Timestamp("1970-01-01")).dt.days / 7
        
    # YYYYMMDD integer or string format
    is_yyyy_mm_dd = False
    try:
        val_int = int(float(first_val))
        if 19000101 <= val_int <= 21001231:
            is_yyyy_mm_dd = True
    except Exception:
        pass
        
    if is_yyyy_mm_dd:
        dt = pd.to_datetime(series.astype(str).str.split('.').str[0], format="%Y%m%d", errors="coerce")
        return (dt - pd.Timestamp("1970-01-01")).dt.days / 7
        
    # Try converting to numeric first
    nums = pd.to_numeric(series, errors="coerce")
    if nums.notna().sum() > 0.8 * len(series_clean):
        return nums
        
    # General datetime parser
    dt = pd.to_datetime(series, errors="coerce")
    return (dt - pd.Timestamp("1970-01-01")).dt.days / 7


def _compare(left: Any, comparator: str | None, right: Any) -> bool:
    if not comparator:
        return False
    left_n, right_n = _to_number(left), _to_number(right)
    if comparator == "gt":
        return left_n is not None and right_n is not None and left_n > right_n
    if comparator == "gte":
        return left_n is not None and right_n is not None and left_n >= right_n
    if comparator == "lt":
        return left_n is not None and right_n is not None and left_n < right_n
    if comparator == "lte":
        return left_n is not None and right_n is not None and left_n <= right_n
    if comparator == "eq":
        return str(left or "") == str(right or "")
    if comparator == "ne":
        return str(left or "") != str(right or "")
    if comparator == "contains":
        return str(right or "").lower() in str(left or "").lower()
    if comparator == "not_contains":
        return str(right or "").lower() not in str(left or "").lower()
    return False


def build_custom_feature_formula(feature: dict) -> str:
    t = feature.get("type", "")
    if t == "lag":
        return f"lag({feature.get('sourceColumn', '')}, periods={feature.get('periods', 1)})"
    if t == "rolling":
        agg = feature.get("aggregation", "mean")
        return f"{agg}({feature.get('sourceColumn', '')}, window={feature.get('window', 3)})"
    if t == "trend":
        return f"trend_slope({feature.get('sourceColumn', '')}, window={feature.get('window', 3)})"
    if t == "ratio":
        return f"{feature.get('numeratorColumn', '')} / {feature.get('denominatorColumn', '')}"
    if t == "flag":
        return f"{feature.get('sourceColumn', '')} {feature.get('comparator', '>')} {feature.get('compareValue', 0)}"
    if t == "segment_tag":
        return f"segment({feature.get('sourceColumn', '')})"
    if t == "interaction":
        op_map = {"multiply": "*", "divide": "/", "add": "+", "subtract": "-"}
        op = op_map.get(feature.get("interactionOperator", "multiply"), "*")
        return f"{feature.get('leftColumn', '')} {op} {feature.get('rightColumn', '')}"
    if t == "business_logic":
        return feature.get("formula", "")
    return ""


# ── Registry Pattern for Business Logic Use Cases ──────────────────────────────

class UseCaseRegistry:
    use_case_id: str
    synonyms: dict[str, list[str]]
    features: dict[str, list[str]]

    @classmethod
    def resolve_column(cls, expected: str, column_names: list[str]) -> str | None:
        if expected in cls.synonyms:
            for syn in cls.synonyms[expected]:
                if syn in column_names:
                    return syn
        if expected in column_names:
            return expected
        for col in column_names:
            if col.lower() == expected.lower():
                return col
        return None

    @classmethod
    def compute_feature(cls, name: str, df: pd.DataFrame) -> pd.Series:
        raise NotImplementedError(f"compute_feature not implemented for use case {cls.use_case_id}")


class CpgBaselineRegistry(UseCaseRegistry):
    use_case_id = "cpg_baseline"
    
    synonyms = {
        "price": ["price", "gross_price", "selling_price", "retail_price"],
        "brand": ["brand", "brand_family", "Brand"],
        "store_id": ["store_id", "store", "Store", "store_short_name", "store_name"],
        "week_id": ["week_id", "week", "date_id", "date", "week_date", "Date"],
        "category": ["category", "category_id", "p3_category", "category_name", "Category"],
        "sales_units": ["sales_units", "sales", "quantity", "units", "net_shipped", "volume"],
        "sku_id": ["sku_id", "sku_code", "sku", "item_id", "product_id", "SKU", "SKU Code"],
        "COMP1_PRICE": ["COMP1_PRICE", "competitor_price", "comp1_price", "COMP2_PRICE"],
        "discount_value": ["discount_value", "discount", "discount_depth"],
    }
    
    features = {
        "avg_brand_price_store_week": ["price", "brand", "store_id", "week_id"],
        "own_brand_price_index": ["price", "brand", "store_id", "week_id"],
        "avg_cat_price_store_week": ["price", "category", "store_id", "week_id"],
        "own_cat_price_index": ["price", "category", "store_id", "week_id"],
        "price_change_vs_last_week": ["price", "sku_id", "store_id", "week_id"],
        "price_change_vs_4wk_avg": ["price", "sku_id", "store_id", "week_id"],
        "competitor_avg_price_cat_store_week": ["COMP1_PRICE", "category", "store_id", "week_id"],
        "competitor_price_index": ["price", "COMP1_PRICE", "category", "store_id", "week_id"],
        "promo_intensity_score": [],
        "weeks_since_last_promo": ["week_id", "sku_id", "store_id"],
        "cannibalization_index_brand": ["sales_units", "brand", "store_id", "week_id", "sku_id"],
        "category_demand_index_store_week": ["sales_units", "category", "store_id", "week_id"],
        "store_size_index": ["sales_units", "store_id", "week_id"],
    }

    @classmethod
    def compute_feature(cls, name: str, df: pd.DataFrame) -> pd.Series:
        col_price = cls.resolve_column("price", df.columns)
        col_brand = cls.resolve_column("brand", df.columns)
        col_store = cls.resolve_column("store_id", df.columns)
        col_week = cls.resolve_column("week_id", df.columns)
        col_category = cls.resolve_column("category", df.columns)
        col_sales = cls.resolve_column("sales_units", df.columns)
        col_sku = cls.resolve_column("sku_id", df.columns)
        col_comp_price = cls.resolve_column("COMP1_PRICE", df.columns)
        col_discount = cls.resolve_column("discount_value", df.columns)

        if name == "avg_brand_price_store_week":
            if col_price and col_brand and col_store and col_week:
                return df.groupby([col_brand, col_store, col_week])[col_price].transform("mean")
            return pd.Series(np.nan, index=df.index)

        elif name == "own_brand_price_index":
            if col_price and col_brand and col_store and col_week:
                brand_avg = df.groupby([col_brand, col_store, col_week])[col_price].transform("mean")
                return df[col_price] / brand_avg.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "avg_cat_price_store_week":
            if col_price and col_category and col_store and col_week:
                return df.groupby([col_category, col_store, col_week])[col_price].transform("mean")
            return pd.Series(np.nan, index=df.index)

        elif name == "own_cat_price_index":
            if col_price and col_category and col_store and col_week:
                cat_avg = df.groupby([col_category, col_store, col_week])[col_price].transform("mean")
                return df[col_price] / cat_avg.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "price_change_vs_last_week":
            if col_price and col_sku and col_store and col_week:
                df_sorted = df.sort_values(by=col_week)
                price_t_minus_1 = df_sorted.groupby([col_sku, col_store])[col_price].shift(1)
                price_t_minus_1 = price_t_minus_1.reindex(df.index)
                return (df[col_price] - price_t_minus_1) / price_t_minus_1.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "price_change_vs_4wk_avg":
            if col_price and col_sku and col_store and col_week:
                df_sorted = df.sort_values(by=col_week)
                avg_4wk = df_sorted.groupby([col_sku, col_store])[col_price].rolling(window=4, min_periods=1).mean()
                avg_4wk = avg_4wk.reset_index(level=[0, 1], drop=True).reindex(df.index)
                return (df[col_price] - avg_4wk) / avg_4wk.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "competitor_avg_price_cat_store_week":
            if col_comp_price and col_category and col_store and col_week:
                return df.groupby([col_category, col_store, col_week])[col_comp_price].transform("mean")
            return pd.Series(np.nan, index=df.index)

        elif name == "competitor_price_index":
            if col_price and col_comp_price and col_category and col_store and col_week:
                comp_avg = df.groupby([col_category, col_store, col_week])[col_comp_price].transform("mean")
                return df[col_price] / comp_avg.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "promo_intensity_score":
            promo_cols = [c for c in df.columns if c.upper().startswith("PROMO_") and c.upper() != "PROMO_SPENDS"]
            promo_sum = df[promo_cols].sum(axis=1) if promo_cols else pd.Series(0.0, index=df.index)
            col_gross_val = cls.resolve_column("gross_sales_value", df.columns)
            if col_discount and col_gross_val:
                disc_depth = (df[col_discount] / df[col_gross_val].replace(0, np.nan)).fillna(0)
                return disc_depth + promo_sum
            elif col_discount:
                return df[col_discount].fillna(0) + promo_sum
            return promo_sum

        elif name == "weeks_since_last_promo":
            if col_week and col_sku and col_store:
                promo_cols = [c for c in df.columns if c.upper().startswith("PROMO_")]
                is_promo = pd.Series(False, index=df.index)
                if promo_cols:
                    is_promo = is_promo | (df[promo_cols].max(axis=1) > 0)
                if col_discount:
                    is_promo = is_promo | (df[col_discount] > 0)
                df_sorted = df.sort_values(by=col_week)
                week_numeric = _to_week_numeric(df_sorted[col_week])
                promo_week = week_numeric.where(is_promo.reindex(df_sorted.index))
                last_promo_week = promo_week.groupby([df_sorted[col_sku], df_sorted[col_store]]).ffill()
                weeks_since = week_numeric - last_promo_week
                return weeks_since.reindex(df.index).fillna(999)
            return pd.Series(np.nan, index=df.index)

        elif name == "cannibalization_index_brand":
            if col_sales and col_brand and col_store and col_week and col_sku:
                total_brand_sales = df.groupby([col_brand, col_store, col_week])[col_sales].transform("sum")
                sku_sales = df[col_sales].fillna(0)
                return (total_brand_sales - sku_sales) / total_brand_sales.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "category_demand_index_store_week":
            if col_sales and col_category and col_store and col_week:
                cat_sales_store_week = df.groupby([col_category, col_store, col_week])[col_sales].transform("sum")
                avg_category_sales_store = cat_sales_store_week.groupby([df[col_category], df[col_store]]).transform("mean")
                return cat_sales_store_week / avg_category_sales_store.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "store_size_index":
            if col_sales and col_store and col_week:
                store_sales_week = df.groupby([col_store, col_week])[col_sales].transform("sum")
                avg_store_sales = store_sales_week.groupby(df[col_store]).transform("mean")
                return store_sales_week / avg_store_sales.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        return pd.Series(np.nan, index=df.index)


class RetailDemandForecastRegistry(UseCaseRegistry):
    use_case_id = "retail_demand_forecast"
    
    synonyms = {
        "price": ["Final Retail Price", "Final Cost", "final_retail_price", "retail_price", "price"],
        "store_id": ["store", "Store", "store_id", "store_short_name", "store_name"],
        "week_id": ["Week_Date", "week_date", "Date", "week_id", "week", "snapshot_month"],
        "category": ["P3 Category", "p3_category", "Category", "category", "category_id"],
        "sales_units": ["Net Shipped", "net_shipped", "sales_units", "sales", "quantity", "units"],
        "sku_id": ["Style Code", "style_code", "sku_id", "sku_code", "sku", "item_id", "product_id"],
        "revenue": ["Net Invoiced (USD)", "net_invoiced_usd", "revenue", "Revenue"],
    }
    
    features = {
        "avg_cat_price_store_week": ["price", "category", "store_id", "week_id"],
        "own_cat_price_index": ["price", "category", "store_id", "week_id"],
        "seasonality_index": ["sales_units", "sku_id", "store_id", "week_id"],
        "price_change_vs_last_week": ["price", "sku_id", "store_id", "week_id"],
        "price_change_vs_4wk_avg": ["price", "sku_id", "store_id", "week_id"],
        "category_demand_index_store_week": ["sales_units", "category", "store_id", "week_id"],
        "store_size_index": ["sales_units", "store_id", "week_id"],
    }

    @classmethod
    def compute_feature(cls, name: str, df: pd.DataFrame) -> pd.Series:
        col_price = cls.resolve_column("price", df.columns)
        col_store = cls.resolve_column("store_id", df.columns)
        col_week = cls.resolve_column("week_id", df.columns)
        col_category = cls.resolve_column("category", df.columns)
        col_sales = cls.resolve_column("sales_units", df.columns)
        col_sku = cls.resolve_column("sku_id", df.columns)

        if name == "avg_cat_price_store_week":
            if col_price and col_category and col_store and col_week:
                return df.groupby([col_category, col_store, col_week])[col_price].transform("mean")
            return pd.Series(np.nan, index=df.index)

        elif name == "own_cat_price_index":
            if col_price and col_category and col_store and col_week:
                cat_avg = df.groupby([col_category, col_store, col_week])[col_price].transform("mean")
                return df[col_price] / cat_avg.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "seasonality_index":
            month_col = cls.resolve_column("month", df.columns) or col_week
            if col_sales and col_sku and col_store and month_col:
                avg_sales_group = df.groupby([col_sku, col_store, month_col])[col_sales].transform("mean")
                avg_sales_overall = df.groupby([col_sku, col_store])[col_sales].transform("mean")
                return (avg_sales_group / avg_sales_overall.replace(0, np.nan)).fillna(1.0)
            return pd.Series(np.nan, index=df.index)

        elif name == "price_change_vs_last_week":
            if col_price and col_sku and col_store and col_week:
                df_sorted = df.sort_values(by=col_week)
                price_t_minus_1 = df_sorted.groupby([col_sku, col_store])[col_price].shift(1)
                price_t_minus_1 = price_t_minus_1.reindex(df.index)
                return (df[col_price] - price_t_minus_1) / price_t_minus_1.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "price_change_vs_4wk_avg":
            if col_price and col_sku and col_store and col_week:
                df_sorted = df.sort_values(by=col_week)
                avg_4wk = df_sorted.groupby([col_sku, col_store])[col_price].rolling(window=4, min_periods=1).mean()
                avg_4wk = avg_4wk.reset_index(level=[0, 1], drop=True).reindex(df.index)
                return (df[col_price] - avg_4wk) / avg_4wk.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "category_demand_index_store_week":
            if col_sales and col_category and col_store and col_week:
                cat_sales_store_week = df.groupby([col_category, col_store, col_week])[col_sales].transform("sum")
                avg_category_sales_store = cat_sales_store_week.groupby([df[col_category], df[col_store]]).transform("mean")
                return cat_sales_store_week / avg_category_sales_store.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        elif name == "store_size_index":
            if col_sales and col_store and col_week:
                store_sales_week = df.groupby([col_store, col_week])[col_sales].transform("sum")
                avg_store_sales = store_sales_week.groupby(df[col_store]).transform("mean")
                return store_sales_week / avg_store_sales.replace(0, np.nan)
            return pd.Series(np.nan, index=df.index)

        return pd.Series(np.nan, index=df.index)


class FeatureRegistryManager:
    _registries: dict[str, type[UseCaseRegistry]] = {}

    @classmethod
    def register(cls, registry_cls: type[UseCaseRegistry]):
        cls._registries[registry_cls.use_case_id] = registry_cls

    @classmethod
    def get_registry(cls, use_case_id: str | None = None, column_names: list[str] | None = None, feature_name: str | None = None) -> type[UseCaseRegistry]:
        # 1. Explicit lookup by registered usecase ID
        if use_case_id and use_case_id in cls._registries:
            return cls._registries[use_case_id]
            
        # 2. Dynamic lookup by unique business_logic feature name
        if feature_name:
            matching = []
            for r_id, r_cls in cls._registries.items():
                if feature_name in r_cls.features:
                    matching.append(r_cls)
            if len(matching) == 1:
                return matching[0]

        # 3. Dynamic lookup by synonym column match ratio (for backwards compatibility/auto-detection)
        if column_names:
            best_registry = None
            max_matches = -1
            for r_id, r_cls in cls._registries.items():
                matches = 0
                for col in column_names:
                    for target, synonyms in r_cls.synonyms.items():
                        if col in synonyms or col == target:
                            matches += 1
                            break
                if matches > max_matches:
                    max_matches = matches
                    best_registry = r_cls
            if best_registry and max_matches > 0:
                return best_registry

        # 4. Fallback registry
        return cls._registries.get("cpg_baseline") or CpgBaselineRegistry


# Auto-register use case implementations
FeatureRegistryManager.register(CpgBaselineRegistry)
FeatureRegistryManager.register(RetailDemandForecastRegistry)


# ── Generic Validation and Public APIs ──────────────────────────────────────────

def validate_custom_feature(feature: dict, column_names: list[str], use_case: str | None = None) -> dict:
    errors: list[str] = []
    warnings: list[str] = []
    t = feature.get("type", "")
    name = feature.get("name", "")

    if not name:
        errors.append("Feature name is required")
    elif not name.replace("_", "").isalnum():
        errors.append("Feature name must be alphanumeric with underscores")

    if t in TIME_AWARE_TYPES:
        if not feature.get("sourceColumn"):
            errors.append("sourceColumn is required for time-aware features")
        elif feature.get("sourceColumn") not in column_names:
            warnings.append(f"Column '{feature.get('sourceColumn')}' not found in dataset")
        if not feature.get("timeColumn"):
            warnings.append("timeColumn not specified — using natural order")

    if t == "rolling" and not feature.get("aggregation"):
        warnings.append("aggregation not specified — defaulting to 'mean'")
    if t == "ratio":
        for col_key in ["numeratorColumn", "denominatorColumn"]:
            col = feature.get(col_key)
            if not col:
                errors.append(f"{col_key} is required for ratio features")
            elif col not in column_names:
                warnings.append(f"Column '{col}' not found in dataset")
    if t == "flag":
        if not feature.get("sourceColumn"):
            errors.append("sourceColumn is required for flag features")
        if not feature.get("comparator"):
            errors.append("comparator is required for flag features")
    if t == "interaction":
        for col_key in ["leftColumn", "rightColumn"]:
            col = feature.get(col_key)
            if not col:
                errors.append(f"{col_key} is required for interaction features")
            elif col not in column_names:
                warnings.append(f"Column '{col}' not found in dataset")
                
    if t == "business_logic":
        registry = FeatureRegistryManager.get_registry(use_case_id=use_case, column_names=column_names, feature_name=name)
        if name not in registry.features:
            errors.append(f"Unsupported business logic feature: '{name}' for usecase: '{registry.use_case_id}'")
        else:
            required = registry.features[name]
            for col in required:
                resolved = registry.resolve_column(col, column_names)
                if not resolved:
                    errors.append(f"Required column/synonym '{col}' for feature '{name}' not found in dataset")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "formula": build_custom_feature_formula(feature),
    }


def _compute_single_feature(rows: list[dict], feature: dict, entity_groups: dict[str, list[int]] | None = None, use_case: str | None = None) -> list[Any]:
    t = feature.get("type", "")
    name = feature.get("name", "")
    n = len(rows)

    if t == "business_logic":
        df = pd.DataFrame(rows)
        cols = list(df.columns)
        registry = FeatureRegistryManager.get_registry(use_case_id=use_case, column_names=cols, feature_name=name)
        try:
            series = registry.compute_feature(name, df)
            series = series.replace([np.inf, -np.inf], np.nan)
            return series.where(series.notna(), None).tolist()
        except Exception:
            return [None] * n

    if t == "ratio":
        num_col = feature.get("numeratorColumn", "")
        den_col = feature.get("denominatorColumn", "")
        return [_safe_divide(_to_number(r.get(num_col)), _to_number(r.get(den_col))) for r in rows]

    if t == "flag":
        src = feature.get("sourceColumn", "")
        comparator = feature.get("comparator")
        compare_val = feature.get("compareValue")
        return [1 if _compare(r.get(src), comparator, compare_val) else 0 for r in rows]

    if t == "interaction":
        left = feature.get("leftColumn", "")
        right = feature.get("rightColumn", "")
        op = feature.get("interactionOperator", "multiply")
        results = []
        for r in rows:
            l_val = _to_number(r.get(left))
            r_val = _to_number(r.get(right))
            if l_val is None or r_val is None:
                results.append(None)
                continue
            if op == "multiply":
                results.append(l_val * r_val)
            elif op == "divide":
                results.append(_safe_divide(l_val, r_val))
            elif op == "add":
                results.append(l_val + r_val)
            elif op == "subtract":
                results.append(l_val - r_val)
            else:
                results.append(None)
        return results

    if t in TIME_AWARE_TYPES:
        src = feature.get("sourceColumn", "")
        entity_key = feature.get("entityKey")
        time_col = feature.get("timeColumn")
        periods = feature.get("periods", 1)
        window = feature.get("window", 3)
        aggregation = feature.get("aggregation", "mean")

        if not entity_key or not entity_groups:
            # No entity grouping — treat all rows as one sequence
            values = [_to_number(r.get(src)) for r in rows]
            if t == "lag":
                return [None] * periods + values[: n - periods]
            if t == "rolling":
                result = []
                for i in range(n):
                    start = max(0, i - window + 1)
                    window_vals = [v for v in values[start : i + 1] if v is not None]
                    result.append(_agg(window_vals, aggregation) if window_vals else None)
                return result
            if t == "trend":
                result = []
                for i in range(n):
                    start = max(0, i - window + 1)
                    window_vals = [v for v in values[start : i + 1] if v is not None]
                    result.append(_trend_slope(window_vals) if len(window_vals) >= 2 else None)
                return result

        # Per-entity computation
        results = [None] * n
        for entity, indices in entity_groups.items():
            sorted_idx = indices  # already sorted by time via caller
            vals = [_to_number(rows[i].get(src)) for i in sorted_idx]
            m = len(vals)

            if t == "lag":
                out = [None] * periods + vals[: m - periods]
            elif t == "rolling":
                out = []
                for i in range(m):
                    start = max(0, i - window + 1)
                    w_vals = [v for v in vals[start : i + 1] if v is not None]
                    out.append(_agg(w_vals, aggregation) if w_vals else None)
            else:  # trend
                out = []
                for i in range(m):
                    start = max(0, i - window + 1)
                    w_vals = [v for v in vals[start : i + 1] if v is not None]
                    out.append(_trend_slope(w_vals) if len(w_vals) >= 2 else None)

            for list_pos, row_idx in enumerate(sorted_idx):
                results[row_idx] = out[list_pos]

        return results

    # segment_tag — simple pass-through
    src = feature.get("sourceColumn", "")
    return [str(r.get(src, "")) for r in rows]


def _agg(values: list[float], aggregation: str) -> float | None:
    if not values:
        return None
    if aggregation == "mean":
        return sum(values) / len(values)
    if aggregation == "sum":
        return sum(values)
    if aggregation == "min":
        return min(values)
    if aggregation == "max":
        return max(values)
    if aggregation == "std":
        if len(values) < 2:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / (len(values) - 1)
        return variance ** 0.5
    return sum(values) / len(values)


def _trend_slope(values: list[float]) -> float | None:
    n = len(values)
    if n < 2:
        return None
    x = list(range(n))
    x_mean = sum(x) / n
    y_mean = sum(values) / n
    num = sum((x[i] - x_mean) * (values[i] - y_mean) for i in range(n))
    den = sum((x[i] - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


def _build_entity_groups(rows: list[dict], entity_key: str, time_col: str | None, sort_dir: str = "asc") -> dict[str, list[int]]:
    groups: dict[str, list[int]] = {}
    for i, row in enumerate(rows):
        entity = str(row.get(entity_key, ""))
        if entity not in groups:
            groups[entity] = []
        groups[entity].append(i)

    if time_col:
        reverse = sort_dir == "desc"
        for entity in groups:
            groups[entity].sort(
                key=lambda i: rows[i].get(time_col, ""),
                reverse=reverse,
            )

    return groups


def apply_custom_features(rows: list[dict], features: list[dict], use_case: str | None = None) -> list[dict]:
    if not rows or not features:
        return rows

    result = [dict(row) for row in rows]

    for feature in features:
        t = feature.get("type", "")
        entity_groups = None

        if t in TIME_AWARE_TYPES and feature.get("entityKey"):
            entity_groups = _build_entity_groups(
                result,
                feature["entityKey"],
                feature.get("timeColumn"),
                feature.get("sortDirection", "asc"),
            )

        values = _compute_single_feature(result, feature, entity_groups, use_case=use_case)
        name = feature.get("name", f"feature_{id(feature)}")
        for i, row in enumerate(result):
            row[name] = values[i] if i < len(values) else None

    return result


def build_preview_rows(rows: list[dict], features: list[dict], use_case: str | None = None) -> list[dict]:
    return apply_custom_features(rows, features, use_case=use_case)


# ── Dataset helpers ───────────────────────────────────────────────────────────

def get_dataset_rows(ds) -> list[dict]:
    dp = ds.data_preview
    if not dp:
        return []

    if isinstance(dp, dict):
        if isinstance(dp.get("all"), list):
            return dp["all"]

        compressed = dp.get("compressedCsvBase64")
        raw_csv = dp.get("rawCsv")

        if compressed:
            try:
                csv_text = gzip.decompress(base64.b64decode(compressed)).decode("utf-8")
                return _parse_csv(csv_text)
            except Exception:
                pass

        if raw_csv:
            return _parse_csv(raw_csv)

        sample = dp.get("sample") or dp.get("preview")
        if isinstance(sample, list):
            return sample

    return []


def get_dataset_custom_features(ds) -> list[dict]:
    fr = ds.feature_report
    if not fr or not isinstance(fr, dict):
        return []
    features = fr.get("customFeatures", [])
    return features if isinstance(features, list) else []


def get_model_custom_features(model, dataset=None) -> list[dict]:
    mw = model.model_weights
    if isinstance(mw, dict):
        snapshot = mw.get("customFeatures")
        if isinstance(snapshot, list) and snapshot:
            return snapshot
    if dataset:
        return get_dataset_custom_features(dataset)
    return []


def _parse_csv(csv_text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []
    for row in reader:
        cleaned: dict[str, Any] = {}
        for k, v in row.items():
            if v == "" or v is None:
                cleaned[k] = None
            else:
                try:
                    cleaned[k] = int(v)
                except ValueError:
                    try:
                        cleaned[k] = float(v)
                    except ValueError:
                        cleaned[k] = v
        rows.append(cleaned)
    return rows
