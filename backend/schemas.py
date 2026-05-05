from __future__ import annotations
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


# Base config: accept camelCase input (from React) and snake_case (internal).
# CamelCaseMiddleware in main.py handles converting snake_case *output* to camelCase.
class _Base(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ── Customer ──────────────────────────────────────────────────────────────────

class CustomerBase(_Base):
    account_number: str
    name: str
    region: str
    state: str
    service_type: str = "Copper DSL"
    tenure_months: int
    monthly_revenue: float
    contract_status: str
    value_tier: str
    credit_score: Optional[int] = None
    bundle_type: Optional[str] = None
    provisioned_speed: Optional[float] = None
    actual_speed: Optional[float] = None
    outage_count: int = 0
    ticket_count: int = 0
    avg_resolution_hours: Optional[float] = None
    nps_score: Optional[int] = None
    fiber_available: bool = False
    competitor_available: bool = False
    churn_risk_score: Optional[float] = None
    churn_risk_category: Optional[str] = None
    is_churned: bool = False
    churn_date: Optional[datetime] = None
    churn_reason: Optional[str] = None
    last_bill_amount: Optional[float] = None
    payment_history: Optional[str] = None
    auto_pay_enabled: bool = False
    premises_type: Optional[str] = None
    lifecycle_stage: Optional[str] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerOut(CustomerBase):
    id: int
    created_at: Optional[datetime] = None


# ── ChurnEvent ────────────────────────────────────────────────────────────────

class ChurnEventCreate(_Base):
    customer_id: int
    churn_date: datetime
    churn_type: str
    reason: Optional[str] = None
    destination: Optional[str] = None
    revenue_impact: Optional[float] = None
    win_back_attempted: bool = False
    win_back_successful: bool = False


class ChurnEventOut(ChurnEventCreate):
    id: int


# ── Dataset ───────────────────────────────────────────────────────────────────

class DatasetOut(_Base):
    id: int
    name: str
    file_name: str
    row_count: int
    column_count: int
    columns: Any
    uploaded_at: Optional[datetime] = None
    status: str
    quality_report: Optional[Any] = None
    eda_report: Optional[Any] = None
    feature_report: Optional[Any] = None
    data_preview: Optional[Any] = None


# ── MlModel ───────────────────────────────────────────────────────────────────

class MlModelOut(_Base):
    id: int
    name: str
    dataset_id: int
    algorithm: str
    status: str
    accuracy: Optional[float] = None
    precision: Optional[float] = None
    recall: Optional[float] = None
    f1_score: Optional[float] = None
    auc: Optional[float] = None
    hyperparameters: Optional[Any] = None
    feature_importance: Optional[Any] = None
    confusion_matrix: Optional[Any] = None
    model_weights: Optional[Any] = None
    trained_at: Optional[datetime] = None
    is_deployed: bool = False
    deployed_at: Optional[datetime] = None
    approval_status: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_notes: Optional[str] = None


# ── Prediction ────────────────────────────────────────────────────────────────

class PredictionOut(_Base):
    id: int
    model_id: int
    customer_id: int
    churn_probability: float
    risk_category: str
    top_drivers: Optional[Any] = None
    recommended_action: Optional[str] = None
    action_category: Optional[str] = None
    predicted_at: Optional[datetime] = None
    account_number: Optional[str] = None


# ── Recommendation ────────────────────────────────────────────────────────────

class RecommendationUpdate(_Base):
    status: Optional[str] = None
    outcome: Optional[str] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    executed_at: Optional[datetime] = None


class RecommendationOut(_Base):
    id: int
    customer_id: int
    prediction_id: Optional[int] = None
    action_type: str
    priority: str
    status: str
    outcome: Optional[str] = None
    estimated_impact: Optional[float] = None
    estimated_cost: Optional[float] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    executed_at: Optional[datetime] = None


# ── AuditLog ──────────────────────────────────────────────────────────────────

class AuditLogCreate(_Base):
    action: str
    entity_type: str
    entity_id: Optional[int] = None
    entity_name: Optional[str] = None
    detail: Optional[str] = None
    user: Optional[str] = None
    team: Optional[str] = None
    status: str = "success"


class AuditLogOut(AuditLogCreate):
    id: int
    created_at: Optional[datetime] = None


# ── Train requests ────────────────────────────────────────────────────────────

class TrainRequest(_Base):
    dataset_id: int
    algorithm: str
    name: Optional[str] = None
    hyperparameters: Optional[dict] = None


class TrainLiveRequest(_Base):
    algorithm: str
    name: Optional[str] = None
    hyperparameters: Optional[dict] = None


class ApproveRequest(_Base):
    approved_by: str
    notes: Optional[str] = None


# ── Custom feature ────────────────────────────────────────────────────────────

class CustomFeatureDefinition(_Base):
    id: str
    name: str
    type: str
    formula: Optional[str] = None
    status: Optional[str] = None
    entity_key: Optional[str] = None
    time_column: Optional[str] = None
    sort_direction: Optional[str] = None
    source_column: Optional[str] = None
    periods: Optional[int] = None
    window: Optional[int] = None
    aggregation: Optional[str] = None
    numerator_column: Optional[str] = None
    denominator_column: Optional[str] = None
    comparator: Optional[str] = None
    compare_value: Optional[Any] = None
    left_column: Optional[str] = None
    right_column: Optional[str] = None
    interaction_operator: Optional[str] = None


class ModelEvaluationRunOut(_Base):
    id: int
    model_id: int
    dataset_id: Optional[int] = None
    evaluation_month: Optional[str] = None
    evaluated_at: Optional[datetime] = None
    auc: Optional[float] = None
    accuracy: Optional[float] = None
    recall: Optional[float] = None
    precision: Optional[float] = None
    f1_score: Optional[float] = None
    ks: Optional[float] = None
    positive_count: Optional[int] = None
    negative_count: Optional[int] = None
    row_count: Optional[int] = None
    psi: Optional[float] = None
    high_risk_pct: Optional[float] = None
    med_risk_pct: Optional[float] = None
    low_risk_pct: Optional[float] = None
    score_histogram: Optional[Any] = None
    top_feature_shap_summary: Optional[Any] = None
    has_labels: Optional[bool] = None
