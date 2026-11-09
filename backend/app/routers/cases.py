"""Caseworker case management: list, profile, status, notes, assignment."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import deps
from ..database import get_db, utcnow
from ..deps import require_roles
from ..models import (Assessment, Beneficiary, CaseAssignment, CaseNote, Caseworker, FollowUp, Intervention, ReviewAlert, User)
from ..schemas import AssignIn, FollowUpOut, InterventionOut, NoteIn, NoteOut, StatusIn, AlertOut
from ..services.audit import audit
from ..services.cases import case_row
from ..services.settings_service import get_engine_config

router = APIRouter(prefix="/cases", tags=["cases"])
LEVEL_RANK = {"urgent": 0, "attention": 1, "routine": 2, None: 3}


@router.get("")
def list_cases(
    q: str | None = None, status: str | None = None, priority: str | None = None, needs_review: bool | None = None,
    org_unit: str | None = None, assessment_due: bool | None = None,
    sort: str = Query("priority", pattern="^(priority|name|last_assessment|status)$"), order: str = Query("asc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100),
    user: User = Depends(require_roles("caseworker", "admin")), db: Session = Depends(get_db),
):
    """Caseworkers: assigned cases with review info. Admins: case roster WITHOUT clinical fields."""
    cfg = get_engine_config(db)
    stmt = select(Beneficiary)
    if user.role == "caseworker":
        cw = deps.current_caseworker(user, db)
        stmt = stmt.join(CaseAssignment, CaseAssignment.beneficiary_id == Beneficiary.id).where(
            CaseAssignment.active.is_(True), CaseAssignment.caseworker_id == (cw.id if cw else -1))
    if status:
        stmt = stmt.where(Beneficiary.case_status == status)
    if org_unit:
        stmt = stmt.where(Beneficiary.org_unit == org_unit)
    clinical = user.role == "caseworker"
    rows = [case_row(db, b, cfg, include_clinical=clinical) for b in db.scalars(stmt)]
    if q:
        ql = q.lower()
        rows = [r for r in rows if ql in r["code"].lower() or ql in r["display_name"].lower()]
    if clinical:
        if priority:
            rows = [r for r in rows if (r["latest"] or {}).get("priority_level") == priority]
        if needs_review is not None:
            rows = [r for r in rows if r["needs_review"] == needs_review]
        if assessment_due is not None:
            rows = [r for r in rows if r["assessment_due"] == assessment_due]
    keyf = {
        "priority": lambda r: (LEVEL_RANK[(r.get("latest") or {}).get("priority_level")], -(((r.get("latest") or {}).get("overall_score")) or 0)),
        "name": lambda r: r["display_name"].lower(),
        "last_assessment": lambda r: ((r.get("latest") or {}).get("submitted_at") or utcnow().replace(year=1970)),
        "status": lambda r: r["case_status"],
    }[sort]
    rows.sort(key=keyf, reverse=(order == "desc"))
    total = len(rows)
    start = (page - 1) * page_size
    audit(db, user, "case_list_viewed", detail=f"returned {len(rows[start:start + page_size])} of {total}")
    db.commit()
    return {"items": rows[start:start + page_size], "total": total, "page": page, "page_size": page_size}


@router.get("/{beneficiary_id}")
def case_profile(beneficiary_id: int, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    """Single-screen case profile: everything a caseworker needs, in one request."""
    b = deps.authorize_beneficiary_access(db, user, beneficiary_id)
    cfg = get_engine_config(db)
    assessments = db.scalars(select(Assessment).where(Assessment.beneficiary_id == b.id, Assessment.status == "submitted")
                             .order_by(Assessment.submitted_at.asc())).all()
    timeline = [{
        "assessment_id": a.id, "submitted_at": a.submitted_at, "priority_level": a.score.priority_level if a.score else None,
        "overall_score": a.score.overall_score if a.score else None, "dimension_scores": a.score.dimension_scores if a.score else {},
        "review_status": a.score.review_status if a.score else None,
        "top_factors": [f["label"] for f in (a.score.factors if a.score else []) if f["severity"] in ("urgent", "attention")][:3],
    } for a in assessments]
    latest_expl = None
    if assessments and assessments[-1].score:
        s = assessments[-1].score
        latest_expl = {"assessment_id": assessments[-1].id, "factors": s.factors, "change_summary": s.change_summary,
                       "data_quality": s.data_quality, "ml_advisory": s.ml_result}
    notes = db.scalars(select(CaseNote).where(CaseNote.beneficiary_id == b.id).order_by(CaseNote.created_at.desc())).all()
    authors = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_({n.author_id for n in notes if n.author_id})))} if notes else {}
    audit(db, user, "case_viewed", "beneficiary", b.id)
    db.commit()
    return {
        "profile": case_row(db, b, cfg),
        "age_band": b.age_band, "preferred_language": b.preferred_language, "created_at": b.created_at,
        "timeline": timeline,
        "latest_explanation": latest_expl,
        "alerts": [AlertOut.model_validate(a) for a in db.scalars(select(ReviewAlert).where(ReviewAlert.beneficiary_id == b.id).order_by(ReviewAlert.created_at.desc()))],
        "follow_ups": [FollowUpOut.model_validate(f) for f in db.scalars(select(FollowUp).where(FollowUp.beneficiary_id == b.id).order_by(FollowUp.created_at.desc()))],
        "interventions": [InterventionOut.model_validate(i) for i in db.scalars(select(Intervention).where(Intervention.beneficiary_id == b.id).order_by(Intervention.occurred_at.desc()))],
        "notes": [{**NoteOut.model_validate(n).model_dump(), "author_name": authors.get(n.author_id)} for n in notes],
    }


@router.patch("/{beneficiary_id}/status")
def update_status(beneficiary_id: int, body: StatusIn, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    b = deps.authorize_beneficiary_access(db, user, beneficiary_id)
    old, b.case_status = b.case_status, body.case_status
    audit(db, user, "case_status_changed", "beneficiary", b.id, f"{old} -> {body.case_status}")
    db.commit()
    return {"id": b.id, "case_status": b.case_status}


@router.post("/{beneficiary_id}/notes", response_model=NoteOut, status_code=201)
def add_note(beneficiary_id: int, body: NoteIn, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    b = deps.authorize_beneficiary_access(db, user, beneficiary_id)
    n = CaseNote(beneficiary_id=b.id, author_id=user.id, body=body.body.strip(), is_synthetic=b.is_synthetic)
    db.add(n)
    audit(db, user, "case_note_added", "beneficiary", b.id)
    db.commit()
    return n


@router.post("/{beneficiary_id}/assign")
def assign_caseworker(beneficiary_id: int, body: AssignIn, user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    b = deps.get_beneficiary_or_404(db, beneficiary_id)
    cw = db.get(Caseworker, body.caseworker_id)
    if cw is None or not cw.user.is_active:
        raise HTTPException(404, "Caseworker not found")
    current = deps.active_assignment(db, b.id)
    if current and current.caseworker_id == cw.id:
        return {"beneficiary_id": b.id, "caseworker_id": cw.id, "changed": False}
    if current:
        current.active, current.ended_at = False, utcnow()
    db.add(CaseAssignment(beneficiary_id=b.id, caseworker_id=cw.id, assigned_by=user.id))
    # Open alerts / requests follow the case to the new caseworker.
    for al in db.scalars(select(ReviewAlert).where(ReviewAlert.beneficiary_id == b.id, ReviewAlert.status != "resolved")):
        al.caseworker_id = cw.id
    for fu in db.scalars(select(FollowUp).where(FollowUp.beneficiary_id == b.id, FollowUp.status.in_(["requested", "scheduled"]))):
        fu.caseworker_id = cw.id
    audit(db, user, "case_assigned", "beneficiary", b.id, f"caseworker {cw.id}")
    db.commit()
    return {"beneficiary_id": b.id, "caseworker_id": cw.id, "changed": True}
