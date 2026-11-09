"""Case-level read models used by the caseworker dashboard and case profile."""
from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import utcnow
from ..engine.config import EngineConfig
from ..models import Assessment, Beneficiary, Caseworker, FollowUp, ReviewAlert, CaseAssignment


def latest_scored(db: Session, ben_id: int, n: int = 1) -> list[Assessment]:
    return list(db.scalars(
        select(Assessment).where(Assessment.beneficiary_id == ben_id, Assessment.status == "submitted")
        .order_by(Assessment.submitted_at.desc()).limit(n)))


def case_row(db: Session, ben: Beneficiary, cfg: EngineConfig, *, include_clinical: bool = True) -> dict:
    now = utcnow()
    assign = db.scalar(select(CaseAssignment).where(CaseAssignment.beneficiary_id == ben.id, CaseAssignment.active.is_(True)))
    cw = db.get(Caseworker, assign.caseworker_id) if assign else None
    row = {
        "id": ben.id, "code": ben.code, "display_name": ben.user.display_name, "org_unit": ben.org_unit,
        "case_status": ben.case_status, "is_synthetic": ben.is_synthetic,
        "caseworker_id": cw.id if cw else None, "caseworker_name": cw.user.display_name if cw else None,
        "deletion_requested": ben.deletion_requested_at is not None,
    }
    if not include_clinical:
        return row
    last2 = latest_scored(db, ben.id, 2)
    last = last2[0] if last2 else None
    s = last.score if last else None
    delta = None
    if len(last2) == 2 and s and last2[1].score and s.overall_score is not None and last2[1].score.overall_score is not None:
        delta = round(s.overall_score - last2[1].score.overall_score, 1)
    open_alerts = db.scalar(select(func.count()).select_from(ReviewAlert).where(
        ReviewAlert.beneficiary_id == ben.id, ReviewAlert.status == "open")) or 0
    fus = list(db.scalars(select(FollowUp).where(FollowUp.beneficiary_id == ben.id, FollowUp.status.in_(["scheduled", "requested"]))
                          .order_by(FollowUp.scheduled_for.asc())))
    next_fu = next((f for f in fus if f.status == "scheduled" and f.scheduled_for and f.scheduled_for >= now), None)
    overdue = sum(1 for f in fus if f.status == "scheduled" and f.scheduled_for and f.scheduled_for < now)
    due_by = (last.submitted_at + timedelta(days=cfg.assessment_interval_days)) if last else None
    row.update({
        "latest": None if not last else {
            "assessment_id": last.id, "submitted_at": last.submitted_at, "priority_level": s.priority_level if s else None,
            "overall_score": s.overall_score if s else None, "review_status": s.review_status if s else None, "delta": delta,
        },
        "needs_review": bool(s and s.priority_level in ("attention", "urgent") and s.review_status == "pending"),
        "open_alerts": open_alerts,
        "requested_followups": sum(1 for f in fus if f.status == "requested"),
        "next_followup": next_fu.scheduled_for if next_fu else None,
        "overdue_followups": overdue,
        "assessment_due": last is None or (due_by is not None and due_by < now),
    })
    return row
