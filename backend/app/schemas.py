"""Pydantic request/response schemas."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Role = Literal["beneficiary", "caseworker", "admin"]
CaseStatus = Literal["open", "monitoring", "follow_up_needed", "closed"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth ---------------------------------------------------------------------------------------------
class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class DemoLoginIn(BaseModel):
    role: Literal["beneficiary", "caseworker", "admin"]


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: "UserOut"


class RegisterIn(BaseModel):
    invite_code: str = Field(min_length=6, max_length=64)
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=72)
    display_name: str = Field(min_length=1, max_length=120)
    consent_privacy: bool
    consent_assessment: bool
    consent_analytics: bool = False
    preferred_language: str = Field(default="English", max_length=32)


class PasswordChangeIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=72)


class UserOut(ORM):
    id: int
    username: str
    display_name: str
    role: Role
    is_active: bool
    is_synthetic: bool
    created_at: datetime
    last_login_at: datetime | None = None


class UserCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=72)
    role: Role
    org_unit: str | None = Field(default=None, max_length=80)


class UserUpdateIn(BaseModel):
    display_name: str | None = Field(default=None, max_length=120)
    role: Role | None = None
    is_active: bool | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=72)


# ---- beneficiaries ------------------------------------------------------------------------------------
class BeneficiaryCreateIn(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=72)
    org_unit: str = Field(min_length=1, max_length=80)
    age_band: Literal["18-24", "25-34", "35-44", "45-59", "60+"] | None = None
    preferred_language: str = Field(default="English", max_length=32)
    caseworker_id: int | None = None


class BeneficiaryUpdateIn(BaseModel):
    preferred_language: str | None = Field(default=None, max_length=32)
    display_name: str | None = Field(default=None, max_length=120)
    org_unit: str | None = Field(default=None, max_length=80)
    age_band: Literal["18-24", "25-34", "35-44", "45-59", "60+"] | None = None


class BeneficiaryOut(ORM):
    id: int
    code: str
    org_unit: str
    age_band: str | None
    preferred_language: str
    case_status: CaseStatus
    is_synthetic: bool
    created_at: datetime


class AssignIn(BaseModel):
    caseworker_id: int


class StatusIn(BaseModel):
    case_status: CaseStatus


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class NoteOut(ORM):
    id: int
    body: str
    author_id: int | None
    created_at: datetime
    is_synthetic: bool


# ---- assessments ---------------------------------------------------------------------------------------
class AssessmentCreateIn(BaseModel):
    consent_confirmed: bool


class ResponsesIn(BaseModel):
    answers: dict[str, int | str | None]

    @field_validator("answers")
    @classmethod
    def _limit(cls, v):
        if len(v) > 40:
            raise ValueError("Too many answers")
        for k, val in v.items():
            if isinstance(val, str) and len(val) > 2000:
                raise ValueError(f"Text answer for {k} is too long")
        return v


# ---- follow-ups / interventions -----------------------------------------------------------------------
class FollowUpCreateIn(BaseModel):
    beneficiary_id: int | None = None  # staff must supply; beneficiary uses own
    scheduled_for: datetime | None = None
    kind: str = Field(default="check_in", max_length=32)
    reason: str | None = Field(default=None, max_length=400)


class FollowUpUpdateIn(BaseModel):
    scheduled_for: datetime | None = None
    status: Literal["requested", "scheduled", "completed", "cancelled"] | None = None
    kind: str | None = Field(default=None, max_length=32)
    reason: str | None = Field(default=None, max_length=400)
    outcome_notes: str | None = Field(default=None, max_length=4000)


class FollowUpOut(ORM):
    id: int
    beneficiary_id: int
    caseworker_id: int | None
    status: str
    kind: str
    scheduled_for: datetime | None
    requested_by_beneficiary: bool
    reason: str | None
    outcome_notes: str | None
    completed_at: datetime | None
    created_at: datetime
    is_synthetic: bool


class CompleteIn(BaseModel):
    outcome_notes: str | None = Field(default=None, max_length=4000)


OutcomeT = Literal["improved", "no_change", "worsened", "referred", "pending"]


class InterventionIn(BaseModel):
    beneficiary_id: int
    type: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=4000)
    occurred_at: datetime | None = None
    outcome: OutcomeT | None = None
    outcome_notes: str | None = Field(default=None, max_length=4000)


class InterventionOutcomeIn(BaseModel):
    outcome: OutcomeT
    outcome_notes: str | None = Field(default=None, max_length=4000)


class InterventionOut(ORM):
    id: int
    beneficiary_id: int
    caseworker_id: int | None
    type: str
    description: str
    outcome: str | None
    outcome_notes: str | None
    occurred_at: datetime
    created_at: datetime
    is_synthetic: bool


class AlertOut(ORM):
    id: int
    assessment_id: int
    beneficiary_id: int
    caseworker_id: int | None
    level: str
    reason: str
    status: str
    created_at: datetime
    resolved_at: datetime | None


class AlertUpdateIn(BaseModel):
    status: Literal["acknowledged", "resolved"]


# ---- resources / consent / admin ----------------------------------------------------------------------
class ResourceIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    category: Literal["education", "support", "emergency"]
    summary: str = Field(min_length=1, max_length=400)
    body: str = Field(default="", max_length=8000)
    contact: str | None = Field(default=None, max_length=200)
    region: str | None = Field(default=None, max_length=80)
    is_verified: bool = False
    is_active: bool = True


class ResourceOut(ORM):
    id: int
    title: str
    category: str
    summary: str
    body: str
    contact: str | None
    region: str | None
    is_verified: bool
    is_active: bool
    updated_at: datetime


class ConsentIn(BaseModel):
    consent_type: Literal["privacy_notice", "assessment_data", "analytics_use"]
    granted: bool


class ConsentOut(ORM):
    id: int
    consent_type: str
    granted: bool
    notice_version: str
    created_at: datetime


class AuditOut(ORM):
    id: int
    actor_user_id: int | None
    actor_role: str | None
    action: str
    entity_type: str | None
    entity_id: int | None
    detail: str | None
    created_at: datetime


class InvitationIn(BaseModel):
    org_unit: str = Field(min_length=1, max_length=80)
    caseworker_id: int | None = None
    valid_days: int = Field(default=7, ge=1, le=60)


class Page(BaseModel):
    items: list
    total: int
    page: int
    page_size: int


TokenOut.model_rebuild()
