from datetime import datetime
from sqlalchemy import (
    Boolean, Column, Float, Integer, String, Text, DateTime, JSON, UniqueConstraint
)
from sqlalchemy.sql import func
from database import Base


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    account_number = Column(String(50), nullable=False, unique=True)
    name = Column(Text, nullable=False)
    region = Column(String(100), nullable=False)
    state = Column(String(50), nullable=False)
    service_type = Column(String(50), nullable=False, default="Copper DSL")
    tenure_months = Column(Integer, nullable=False)
    monthly_revenue = Column(Float, nullable=False)
    contract_status = Column(String(50), nullable=False)
    value_tier = Column(String(30), nullable=False)
    credit_score = Column(Integer)
    bundle_type = Column(String(100))
    provisioned_speed = Column(Float)
    actual_speed = Column(Float)
    outage_count = Column(Integer, default=0)
    ticket_count = Column(Integer, default=0)
    avg_resolution_hours = Column(Float)
    nps_score = Column(Integer)
    fiber_available = Column(Boolean, default=False)
    competitor_available = Column(Boolean, default=False)
    churn_risk_score = Column(Float)
    churn_risk_category = Column(String(20))
    is_churned = Column(Boolean, default=False)
    churn_date = Column(DateTime)
    churn_reason = Column(String(100))
    last_bill_amount = Column(Float)
    payment_history = Column(String(30))
    auto_pay_enabled = Column(Boolean, default=False)
    premises_type = Column(String(50))
    lifecycle_stage = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())


class ChurnEvent(Base):
    __tablename__ = "churn_events"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, nullable=False)
    churn_date = Column(DateTime, nullable=False)
    churn_type = Column(String(50), nullable=False)
    reason = Column(String(200))
    destination = Column(String(100))
    revenue_impact = Column(Float)
    win_back_attempted = Column(Boolean, default=False)
    win_back_successful = Column(Boolean, default=False)


class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    file_name = Column(Text, nullable=False)
    row_count = Column(Integer, nullable=False)
    column_count = Column(Integer, nullable=False)
    columns = Column(JSON, nullable=False)
    uploaded_at = Column(DateTime, server_default=func.now())
    status = Column(String(30), nullable=False, default="uploaded")
    quality_report = Column(JSON)
    eda_report = Column(JSON)
    feature_report = Column(JSON)
    data_preview = Column(JSON)


class MlModel(Base):
    __tablename__ = "ml_models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(Text, nullable=False)
    dataset_id = Column(Integer, nullable=False)
    algorithm = Column(String(100), nullable=False)
    status = Column(String(30), nullable=False, default="training")
    accuracy = Column(Float)
    precision = Column(Float)
    recall = Column(Float)
    f1_score = Column(Float)
    auc = Column(Float)
    hyperparameters = Column(JSON)
    feature_importance = Column(JSON)
    confusion_matrix = Column(JSON)
    model_weights = Column(JSON)
    trained_at = Column(DateTime, server_default=func.now())
    use_case = Column(String(100), nullable=True)
    is_deployed = Column(Boolean, default=False)
    deployed_at = Column(DateTime)
    approval_status = Column(String(30), default="pending")
    approved_by = Column(Text)
    approved_at = Column(DateTime)
    approval_notes = Column(Text)
    # Regression / baseline-specific metrics
    wmape = Column(Float)
    mae = Column(Float)
    rmse = Column(Float)
    r2 = Column(Float)
    promo_effect_units = Column(Float)
    baseline_units = Column(Float)
    residual_units = Column(Float)
    row_count = Column(Integer)


class Prediction(Base):
    __tablename__ = "predictions"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, nullable=False)
    customer_id = Column(Integer, nullable=False)
    churn_probability = Column(Float, nullable=False)
    risk_category = Column(String(20), nullable=False)
    top_drivers = Column(JSON)
    recommended_action = Column(Text)
    action_category = Column(String(50))
    predicted_at = Column(DateTime, server_default=func.now())


class Recommendation(Base):
    __tablename__ = "recommendations"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, nullable=False)
    prediction_id = Column(Integer)
    action_type = Column(String(50), nullable=False)
    priority = Column(String(20), nullable=False, default="medium")
    status = Column(String(30), nullable=False, default="pending")
    outcome = Column(String(30))
    estimated_impact = Column(Float)
    estimated_cost = Column(Float)
    assigned_to = Column(String(100))
    notes = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    executed_at = Column(DateTime)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    action = Column(String(50), nullable=False)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(Integer)
    entity_name = Column(Text)
    detail = Column(Text)
    user = Column(Text)
    team = Column(Text)
    status = Column(String(30), default="success")
    created_at = Column(DateTime, server_default=func.now())


class ModelEvaluationRun(Base):
    __tablename__ = "model_evaluation_runs"

    id = Column(Integer, primary_key=True, index=True)
    model_id = Column(Integer, nullable=False)
    dataset_id = Column(Integer)
    evaluation_month = Column(String(7))
    evaluated_at = Column(DateTime, server_default=func.now())
    auc = Column(Float)
    accuracy = Column(Float)
    recall = Column(Float)
    precision = Column(Float)
    f1_score = Column(Float)
    ks = Column(Float)
    positive_count = Column(Integer)
    negative_count = Column(Integer)
    row_count = Column(Integer)
    psi = Column(Float)
    high_risk_pct = Column(Float)
    med_risk_pct = Column(Float)
    low_risk_pct = Column(Float)
    score_histogram = Column(JSON)
    top_feature_shap_summary = Column(JSON)
    has_labels = Column(Boolean)

    __table_args__ = (
        UniqueConstraint("model_id", "evaluation_month", name="uq_model_eval_month"),
    )
