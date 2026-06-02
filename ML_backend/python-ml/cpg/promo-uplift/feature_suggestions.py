"""
CPG Promo-Uplift — LLM-based feature suggestion generator.

Input  (JSON file):
  {
    "datasetName"   : str,
    "columns"       : [str, ...],
    "columnDetails" : [{"name": str, "type": str}, ...],
    "sampleRows"    : [{col: val, ...}, ...],   // up to 8 rows
    "promoColumns"  : [str, ...],
    "entityColumn"  : str | null,
    "timeColumn"    : str | null
  }

Output (JSON file):
  {
    "success"    : bool,
    "suggestions": [{...}, ...],
    "source"     : "llm" | "fallback"
  }

Usage:
    python feature_suggestions.py <input_json> <output_json>
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# Make the prompts package importable regardless of cwd
sys.path.insert(0, str(Path(__file__).parent))
from prompts.feature_suggestions_prompt import (
    ALLOWED_TYPES,
    SYSTEM_PROMPT,
    build_user_prompt,
)


# ── JSON parsing helpers ──────────────────────────────────────────────────────

def _safe_json_load(text: str) -> Any | None:
    text = text.strip()
    # Strip markdown code fences if present
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text, flags=re.MULTILINE)
    text = text.strip()

    for pattern in [r"(\[\s*\{.*\}\s*\])", r"(\{.*\})"]:
        m = re.search(pattern, text, re.S)
        if m:
            try:
                return json.loads(m.group(1))
            except Exception:
                continue

    try:
        return json.loads(text)
    except Exception:
        return None


# ── Fallback heuristic suggestions ───────────────────────────────────────────

def _build_fallback_suggestions(
    columns: list[str],
    promo_columns: list[str],
    entity_column: str | None,
    time_column: str | None,
) -> list[dict[str, Any]]:
    """
    Rule-based suggestions used when the LLM is unavailable.
    Works on any dataset by falling back to all non-structural columns when
    specific keyword matches are absent.
    """
    numeric_keywords = [
        "price", "sales", "units", "revenue", "gross", "net", "value",
        "cost", "margin", "volume", "spend", "amount", "index", "rate",
        "baseline", "uplift", "predicted", "residual", "decomp", "effect",
        "actual", "forecast", "base", "promo", "discount", "lift", "qty",
        "count", "total", "avg", "mean", "sum", "score",
    ]

    entity_key = entity_column or next(
        (c for c in columns if c in ("sku_id", "product_id", "item_id")), None
    )
    time_col = time_column or next(
        (c for c in columns if any(k in c.lower() for k in ("week", "month", "date", "period", "time", "year"))), None
    )

    reserved = {c for c in [entity_key, time_col] if c} | set(promo_columns or [])
    numeric_cols = [
        c for c in columns
        if any(k in c.lower() for k in numeric_keywords) and c not in reserved
    ]

    # Fallback: if still empty, use any non-reserved column
    if not numeric_cols:
        numeric_cols = [c for c in columns if c not in reserved]

    suggestions: list[dict[str, Any]] = []
    sid = 1

    # 1. Trend on first numeric
    if numeric_cols and time_col:
        src = numeric_cols[0]
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{src}_trend_3w",
            "type": "trend", "formula": f"trend_slope({src}, window=3)",
            "sourceColumn": src, "window": 3,
            "entityKey": entity_key, "timeColumn": time_col, "sortDirection": "asc",
            "priority": "high", "importanceGain": 0.042,
            "reason": (
                f"3-week trend slope of {src} captures promotional momentum and "
                "carry-over effects that are strong causal signals in promo uplift models."
            ),
        })
        sid += 1

    # 2. Lag-1 on first promo column (or first numeric)
    promo_src = promo_columns[0] if promo_columns else (numeric_cols[0] if numeric_cols else None)
    if promo_src and time_col:
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{promo_src}_lag_1",
            "type": "lag", "formula": f"lag({promo_src}, periods=1)",
            "sourceColumn": promo_src, "periods": 1,
            "entityKey": entity_key, "timeColumn": time_col, "sortDirection": "asc",
            "priority": "high", "importanceGain": 0.038,
            "reason": (
                f"Previous-week value of {promo_src} captures pre-loading and "
                "post-promotion dip effects that shift units across periods."
            ),
        })
        sid += 1

    # 3. Rolling mean on second numeric — baseline normalisation
    num2 = numeric_cols[1] if len(numeric_cols) >= 2 else (numeric_cols[0] if numeric_cols else None)
    if num2 and time_col:
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{num2}_rolling_mean_4w",
            "type": "rolling", "formula": f"mean({num2}, window=4)",
            "sourceColumn": num2, "window": 4, "aggregation": "mean",
            "entityKey": entity_key, "timeColumn": time_col, "sortDirection": "asc",
            "priority": "medium", "importanceGain": 0.031,
            "reason": (
                f"4-week rolling mean of {num2} smooths short-term noise and provides "
                "a stable baseline against which the promo lift is measured."
            ),
        })
        sid += 1

    # 4. Ratio between first two numeric columns
    if len(numeric_cols) >= 2:
        n1, n2 = numeric_cols[0], numeric_cols[1]
        suggestions.append({
            "id": f"sug_{sid}",
            "name": f"{n1}_to_{n2}_ratio",
            "type": "ratio",
            "formula": f"{n1} / {n2}",
            "numeratorColumn": n1, "denominatorColumn": n2,
            "priority": "high", "importanceGain": 0.045,
            "reason": (
                f"Ratio of {n1} to {n2} captures relative positioning — "
                "a key driver of promo response and baseline sales."
            ),
        })
        sid += 1

    # 5. Promo × numeric interaction
    if promo_columns and numeric_cols:
        pc = promo_columns[0]
        nc = numeric_cols[0]
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{pc}_x_{nc}_intensity",
            "type": "interaction", "formula": f"{pc} * {nc}",
            "leftColumn": pc, "rightColumn": nc,
            "interactionOperator": "multiply",
            "priority": "medium", "importanceGain": 0.029,
            "reason": (
                f"Multiplying {pc} by {nc} creates a combined promo-intensity signal "
                "that tree models struggle to learn from the raw columns separately."
            ),
        })
        sid += 1

    # 6. Active promo flag (binary)
    flag_src = (promo_columns[-1] if promo_columns else (numeric_cols[0] if numeric_cols else None))
    if flag_src:
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{flag_src}_active_flag",
            "type": "flag", "formula": f"{flag_src} > 0",
            "sourceColumn": flag_src, "comparator": "gt", "compareValue": 0,
            "priority": "medium", "importanceGain": 0.023,
            "reason": (
                f"Binary flag for {flag_src} converts a continuous variable into a "
                "clean activation signal that stabilises model coefficients."
            ),
        })
        sid += 1

    # 7. Rolling std on first numeric — volatility signal
    if numeric_cols and time_col and len(suggestions) < 7:
        src_std = numeric_cols[0]
        suggestions.append({
            "id": f"sug_{sid}", "name": f"{src_std}_rolling_std_4w",
            "type": "rolling", "formula": f"std({src_std}, window=4)",
            "sourceColumn": src_std, "window": 4, "aggregation": "std",
            "entityKey": entity_key, "timeColumn": time_col, "sortDirection": "asc",
            "priority": "low", "importanceGain": 0.018,
            "reason": (
                f"4-week rolling standard deviation of {src_std} captures volatility "
                "that can indicate irregular promo patterns or data quality issues."
            ),
        })
        sid += 1

    return suggestions[:8]


# ── Output cleaner ────────────────────────────────────────────────────────────

_OPTIONAL_FIELDS = [
    "entityKey", "timeColumn", "sortDirection", "sourceColumn",
    "periods", "window", "aggregation",
    "numeratorColumn", "denominatorColumn",
    "comparator", "compareValue",
    "leftColumn", "rightColumn", "interactionOperator",
]


def _clean_suggestions(raw: list[Any], idx_offset: int = 0) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for idx, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        ftype = str(item.get("type", "ratio"))
        if ftype not in ALLOWED_TYPES:
            ftype = "ratio"
        priority = str(item.get("priority", "medium"))
        if priority not in ("high", "medium", "low"):
            priority = "medium"
        try:
            importance = float(item.get("importanceGain", 0.02))
        except (TypeError, ValueError):
            importance = 0.02
        importance = max(0.01, min(0.06, importance))

        feature: dict[str, Any] = {
            "id": str(item.get("id") or item.get("name") or f"sug_{idx_offset + idx}"),
            "name": str(item.get("name") or f"suggested_feature_{idx_offset + idx}"),
            "type": ftype,
            "formula": str(item.get("formula", "")),
            "priority": priority,
            "importanceGain": round(importance, 4),
            "reason": str(item.get("reason", "Feature engineered from dataset context.")),
        }
        for field in _OPTIONAL_FIELDS:
            val = item.get(field)
            if val is not None:
                feature[field] = val
        cleaned.append(feature)
    return cleaned


# ── LLM call ─────────────────────────────────────────────────────────────────

def _call_groq(
    api_key: str,
    user_prompt: str,
) -> list[dict[str, Any]] | None:
    try:
        from groq import Groq
        client = Groq(api_key=api_key)
        response = client.chat.completions.create(
            model="moonshotai/kimi-k2-instruct-0905",
            temperature=0.2,
            max_tokens=1200,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
        )
        content = response.choices[0].message.content
        loaded = _safe_json_load(content)
        if isinstance(loaded, list):
            return loaded
        if isinstance(loaded, dict) and isinstance(loaded.get("suggestions"), list):
            return loaded["suggestions"]
    except Exception as exc:
        sys.stderr.write(f"[feature_suggestions] Groq call failed: {exc}\n")
        sys.stderr.flush()
    return None


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 3:
        sys.stdout.write(
            json.dumps({"success": False, "error": "Usage: python feature_suggestions.py <input_json> <output_json>"})
            + "\n"
        )
        sys.stdout.flush()
        sys.exit(1)

    input_file, output_file = sys.argv[1], sys.argv[2]

    try:
        with open(input_file, "r", encoding="utf-8") as f:
            inp = json.load(f)

        dataset_name   = str(inp.get("datasetName", "Dataset"))
        columns        = inp.get("columns", [])
        column_details = inp.get("columnDetails", [{"name": c, "type": "unknown"} for c in columns])
        sample_rows    = inp.get("sampleRows", [])
        promo_columns  = inp.get("promoColumns", [])
        entity_column  = inp.get("entityColumn")
        time_column    = inp.get("timeColumn")

        groq_api_key = os.environ.get("GROQ_API_KEY", "").strip()
        source = "fallback"
        raw_suggestions = None

        if groq_api_key:
            user_prompt = build_user_prompt(
                dataset_name=dataset_name,
                columns=columns,
                column_details=column_details,
                sample_rows=sample_rows,
                promo_columns=promo_columns,
                entity_column=entity_column,
                time_column=time_column,
            )
            raw_suggestions = _call_groq(groq_api_key, user_prompt)
            if raw_suggestions:
                source = "llm"

        if not raw_suggestions:
            raw_suggestions = _build_fallback_suggestions(
                columns, promo_columns, entity_column, time_column
            )

        suggestions = _clean_suggestions(raw_suggestions)

        output = {"success": True, "suggestions": suggestions, "source": source}
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(output, f, indent=2)

        sys.stdout.write(
            json.dumps({"success": True, "message": f"Generated {len(suggestions)} suggestions ({source})."})
            + "\n"
        )
        sys.stdout.flush()

    except Exception as exc:
        error_out = {"success": False, "error": str(exc)}
        try:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(error_out, f, indent=2)
        except Exception:
            pass
        sys.stdout.write(json.dumps(error_out) + "\n")
        sys.stdout.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
