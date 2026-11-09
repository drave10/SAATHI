"""SQLAlchemy ORM models. See docs/database_design.md for the ER diagram."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base, UTCDateTime, utcnow

ROLES = ("beneficiary", "caseworker", "admin")
CASE_STATUSES = ("open", "monitoring", "follow_up_needed", "closed")
PRIORITY_LEVELS = ("routine", "attention", "urgent")
FOLLOWUP_STATUSES = ("requested", "scheduled", "completed", "cancelled")
ALERT_STATUSES = ("open", "acknowledged", "resolved")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("role in ('beneficiary','caseworker','admin')", name="ck_users_role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120))  # pseudonymous / minimal
    password_hash: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(20), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    token_version: Mapped[int] = mapped_column(Integer, default=0)  # bump to invalidate tokens (logout)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    beneficiary: Mapped["Beneficiary | None"] = relationship(back_populates="user", uselist=False)
    caseworker: Mapped["Caseworker | None"] = relationship(back_populates="user", uselist=False)


class Beneficiary(Base):
    __tablename__ = "beneficiaries"
    __table_args__ = (
        CheckConstraint("case_status in ('open','monitoring','follow_up_needed','closed')", name="ck_ben_status"),
        Index("ix_ben_org_status", "org_unit", "case_status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)  # pseudonymous case code
    org_unit: Mapped[str] = mapped_column(String(80), index=True)
    age_band: Mapped[str | None] = mapped_column(String(16), nullable=True)  # coarse band only
    preferred_language: Mapped[str] = mapped_column(String(32), default="English")
    case_status: Mapped[str] = mapped_column(String(24), default="open")
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    deletion_requested_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    user: Mapped[User] = relationship(back_populates="beneficiary")
    assignments: Mapped[list["CaseAssignment"]] = relationship(back_populates="beneficiary", cascade="all, delete-orphan")
    assessments: Mapped[list["Assessment"]] = relationship(back_populates="beneficiary", cascade="all, delete-orphan")


class Caseworker(Base):
    __tablename__ = "caseworkers"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    org_unit: Mapped[str] = mapped_column(String(80), index=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="caseworker")
    assignments: Mapped[list["CaseAssignment"]] = relationship(back_populates="caseworker")


class CaseAssignment(Base):
    __tablename__ = "case_assignments"
    __table_args__ = (Index("ix_assign_ben_active", "beneficiary_id", "active"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("beneficiaries.id", ondelete="CASCADE"))
    caseworker_id: Mapped[int] = mapped_column(ForeignKey("caseworkers.id", ondelete="CASCADE"), index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    assigned_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    beneficiary: Mapped[Beneficiary] = relationship(back_populates="assignments")
    caseworker: Mapped[Caseworker] = relationship(back_populates="assignments")


class Assessment(Base):
    __tablename__ = "assessments"
    __table_args__ = (
        CheckConstraint("status in ('draft','submitted')", name="ck_assess_status"),
        Index("ix_assess_ben_submitted", "beneficiary_id", "submitted_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("beneficiaries.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(12), default="draft")
    questionnaire_version: Mapped[str] = mapped_column(String(32))
    consent_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)

    beneficiary: Mapped[Beneficiary] = relationship(back_populates="assessments")
    responses: Mapped[list["AssessmentResponse"]] = relationship(back_populates="assessment", cascade="all, delete-orphan")
    score: Mapped["AssessmentScore | None"] = relationship(back_populates="assessment", uselist=False, cascade="all, delete-orphan")


class AssessmentResponse(Base):
    __tablename__ = "assessment_responses"
    __table_args__ = (UniqueConstraint("assessment_id", "question_id", name="uq_response_question"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(String(32))
    value_int: Mapped[int | None] = mapped_column(Integer, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # optional free text; purged by retention

    assessment: Mapped[Assessment] = relationship(back_populates="responses")


class AssessmentScore(Base):
    """Output of the assessment engine. A review-priority recommendation, NOT a diagnosis."""

    __tablename__ = "assessment_scores"
    __table_args__ = (CheckConstraint("priority_level in ('routine','attention','urgent')", name="ck_score_level"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), unique=True)
    priority_level: Mapped[str] = mapped_column(String(12), index=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0-100 concern index
    dimension_scores: Mapped[dict] = mapped_column(JSON, default=dict)
    factors: Mapped[list] = mapped_column(JSON, default=list)
    change_summary: Mapped[dict] = mapped_column(JSON, default=dict)
    data_quality: Mapped[dict] = mapped_column(JSON, default=dict)
    engine_version: Mapped[str] = mapped_column(String(32))
    config_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    ml_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # experimental, advisory only
    review_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|reviewed
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)

    assessment: Mapped[Assessment] = relationship(back_populates="score")


class ReviewAlert(Base):
    """In-app review notification for the assigned caseworker. Never sent to third parties."""

    __tablename__ = "review_alerts"
    __table_args__ = (
        CheckConstraint("level in ('attention','urgent')", name="ck_alert_level"),
        Index("ix_alert_cw_status", "caseworker_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(ForeignKey("assessments.id", ondelete="CASCADE"), index=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("beneficiaries.id", ondelete="CASCADE"), index=True)
    caseworker_id: Mapped[int | None] = mapped_column(ForeignKey("caseworkers.id", ondelete="SET NULL"), nullable=True)
    level: Mapped[str] = mapped_column(String(12))
    reason: Mapped[str] = mapped_column(String(400))
    status: Mapped[str] = mapped_column(String(16), default="open")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    resolved_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class CaseNote(Base):
    __tablename__ = "case_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("beneficiaries.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class FollowUp(Base):
    __tablename__ = "follow_ups"
    __table_args__ = (
        CheckConstraint("status in ('requested','scheduled','completed','cancelled')", name="ck_fu_status"),
        Index("ix_fu_cw_status_date", "caseworker_id", "status", "scheduled_for"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("beneficiaries.id", ondelete="CASCADE"), index=True)
    caseworker_id: Mapped[int | None] = mapped_column(ForeignKey("caseworkers.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="scheduled")
    kind: Mapped[str] = mapped_column(String(32), default="check_in")
    scheduled_for: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    requested_by_beneficiary: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str | None] = mapped_column(String(400), nullable=True)
    outcome_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Intervention(Base):
    __tablename__ = "interventions"
    __table_args__ = (
        CheckConstraint(
            "outcome is null or outcome in ('improved','no_change','worsened','referred','pending')", name="ck_int_outcome"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    beneficiary_id: Mapped[int] = mapped_column(ForeignKey("beneficiaries.id", ondelete="CASCADE"), index=True)
    caseworker_id: Mapped[int | None] = mapped_column(ForeignKey("caseworkers.id", ondelete="SET NULL"), nullable=True)
    type: Mapped[str] = mapped_column(String(40), index=True)
    description: Mapped[str] = mapped_column(Text)
    outcome: Mapped[str | None] = mapped_column(String(16), nullable=True)
    outcome_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Resource(Base):
    __tablename__ = "resources"
    __table_args__ = (
        CheckConstraint("category in ('education','support','emergency')", name="ck_res_category"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(16), index=True)
    summary: Mapped[str] = mapped_column(String(400))
    body: Mapped[str] = mapped_column(Text, default="")
    contact: Mapped[str | None] = mapped_column(String(200), nullable=True)  # e.g. helpline number (admin-verified)
    region: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class ConsentRecord(Base):
    __tablename__ = "consent_records"
    __table_args__ = (
        CheckConstraint("consent_type in ('privacy_notice','assessment_data','analytics_use')", name="ck_consent_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    consent_type: Mapped[str] = mapped_column(String(24))
    granted: Mapped[bool] = mapped_column(Boolean)
    notice_version: Mapped[str] = mapped_column(String(16), default="1.0")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_created", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    actor_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[str | None] = mapped_column(String(400), nullable=True)  # never contains answers or secrets
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Invitation(Base):
    """Authorised onboarding: a one-time code created by staff, required to self-register."""

    __tablename__ = "invitations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 of the code
    org_unit: Mapped[str] = mapped_column(String(80))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    caseworker_id: Mapped[int | None] = mapped_column(ForeignKey("caseworkers.id", ondelete="SET NULL"), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class SystemSetting(Base):
    """Admin-managed configuration (engine thresholds, assessment interval, ...)."""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
