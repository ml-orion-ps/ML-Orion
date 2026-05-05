"""
Computes lag, rolling, trend, ratio, flag, segment_tag, and interaction features.
"""
from __future__ import annotations
import gzip
import base64
import io
import csv
from typing import Any


TIME_AWARE_TYPES = {"lag", "rolling", "trend"}


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
    return ""


def validate_custom_feature(feature: dict, column_names: list[str]) -> dict:
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

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "formula": build_custom_feature_formula(feature),
    }


def _compute_single_feature(rows: list[dict], feature: dict, entity_groups: dict[str, list[int]] | None = None) -> list[Any]:
    t = feature.get("type", "")
    name = feature.get("name", "")
    n = len(rows)

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


def apply_custom_features(rows: list[dict], features: list[dict]) -> list[dict]:
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

        values = _compute_single_feature(result, feature, entity_groups)
        name = feature.get("name", f"feature_{id(feature)}")
        for i, row in enumerate(result):
            row[name] = values[i] if i < len(values) else None

    return result


def build_preview_rows(rows: list[dict], features: list[dict]) -> list[dict]:
    return apply_custom_features(rows, features)


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
