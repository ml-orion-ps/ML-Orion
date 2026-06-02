"""
Prompt templates for CPG promo-uplift feature suggestion generation.

This module owns every string sent to the LLM — system prompt, user prompt
builder, and the canonical list of allowed feature types.  Keep all prompt
wording here so tuning never requires touching the main script.
"""
from __future__ import annotations

import json
from typing import Any

# ── Allowed feature types (must match custom_features.py) ────────────────────

ALLOWED_TYPES = ["rolling", "lag", "trend", "ratio", "flag", "segment_tag", "interaction"]

# ── System prompt ─────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """
You are an expert feature engineering assistant specialised in Consumer Packaged Goods (CPG)
trade promotion analysis and promo-uplift modelling.

Your job is to read a dataset schema (column names, types, sample rows) and produce a list of
high-value custom feature suggestions that will improve the accuracy of a causal promo-uplift
model.  The model predicts the incremental sales units caused by each promotional mechanic
(e.g. discount depth, feature ad, display placement, BOGO) using a counterfactual approach.

Domain knowledge you must apply:
- Price elasticity: log-price, price-index, and relative competitive price ratios are powerful
  predictors of baseline sales.
- Promo response: lag and rolling features on promo columns capture carry-over and pre-loading
  effects.  Trend features on sales units reveal promotional momentum.
- Promotional interaction: multiplying discount depth by a binary promo flag creates a
  combined intensity signal that tree models cannot easily learn on their own.
- Competitive dynamics: ratios of own price to competitor prices reveal relative positioning.
- Baseline normalisation: dividing sales by a rolling mean removes seasonal scale, isolating
  the promotional signal.
- Seasonal patterns: rolling aggregations on seasonality_index or holiday_flag over 2-4 weeks
  smooth noise and expose underlying cycles.

Rules you must follow:
1. Use ONLY columns that appear in the provided column list.  Do not invent columns.
2. Feature names must be snake_case, descriptive, and unique.
3. Use only the allowed feature types listed below.
4. Output ONLY a valid JSON array — no markdown, no explanation, no code fences.
5. Each element must be a JSON object matching the schema described in the user message.
6. Set importanceGain to a realistic float in [0.01, 0.06] based on expected uplift model impact.
7. Provide 6 to 8 suggestions — prioritise variety across types (trend, lag, ratio, interaction,
   flag) rather than repeating the same type.
""".strip()

# ── User prompt builder ───────────────────────────────────────────────────────

def build_user_prompt(
    dataset_name: str,
    columns: list[str],
    column_details: list[dict[str, Any]],
    sample_rows: list[dict[str, Any]],
    promo_columns: list[str],
    entity_column: str | None,
    time_column: str | None,
) -> str:
    """
    Build the user-turn message sent to the LLM.

    Parameters
    ----------
    dataset_name    : Human-readable name of the dataset.
    columns         : Ordered list of all column names.
    column_details  : List of {name, type} dicts describing each column.
    sample_rows     : Up to 8 representative rows (list of dicts).
    promo_columns   : Detected promotional mechanic column names.
    entity_column   : Column identifying the SKU / product entity (e.g. sku_id).
    time_column     : Column representing time steps (e.g. week_id).
    """
    col_type_lines = "\n".join(
        f"  - {d['name']} ({d.get('type', 'unknown')})" for d in column_details
    )
    promo_line = ", ".join(promo_columns) if promo_columns else "none detected"
    entity_line = entity_column or "unknown"
    time_line = time_column or "unknown"
    rows_json = json.dumps(sample_rows[:8], ensure_ascii=False, indent=2)

    output_schema = """
Each suggestion object must contain these keys:
  Required:
    id            : unique string identifier (e.g. "sug_price_ratio_1")
    name          : snake_case feature name (e.g. "price_to_base_ratio")
    type          : one of """ + str(ALLOWED_TYPES) + """
    formula       : human-readable formula string
    priority      : "high", "medium", or "low"
    importanceGain: float in [0.01, 0.06]
    reason        : 1-2 sentence explanation of why this feature helps promo uplift modelling

  Conditional (include only what applies to the chosen type):
    sourceColumn        : for lag, rolling, trend, flag, segment_tag
    periods             : int, for lag
    window              : int, for rolling and trend
    aggregation         : "mean"|"sum"|"min"|"max"|"std", for rolling
    numeratorColumn     : for ratio
    denominatorColumn   : for ratio
    comparator          : "gt"|"gte"|"lt"|"lte"|"eq"|"ne"|"contains", for flag
    compareValue        : threshold value, for flag
    leftColumn          : for interaction
    rightColumn         : for interaction
    interactionOperator : "multiply"|"divide"|"add"|"subtract", for interaction
    entityKey           : for lag, rolling, trend (set to entity column if per-SKU computation is needed)
    timeColumn          : for lag, rolling, trend (set to time column for correct ordering)
    sortDirection       : "asc" or "desc", for lag, rolling, trend
""".strip()

    return f"""
Dataset: {dataset_name}
Context: CPG trade promotion — promo-uplift model (counterfactual causal inference on sales units)

Entity column (SKU / product): {entity_line}
Time column (weekly periods):  {time_line}
Active promo columns:          {promo_line}

All columns with types:
{col_type_lines}

Sample rows (up to 8):
{rows_json}

Task:
Return a JSON array of 6–8 feature engineering suggestions that will most improve a
promo-uplift model trained on this dataset.  Focus on features that capture:
  - Price sensitivity and competitive positioning
  - Promotional carry-over, pre-loading, and response curves
  - Baseline sales normalisation and seasonal patterns
  - Interaction effects between promo mechanics and price

{output_schema}

Return ONLY the JSON array.  No markdown, no commentary.
""".strip()
