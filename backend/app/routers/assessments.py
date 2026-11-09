from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import deps
from ..database import get_db, utcnow
from ..deps import get_current_user, require_roles
from ..engine import questionnaire as Q
from ..engine.scoring import LEVEL_LABEL, summary_text, wellbeing_index
from ..models import Assessment, AssessmentResponse, Resource, User
from ..schemas import AssessmentCreateIn, ResponsesIn
from ..services.assessment_service import answers_of, finalize_assessment
from ..services.audit import audit
from ..services.settings_service import get_engine_config

router = APIRouter(prefix="/assessments", tags=["assessments"])


def _is_staff(u: User) -> bool:
    return u.role == "caseworker"


def _summary(a: Assessment, user: User) -> dict:
    """Role-aware summary. Beneficiaries see a well-being index (higher = better), never the review level."""
    s = a.score
    base = {"id": a.id, "beneficiary_id": a.beneficiary_id, "status": a.status, "started_at": a.started_at,
            "submitted_at": a.submitted_at, "questionnaire_version": a.questionnaire_version, "is_synthetic": a.is_synthetic}
    if s is None:
        return base
    if user.role == "beneficiary":
        base["wellbeing_index"] = wellbeing_index(s.overall_score)
        base["dimension_wellbeing"] = {d: wellbeing_index(v) for d, v in (s.dimension_scores or {}).items()}
    else:
        base.update({"priority_level": s.priority_level, "overall_score": s.overall_score,
                     "dimension_scores": s.dimension_scores, "review_status": s.review_status})
    return base


def _load(db: Session, user: User, assessment_id: int) -> Assessment:
    a = db.get(Assessment, assessment_id)
    if a is None:
        raise HTTPException(404, "Assessment not found")
    deps.authorize_beneficiary_access(db, user, a.beneficiary_id)  # admins get 403 here (no clinical access)
    return a


@router.get("/questionnaire")
def questionnaire(_: User = Depends(get_current_user)):
    return Q.public_questionnaire()


