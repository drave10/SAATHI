"""Glue between the database and the pure assessment engine."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import utcnow
from ..engine import EngineConfig, PriorResult, evaluate
from ..engine import ml
from ..engine.config import ENGINE_VERSION
from ..engine.scoring import LEVEL_LABEL
from ..models import Assessment, AssessmentScore, FollowUp, ReviewAlert
from .. import deps


def answers_of(a: Assessment) -> dict:
    return {r.question_id: r.value_int for r in a.responses if r.value_int is not None}


def history_before(db: Session, beneficiary_id: int, before, exclude_id: int | None = None) -> list[PriorResult]:
    q = (
        select(Assessment)
        .where(Assessment.beneficiary_id == beneficiary_id, Assessment.status == "submitted", Assessment.submitted_at < before)
        .order_by(Assessment.submitted_at.asc())
    )
    out = []
    for a in db.scalars(q):
        if exclude_id and a.id == exclude_id:
            continue
        if a.score:
            out.append(PriorResult(a.score.overall_score, a.score.dimension_scores or {}, a.score.priority_level))
    return out


def run_engine(db: Session, a: Assessment, cfg: EngineConfig) -> dict:
    hist = history_before(db, a.beneficiary_id, a.submitted_at or utcnow(), a.id)
    answers = answers_of(a)
    res = evaluate(answers, hist, cfg)
    advisory = None
    if cfg.use_ml_advisory:
        advisory = ml.advisory(answers, res.dimension_scores, res.overall_score, res.change_summary.get("overall_delta"))
    return {"result": res, "advisory": advisory}


def _alert_reason(res) -> str:
    labels = [f["label"] for f in res.factors if f["severity"] in ("urgent", "attention")][:3]
    return (f"{LEVEL_LABEL[res.level]}: " + "; ".join(labels))[:400]


def finalize_assessment(db: Session, a: Assessment, cfg: EngineConfig, *, create_side_effects: bool = True) -> AssessmentScore:
    """Score a submitted assessment, store the explanation, and (optionally) create review notifications."""
    out = run_engine(db, a, cfg)
    res, adv = out["result"], out["advisory"]
    score = a.score or AssessmentScore(assessment_id=a.id)
    score.priority_level = res.level
    score.overall_score = res.overall_score
    score.dimension_scores = res.dimension_scores
    score.factors = res.factors
    score.change_summary = res.change_summary
    score.data_quality = res.data_quality
    score.engine_version = ENGINE_VERSION
    score.config_snapshot = cfg.to_dict()
    score.ml_result = adv
    if a.score is None:
        db.add(score)
        a.score = score
    if create_side_effects:
        assignment = deps.active_assignment(db, a.beneficiary_id)
        cw_id = assignment.caseworker_id if assignment else None
        if res.level in ("attention", "urgent"):
            exists = db.scalar(select(ReviewAlert).where(ReviewAlert.assessment_id == a.id, ReviewAlert.level == res.level))
            if not exists:
                db.add(ReviewAlert(assessment_id=a.id, beneficiary_id=a.beneficiary_id, caseworker_id=cw_id,
                                   level=res.level, reason=_alert_reason(res)))
        # A request to speak to someone becomes a follow-up request (never an automatic external message).
        if any(f["code"] in ("help_requested", "help_requested_asap") for f in res.factors):
            open_req = db.scalar(select(FollowUp).where(
                FollowUp.beneficiary_id == a.beneficiary_id, FollowUp.status == "requested"))
            if not open_req:
                db.add(FollowUp(beneficiary_id=a.beneficiary_id, caseworker_id=cw_id, status="requested",
                                kind="requested_contact", requested_by_beneficiary=True,
                                reason="Requested via well-being check-in", is_synthetic=a.is_synthetic))
    return score
