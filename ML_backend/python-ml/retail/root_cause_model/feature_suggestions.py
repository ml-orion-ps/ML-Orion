import json
import os
import re
import sys
import time

from typing import Any, Dict, List, Optional

GROQ_SYSTEM = """
You are an expert feature engineering assistant for tabular customer datasets.
You will generate feature engineering suggestions that are actionable and directly derived from the dataset schema and sample rows.
Use only the dataset columns provided. Output must be valid JSON.
""".strip()

ALLOWED_TYPES = ["rolling", "lag", "trend", "ratio", "flag", "segment_tag", "interaction"]


def safe_json_load(text: str) -> Optional[Any]:
    cleaned = text.strip()
    cleaned = cleaned.replace("\\'", '"')
    cleaned = re.sub(r"\s+", " ", cleaned)

    # Prefer a raw JSON array/object substring if available.
    for pattern in [r"(\[\s*\{.*\}\s*\])", r"(\{.*\})"]:
        match = re.search(pattern, cleaned, re.S)
        if match:
            try:
                return json.loads(match.group(1))
            except Exception:
                continue

    try:
        return json.loads(cleaned)
    except Exception:
        return None


def build_prompt(dataset_name: str, columns: List[str], sample_rows: List[Dict[str, Any]], target_column: Optional[str]) -> str:
    rows_snippet = json.dumps(sample_rows[:8], ensure_ascii=False, indent=2)
    target_line = f"Target column: {target_column}" if target_column else "Target column: None (unknown)"
    return f"""
Dataset name: {dataset_name}
Columns: {', '.join(columns)}
{target_line}

Sample rows:
{rows_snippet}

Task:
Return an array of up to 6 suggested custom features for this dataset.
Each suggestion must be a JSON object with the following keys:
- id: unique string
- name: feature_name
- type: one of {ALLOWED_TYPES}
- formula: a human-readable formula string
- sourceColumn, numeratorColumn, denominatorColumn, comparator, compareValue, leftColumn, rightColumn, interactionOperator: supply the relevant fields for the chosen type, omit unused fields or set them to null
- priority: "high", "medium", or "low"
- importanceGain: a numeric score between 0.01 and 0.06
- reason: short explanation of why this feature is helpful for churn or customer risk modeling.

Requirements:
- Use only the provided columns.
- Do not invent new dataset columns.
- Keep names snake_case and meaningful.
- Use the allowed feature types only.
- Ensure the output is valid JSON and nothing else.
""".strip()


