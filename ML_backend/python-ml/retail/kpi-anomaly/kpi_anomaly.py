"""
Self-contained KPI anomaly detection module.

All logic from the original kpi_anomaly package is inlined here so this file
can be loaded in-process via importlib without a package context.

Public entry points
-------------------
run_kpi_anomaly(data, kpi_config, kpi_names, date_col)  -> dict
safe_serialize(obj)                                      -> JSON-serialisable obj
"""
from __future__ import annotations

import math
import traceback

import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

# ── Default KPI configuration ──────────────────────────────────────────────

DEFAULT_KPI_CONFIG: dict[str, dict] = {
    "set_rate":         {"window1": 3, "window2": 6, "anomaly_percentile": 12},
    "demo_rate":        {"window1": 3, "window2": 7, "anomaly_percentile": 13},
    "gross_close_rate": {"window1": 2, "window2": 6, "anomaly_percentile": 13},
    "issue_rate":       {"window1": 2, "window2": 6, "anomaly_percentile": 15},
    "net_close_rate":   {"window1": 2, "window2": 5, "anomaly_percentile": 18},
    "avg_ticket_size":  {"window1": 4, "window2": 7, "anomaly_percentile": 18},
    "cost_per_lead":    {"window1": 4, "window2": 6, "anomaly_percentile": 14},
    "cost_per_demo":    {"window1": 2, "window2": 8, "anomaly_percentile": 12},
}

# ── Feature engineering ────────────────────────────────────────────────────


def _create_features(data: pd.DataFrame, kpi: str, window_size: int) -> pd.DataFrame:
    """Rolling statistical features for anomaly detection (no data leakage)."""
    history = data[kpi].shift(1)

    rmean = history.rolling(window=window_size).mean()
    rstd  = history.rolling(window=window_size).std()
    rmed  = history.rolling(window=window_size).median()

    features = pd.DataFrame(index=data.index)

    epsilon = 1e-6
    z = (data[kpi] - rmean) / (rstd + epsilon)

    features[f"z_score_{window_size}"] = z.clip(-20, 20)
    features["pct_change"]             = data[kpi].pct_change(fill_method=None)
    features[f"med_dev_{window_size}"] = data[kpi] - rmed

    return features


# ── Per-KPI anomaly detection ──────────────────────────────────────────────


def _detect_kpi_anomaly(
    df_raw: pd.DataFrame,
    kpi: str,
    window1: int,
    window2: int,
    anomaly_percentile: int,
) -> pd.DataFrame | None:
    """Runs anomaly detection for a single KPI. Returns result DataFrame or None."""
    df = df_raw.copy()

    df_features1 = _create_features(df, kpi, window1)
    df_features2 = _create_features(df, kpi, window2)

    df_features = pd.concat([df_features1, df_features2], axis=1)
    df_features = df_features.loc[:, ~df_features.columns.duplicated(keep="last")]

    history_4 = df[kpi].shift(1)

    df["last_4_week_avg"]    = history_4.rolling(window=4).mean()
    df["last_4_week_median"] = history_4.rolling(window=4).median()

    df["diff_vs_last_4_week_avg"]    = df[kpi] - df["last_4_week_avg"]
    df["diff_vs_last_4_week_median"] = df[kpi] - df["last_4_week_median"]

    df_features["diff_vs_last_4_week_avg"] = df["diff_vs_last_4_week_avg"]

    X_raw = df_features.dropna()

    if X_raw.shape[0] < 5:
        print(f"Skipping {kpi} — insufficient usable data")
        return None

    scaler   = StandardScaler()
    X_scaled = scaler.fit_transform(X_raw)

    model = IsolationForest(contamination="auto", random_state=42)
    model.fit(X_scaled)

    df.loc[X_raw.index, "anomaly_score"] = model.decision_function(X_scaled)

    dynamic_threshold = np.percentile(
        df.loc[X_raw.index, "anomaly_score"],
        anomaly_percentile,
    )

    df["is_anomaly"] = np.where(df["anomaly_score"] < dynamic_threshold, -1, 1)

    df["top_driver"]      = None
    df["top_driver_shap"] = np.nan

    all_valid_index = X_raw.index.tolist()
    X_all_scaled    = X_scaled

    anom_positions = [
        i for i, idx in enumerate(all_valid_index)
        if df.loc[idx, "is_anomaly"] == -1
    ]

    if anom_positions:
        X_anom_scaled = X_all_scaled[anom_positions]
        explainer     = shap.TreeExplainer(model)
        shap_vals     = explainer.shap_values(X_anom_scaled)
        top_feat_idx  = np.abs(shap_vals).argmax(axis=1)

        anom_df_indices = [all_valid_index[i] for i in anom_positions]

        df.loc[anom_df_indices, "top_driver"] = [
            X_raw.columns[i] for i in top_feat_idx
        ]
        df.loc[anom_df_indices, "top_driver_shap"] = shap_vals[
            np.arange(len(shap_vals)), top_feat_idx
        ]

    base_cols = [
        "Week_Start_Date", kpi, "anomaly_score", "is_anomaly",
        "top_driver", "top_driver_shap",
        "last_4_week_avg", "last_4_week_median",
        "diff_vs_last_4_week_avg", "diff_vs_last_4_week_median",
        "data_quality_flag", "data_warning_msg",
    ]

    present_cols = [c for c in base_cols if c in df.columns]
    result_df    = df.loc[all_valid_index, present_cols].copy()

    result_df = pd.concat(
        [result_df, df_features.loc[all_valid_index].copy()], axis=1
    )

    result_df["window1"]            = window1
    result_df["window2"]            = window2
    result_df["anomaly_percentile"] = anomaly_percentile

    return result_df