@router.post("", status_code=201)
def create_assessment(body: AssessmentCreateIn, user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    if not body.consent_confirmed:
        raise HTTPException(422, "Consent must be confirmed before starting an assessment")
    ben = deps.own_beneficiary(db, user)
    existing = db.scalar(select(Assessment).where(Assessment.beneficiary_id == ben.id, Assessment.status == "draft"))
    if existing:  # save & resume: reuse the open draft
        return {"id": existing.id, "status": "draft", "resumed": True}
    a = Assessment(beneficiary_id=ben.id, questionnaire_version=Q.QUESTIONNAIRE_VERSION, consent_confirmed=True, is_synthetic=ben.is_synthetic)
    db.add(a)
    audit(db, user, "assessment_started", "beneficiary", ben.id)
    db.commit()
    return {"id": a.id, "status": "draft", "resumed": False}


@router.get("/draft")
def current_draft(user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    ben = deps.own_beneficiary(db, user)
    a = db.scalar(select(Assessment).where(Assessment.beneficiary_id == ben.id, Assessment.status == "draft"))
    if not a:
        return {"draft": None}
    return {"draft": {"id": a.id, "started_at": a.started_at, "updated_at": a.updated_at, "answers": {r.question_id: (r.value_int if r.value_int is not None else r.value_text) for r in a.responses}}}


@router.put("/{assessment_id}/responses")
def save_responses(assessment_id: int, body: ResponsesIn, user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    a = _load(db, user, assessment_id)
    if a.status != "draft":
        raise HTTPException(409, "Assessment already submitted")
    errors = {}
    for qid, val in body.answers.items():
        q = Q.QUESTION_INDEX.get(qid)
        if q is None:
            errors[qid] = "Unknown question"
        elif q["type"] == "text":
            if val is not None and not isinstance(val, str):
                errors[qid] = "Text expected"
        else:
            err = Q.validate_answer(qid, val) if val is not None else None
            if err:
                errors[qid] = err
    if errors:
        raise HTTPException(422, {"message": "Invalid answers", "errors": errors})
    existing = {r.question_id: r for r in a.responses}
    for qid, val in body.answers.items():
        r = existing.get(qid)
        if val is None or val == "":
            if r:
                db.delete(r)
            continue
        if r is None:
            r = AssessmentResponse(assessment_id=a.id, question_id=qid)
            db.add(r)
        if Q.QUESTION_INDEX[qid]["type"] == "text":
            r.value_text, r.value_int = str(val).strip()[:2000], None
        else:
            r.value_int, r.value_text = int(val), None
    a.updated_at = utcnow()
    db.commit()
    return {"id": a.id, "saved": True}


@router.post("/{assessment_id}/submit")
def submit(assessment_id: int, user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    a = _load(db, user, assessment_id)
    if a.status != "draft":
        raise HTTPException(409, "Assessment already submitted")
    db.refresh(a)
    answers = answers_of(a)
    missing = [qid for qid in Q.REQUIRED_IDS if qid not in answers]
    if missing:
        raise HTTPException(422, {"message": "Please answer all required questions", "missing": missing})
    a.status, a.submitted_at = "submitted", utcnow()
    db.flush()
    cfg = get_engine_config(db)
    score = finalize_assessment(db, a, cfg)
    audit(db, user, "assessment_submitted", "assessment", a.id)
    db.commit()
    # The beneficiary-facing response never shows a "risk" label. If urgent items were triggered we surface
    # verified support resources prominently; this is a pointer to humans, not a crisis-response mechanism.
    show_support = score.priority_level == "urgent" or any(f["code"].startswith("critical_") for f in score.factors)
    resources = []
    if show_support:
        resources = [{"id": r.id, "title": r.title, "summary": r.summary, "contact": r.contact, "is_verified": r.is_verified}
                     for r in db.scalars(select(Resource).where(Resource.category == "emergency", Resource.is_active.is_(True)))]
    return {
        "id": a.id, "status": a.status, "submitted_at": a.submitted_at,
        "wellbeing_index": wellbeing_index(score.overall_score),
        "show_support_now": show_support,
        "support_resources": resources,
        "message": ("Thank you for completing your check-in. Your support worker will be in touch about next steps."
                    if show_support else "Thank you for completing your check-in."),
    }


@router.get("")
def history(beneficiary_id: int | None = Query(None), status: str | None = Query("submitted"),
            user: User = Depends(require_roles("beneficiary", "caseworker")), db: Session = Depends(get_db)):
    if user.role == "beneficiary":
        ben = deps.own_beneficiary(db, user)
    else:
        if beneficiary_id is None:
            raise HTTPException(422, "beneficiary_id is required")
        ben = deps.authorize_beneficiary_access(db, user, beneficiary_id)
        audit(db, user, "assessment_history_viewed", "beneficiary", ben.id)
        db.commit()
    q = select(Assessment).where(Assessment.beneficiary_id == ben.id)
    if status:
        q = q.where(Assessment.status == status)
    rows = db.scalars(q.order_by(Assessment.started_at.asc())).all()
    return [_summary(a, user) for a in rows]


@router.get("/{assessment_id}")
def detail(assessment_id: int, user: User = Depends(require_roles("beneficiary", "caseworker")), db: Session = Depends(get_db)):
    a = _load(db, user, assessment_id)
    out = _summary(a, user)
    qmap = Q.QUESTION_INDEX
    out["responses"] = [
        {"question_id": r.question_id, "text": qmap[r.question_id]["text"] if r.question_id in qmap else r.question_id,
         "value": r.value_int, "answer": (qmap[r.question_id]["options"][r.value_int]["label"] if r.value_int is not None and r.question_id in qmap else None),
         "free_text": r.value_text}
        for r in sorted(a.responses, key=lambda r: [q["id"] for q in Q.QUESTIONS].index(r.question_id) if r.question_id in qmap else 99)
    ]
    if user.role == "caseworker":
        audit(db, user, "assessment_viewed", "assessment", a.id)
        db.commit()
    return out


@router.get("/{assessment_id}/explanation")
def explanation(assessment_id: int, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    a = _load(db, user, assessment_id)
    s = a.score
    if s is None:
        raise HTTPException(404, "This assessment has not been scored")
    return {
        "assessment_id": a.id, "priority_level": s.priority_level, "priority_label": LEVEL_LABEL[s.priority_level],
        "overall_score": s.overall_score, "dimension_scores": s.dimension_scores, "factors": s.factors,
        "change_summary": s.change_summary, "data_quality": s.data_quality, "engine_version": s.engine_version,
        "ml_advisory": s.ml_result, "review_status": s.review_status,
        "statement": summary_text_from_row(s),
        "disclaimer": "Review-priority recommendations support human decisions. They are not diagnoses or predictions of harm.",
    }


def summary_text_from_row(s) -> str:
    top = [f["label"] for f in s.factors if f["severity"] in ("urgent", "attention")][:3]
    t = f"Review priority: {LEVEL_LABEL[s.priority_level]}."
    if top:
        t += " Contributing factors: " + "; ".join(top) + "."
    return t


@router.get("/{assessment_id}/compare")
def compare(assessment_id: int, with_id: int | None = Query(None), user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    """Compare an assessment with a chosen one, or with the immediately preceding submitted assessment."""
    a = _load(db, user, assessment_id)
    if a.status != "submitted" or a.score is None:
        raise HTTPException(409, "Only scored assessments can be compared")
    if with_id:
        b = _load(db, user, with_id)
        if b.beneficiary_id != a.beneficiary_id:
            raise HTTPException(422, "Assessments belong to different beneficiaries and cannot be compared")
    else:
        b = db.scalar(select(Assessment).where(Assessment.beneficiary_id == a.beneficiary_id, Assessment.status == "submitted",
                                               Assessment.submitted_at < a.submitted_at).order_by(Assessment.submitted_at.desc()))
    if b is None or b.score is None or b.beneficiary_id != a.beneficiary_id:
        return {"current": _summary(a, user), "previous": None, "deltas": {}, "overall_delta": None}
    ds = {}
    for d, v in (a.score.dimension_scores or {}).items():
        pv = (b.score.dimension_scores or {}).get(d)
        ds[d] = None if v is None or pv is None else round(v - pv, 1)
    od = None if a.score.overall_score is None or b.score.overall_score is None else round(a.score.overall_score - b.score.overall_score, 1)
    return {"current": _summary(a, user), "previous": _summary(b, user), "deltas": ds, "overall_delta": od}


@router.post("/{assessment_id}/recalculate")
def recalculate(assessment_id: int, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    """Re-run the engine with the *current* configuration (does not create duplicate alerts)."""
    a = _load(db, user, assessment_id)
    if a.status != "submitted":
        raise HTTPException(409, "Only submitted assessments can be recalculated")
    s = finalize_assessment(db, a, get_engine_config(db))
    audit(db, user, "assessment_recalculated", "assessment", a.id)
    db.commit()
    return {"assessment_id": a.id, "priority_level": s.priority_level, "overall_score": s.overall_score}


@router.post("/{assessment_id}/mark-reviewed")
def mark_reviewed(assessment_id: int, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    a = _load(db, user, assessment_id)
    if a.score is None:
        raise HTTPException(409, "Assessment has not been scored")
    a.score.review_status, a.score.reviewed_by, a.score.reviewed_at = "reviewed", user.id, utcnow()
    audit(db, user, "assessment_reviewed", "assessment", a.id)
    db.commit()
    return {"assessment_id": a.id, "review_status": "reviewed"}