def build_fallback_suggestions(columns: List[str], target_column: Optional[str]) -> List[Dict[str, Any]]:
    numeric_columns = [col for col in columns if any(keyword in col.lower() for keyword in ["revenue", "score", "count", "amount", "speed", "tenure", "balance", "charge", "usage", "cost", "weight"])]
    flag_columns = [col for col in columns if any(keyword in col.lower() for keyword in ["status", "flag", "type", "category", "region", "segment", "tier"])]
    date_columns = [col for col in columns if any(keyword in col.lower() for keyword in ["date", "month", "week", "day"])]
    entity_key = "account_number" if "account_number" in columns else (columns[0] if columns else "account_number")
    time_column = None
    for candidate in ["snapshot_month", "snapshotMonth"] + date_columns:
        if candidate in columns:
            time_column = candidate
            break

    suggestions = []

    if numeric_columns and time_column:
        source = numeric_columns[0]
        suggestions.append({
            "id": "suggestion_trend_1",
            "name": f"{source}_trend_3m",
            "type": "trend",
            "formula": f"trend_slope({source}, window=3)",
            "entityKey": entity_key,
            "timeColumn": time_column,
            "sortDirection": "asc",
            "sourceColumn": source,
            "window": 3,
            "priority": "high",
            "importanceGain": 0.045,
            "reason": "Captures recent trajectory for an important numeric signal.",
        })

    if len(numeric_columns) >= 2:
        suggestions.append({
            "id": "suggestion_ratio_1",
            "name": f"{numeric_columns[0]}_to_{numeric_columns[1]}_ratio",
            "type": "ratio",
            "formula": f"{numeric_columns[0]} / {numeric_columns[1]}",
            "numeratorColumn": numeric_columns[0],
            "denominatorColumn": numeric_columns[1],
            "priority": "medium",
            "importanceGain": 0.035,
            "reason": "Relative ratios often surface imbalance between related metrics.",
        })

    if flag_columns and numeric_columns:
        suggestions.append({
            "id": "suggestion_flag_1",
            "name": f"high_{numeric_columns[0]}_{flag_columns[0]}_flag",
            "type": "flag",
            "formula": f"{numeric_columns[0]} > 0",
            "sourceColumn": numeric_columns[0],
            "comparator": "gt",
            "compareValue": 0,
            "priority": "medium",
            "importanceGain": 0.028,
            "reason": "Highlights when a key numeric signal is elevated.",
        })

    if len(numeric_columns) >= 2:
        suggestions.append({
            "id": "suggestion_interaction_1",
            "name": f"{numeric_columns[0]}_x_{numeric_columns[1]}",
            "type": "interaction",
            "formula": f"{numeric_columns[0]} * {numeric_columns[1]}",
            "leftColumn": numeric_columns[0],
            "rightColumn": numeric_columns[1],
            "interactionOperator": "multiply",
            "priority": "low",
            "importanceGain": 0.022,
            "reason": "Interaction between two numeric metrics can expose joint risk behavior.",
        })

    return suggestions[:6]


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.stdout.write(json.dumps({"success": False, "error": "Usage: python feature_suggestions.py <input_json> <output_json>"}) + "\n")
        sys.stdout.flush()
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2]

    try:
        with open(input_file, 'r', encoding='utf-8') as f:
            input_data = json.load(f)

        dataset_name = input_data.get("datasetName", "Dataset")
        columns = input_data.get("columns", [])
        sample_rows = input_data.get("sampleRows", [])
        target_column = input_data.get("targetColumn")

        groq_api_key = os.environ.get("GROQ_API_KEY", "").strip()
        suggestions = []

        if groq_api_key:
            try:
                from groq import Groq
                groq_client = Groq(api_key=groq_api_key)
                prompt = build_prompt(dataset_name, columns, sample_rows, target_column)
                response = groq_client.chat.completions.create(
                    model="moonshotai/kimi-k2-instruct-0905",
                    temperature=0.2,
                    max_tokens=350,
                    messages=[
                        {"role": "system", "content": GROQ_SYSTEM},
                        {"role": "user", "content": prompt},
                    ],
                )
                content = response.choices[0].message.content
                loaded = safe_json_load(content)
                if isinstance(loaded, list):
                    suggestions = loaded
                elif isinstance(loaded, dict) and isinstance(loaded.get("suggestions"), list):
                    suggestions = loaded.get("suggestions")
            except Exception as exc:
                sys.stderr.write(f"Groq suggestion generation failed: {exc}\n")
                sys.stderr.flush()

        if not suggestions:
            suggestions = build_fallback_suggestions(columns, target_column)

        # Ensure required keys and quality
        cleaned_suggestions = []
        for idx, suggestion in enumerate(suggestions):
            if not isinstance(suggestion, dict):
                continue
            feature = {
                "id": str(suggestion.get("id") or suggestion.get("name") or f"feature_{idx}"),
                "name": str(suggestion.get("name", f"suggested_feature_{idx}")),
                "type": str(suggestion.get("type", "ratio")) if str(suggestion.get("type", "ratio")) in ALLOWED_TYPES else "ratio",
                "formula": str(suggestion.get("formula", "")),
                "priority": str(suggestion.get("priority", "medium")) if str(suggestion.get("priority", "medium")) in ["high", "medium", "low"] else "medium",
                "importanceGain": float(suggestion.get("importanceGain", 0.02)) if suggestion.get("importanceGain") is not None else 0.02,
                "reason": str(suggestion.get("reason", "Feature engineered from dataset context.")),
            }

            # Only add optional fields if they are not None
            optional_fields = [
                "entityKey", "timeColumn", "sortDirection", "sourceColumn",
                "periods", "window", "aggregation", "numeratorColumn", "denominatorColumn",
                "comparator", "compareValue", "leftColumn", "rightColumn", "interactionOperator"
            ]

            for field in optional_fields:
                value = suggestion.get(field)
                if value is not None:
                    feature[field] = value

            cleaned_suggestions.append(feature)

        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump({"success": True, "suggestions": cleaned_suggestions}, f, indent=2)

        sys.stdout.write(json.dumps({"success": True, "message": f"Generated {len(cleaned_suggestions)} feature suggestions."}) + "\n")
        sys.stdout.flush()
    except Exception as exc:
        error_payload = {"success": False, "error": str(exc)}
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(error_payload, f, indent=2)
        except Exception:
            pass
        sys.stdout.write(json.dumps(error_payload) + "\n")
        sys.stdout.flush()
        sys.exit(1)