# ── Pipeline ───────────────────────────────────────────────────────────────


def _run_all_kpi_anomalies(df_raw: pd.DataFrame, kpi_config: dict) -> dict:
    """Runs anomaly detection for all KPIs present in kpi_config."""
    results: dict[str, pd.DataFrame] = {}

    for kpi, cfg in kpi_config.items():
        if kpi not in df_raw.columns:
            print(f"Skipping {kpi} — column not found in input data")
            continue
        try:
            result = _detect_kpi_anomaly(
                df_raw=df_raw,
                kpi=kpi,
                window1=cfg["window1"],
                window2=cfg["window2"],
                anomaly_percentile=cfg["anomaly_percentile"],
            )
            if result is not None:
                results[kpi] = result
        except Exception as exc:
            print(f"Error processing {kpi}: {exc}")

    return results


def _combine_kpi_results(
    results: dict[str, pd.DataFrame],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Combines per-KPI results into one DataFrame. Returns (final, anomalies_only)."""
    all_results: list[pd.DataFrame] = []

    for kpi, df_result in results.items():
        df_result = df_result.copy().reset_index(drop=True)
        df_result = df_result.loc[:, ~df_result.columns.duplicated()]
        df_result["kpi"]   = kpi
        df_result          = df_result.rename(columns={kpi: "kpi_value"})
        all_results.append(df_result)

    if not all_results:
        return pd.DataFrame(), pd.DataFrame()

    final_results = pd.concat(all_results, ignore_index=True)
    final_results = final_results.dropna(axis=1, how="all")

    front_columns = [
        col for col in [
            "kpi", "Week_Start_Date", "kpi_value",
            "window1", "window2", "anomaly_percentile",
            "anomaly_score", "is_anomaly",
            "top_driver", "top_driver_shap",
            "last_4_week_avg", "last_4_week_median",
            "diff_vs_last_4_week_avg", "diff_vs_last_4_week_median",
            "data_quality_flag", "data_warning_msg",
        ]
        if col in final_results.columns
    ]
    remaining_columns = [
        col for col in final_results.columns if col not in front_columns
    ]
    final_results = final_results[front_columns + remaining_columns]

    anomalies_only = final_results[
        final_results["is_anomaly"] == -1
    ].reset_index(drop=True)

    return final_results, anomalies_only


# ── Serialisation helper ───────────────────────────────────────────────────


def safe_serialize(obj):
    """Replace NaN/Inf/Timestamp with JSON-serialisable equivalents."""
    import pandas as _pd
    import numpy as _np
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (_pd.Timestamp, _pd.NaT.__class__)):
        return None if _pd.isnull(obj) else obj.isoformat()
    if isinstance(obj, _np.integer):
        return int(obj)
    if isinstance(obj, _np.floating):
        v = float(obj)
        return None if (math.isnan(v) or math.isinf(v)) else v
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: safe_serialize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [safe_serialize(i) for i in obj]
    return obj


# ── Public entry point ─────────────────────────────────────────────────────


def run_kpi_anomaly(
    data: list[dict],
    kpi_config: dict | None = None,
    kpi_names: list[str] | None = None,
    date_col: str = "Week_Start_Date",
) -> dict:
    """
    Run KPI anomaly detection on a list of row dicts (CSV rows).

    Parameters
    ----------
    data:       List of row dicts from the uploaded dataset.
    kpi_config: Optional {kpi_name: {window1, window2, anomaly_percentile}}.
                Defaults to DEFAULT_KPI_CONFIG.
    kpi_names:  Optional list restricting which KPI columns to analyse.
    date_col:   Column containing the week-start date.

    Returns
    -------
    {
        "success": bool,
        "summary": {...},
        "results":   [...],   # all scored rows
        "anomalies": [...],   # rows where is_anomaly == -1
    }
    """
    try:
        cfg = dict(kpi_config) if kpi_config else dict(DEFAULT_KPI_CONFIG)

        if kpi_names:
            cfg = {k: v for k, v in cfg.items() if k in kpi_names}

        if not cfg:
            return {"success": False, "error": "No KPI configuration provided."}

        df = pd.DataFrame(data)
        if df.empty:
            return {"success": False, "error": "Dataset is empty."}

        if date_col in df.columns:
            df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
            df = df.sort_values(date_col).reset_index(drop=True)

        row_count = len(df)

        max_window        = max(max(v["window1"], v["window2"]) for v in cfg.values())
        recommended_weeks = 63 + max_window

        if row_count < recommended_weeks:
            data_quality_flag = "INSUFFICIENT_DATA"
            data_warning_msg  = (
                f"Only {row_count} rows available. "
                f"Recommended minimum is {recommended_weeks} rows "
                f"(63 + max rolling window of {max_window}). "
                "Model results may be unstable."
            )
        else:
            data_quality_flag = "OK"
            data_warning_msg  = "Sufficient data available."

        df["data_quality_flag"] = data_quality_flag
        df["data_warning_msg"]  = data_warning_msg

        for kpi in list(cfg.keys()):
            if kpi in df.columns:
                df[kpi] = pd.to_numeric(df[kpi], errors="coerce")

        per_kpi_results = _run_all_kpi_anomalies(df, cfg)

        if not per_kpi_results:
            return {
                "success": False,
                "error": (
                    "No KPI columns from the configuration were found in the dataset. "
                    f"Expected one of: {list(cfg.keys())}"
                ),
            }

        final_results, anomalies_only = _combine_kpi_results(per_kpi_results)

        kpi_stats: dict = {}
        for kpi, df_r in per_kpi_results.items():
            anomaly_mask = df_r["is_anomaly"] == -1
            kpi_stats[kpi] = {
                "totalRows":         int(len(df_r)),
                "totalAnomalies":    int(anomaly_mask.sum()),
                "anomalyRate":       round(float(anomaly_mask.mean()) * 100, 2),
                "avgScore":          round(float(df_r["anomaly_score"].mean()), 4),
                "window1":           int(cfg[kpi]["window1"]),
                "window2":           int(cfg[kpi]["window2"]),
                "anomalyPercentile": int(cfg[kpi]["anomaly_percentile"]),
            }

        summary = {
            "kpisProcessed":   list(per_kpi_results.keys()),
            "totalRows":       int(len(final_results)),
            "totalAnomalies":  int(len(anomalies_only)),
            "dataQualityFlag": data_quality_flag,
            "dataWarningMsg":  data_warning_msg,
            "kpiStats":        kpi_stats,
        }

        return {
            "success":   True,
            "summary":   summary,
            "results":   final_results.to_dict(orient="records"),
            "anomalies": anomalies_only.to_dict(orient="records"),
        }

    except Exception as exc:
        return {
            "success": False,
            "error":   str(exc),
            "traceback": traceback.format_exc(),
        }
