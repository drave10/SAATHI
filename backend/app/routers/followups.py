from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import deps
from ..database import get_db, utcnow
from ..deps import require_roles
from ..models import Beneficiary, CaseAssignment, FollowUp, User
from ..schemas import CompleteIn, FollowUpCreateIn, FollowUpOut, FollowUpUpdateIn
from ..services.audit import audit

router = APIRouter(prefix="/followups", tags=["follow-ups"])


def _out(f: FollowUp, db: Session, user: User) -> dict:
    d = FollowUpOut.model_validate(f).model_dump()
    d["is_overdue"] = bool(f.status == "scheduled" and f.scheduled_for and f.scheduled_for < utcnow())
    if user.role == "caseworker":
        b = db.get(Beneficiary, f.beneficiary_id)
        d["beneficiary_code"], d["beneficiary_name"] = b.code, b.user.display_name
    return d


def _load(db: Session, user: User, fid: int) -> FollowUp:
    f = db.get(FollowUp, fid)
    if f is None:
        raise HTTPException(404, "Follow-up not found")
    deps.authorize_beneficiary_access(db, user, f.beneficiary_id)
    return f


@router.post("", status_code=201)
def create_followup(body: FollowUpCreateIn, user: User = Depends(require_roles("beneficiary", "caseworker")), db: Session = Depends(get_db)):
    if user.role == "beneficiary":
        b = deps.own_beneficiary(db, user)
        dup = db.scalar(select(FollowUp).where(FollowUp.beneficiary_id == b.id, FollowUp.status == "requested"))
        if dup:
            raise HTTPException(409, "You already have an open request. Your support worker will contact you.")
        assign = deps.active_assignment(db, b.id)
        f = FollowUp(beneficiary_id=b.id, caseworker_id=assign.caseworker_id if assign else None, status="requested",
                     kind="requested_contact", requested_by_beneficiary=True, reason=body.reason, is_synthetic=b.is_synthetic)
        audit(db, user, "followup_requested", "beneficiary", b.id)
    else:
        if body.beneficiary_id is None or body.scheduled_for is None:
            raise HTTPException(422, "beneficiary_id and scheduled_for are required")
        b = deps.authorize_beneficiary_access(db, user, body.beneficiary_id)
        cw = deps.current_caseworker(user, db)
        f = FollowUp(beneficiary_id=b.id, caseworker_id=cw.id if cw else None, status="scheduled", kind=body.kind,
                     scheduled_for=body.scheduled_for, reason=body.reason, is_synthetic=b.is_synthetic)
        audit(db, user, "followup_scheduled", "beneficiary", b.id)
    db.add(f)
    db.commit()
    return _out(f, db, user)


@router.get("")
def list_followups(status: str | None = None, beneficiary_id: int | None = None, due_within_days: int | None = Query(None, ge=0, le=90),
                   overdue: bool | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                   user: User = Depends(require_roles("beneficiary", "caseworker")), db: Session = Depends(get_db)):
    now = utcnow()
    stmt = select(FollowUp)
    if user.role == "beneficiary":
        stmt = stmt.where(FollowUp.beneficiary_id == deps.own_beneficiary(db, user).id)
    else:
        cw = deps.current_caseworker(user, db)
        stmt = stmt.join(CaseAssignment, CaseAssignment.beneficiary_id == FollowUp.beneficiary_id).where(
            CaseAssignment.active.is_(True), CaseAssignment.caseworker_id == (cw.id if cw else -1))
        if beneficiary_id:
            stmt = stmt.where(FollowUp.beneficiary_id == beneficiary_id)
    if status:
        stmt = stmt.where(FollowUp.status == status)
    if overdue:
        stmt = stmt.where(FollowUp.status == "scheduled", FollowUp.scheduled_for < now)
    if due_within_days is not None:
        stmt = stmt.where(FollowUp.status == "scheduled", FollowUp.scheduled_for >= now,
                          FollowUp.scheduled_for <= now + timedelta(days=due_within_days))
    rows = db.scalars(stmt.order_by(FollowUp.scheduled_for.asc().nulls_first(), FollowUp.created_at.desc())).all()
    s = (page - 1) * page_size
    return {"items": [_out(f, db, user) for f in rows[s:s + page_size]], "total": len(rows), "page": page, "page_size": page_size}


@router.patch("/{followup_id}")
def update_followup(followup_id: int, body: FollowUpUpdateIn, user: User = Depends(require_roles("beneficiary", "caseworker")), db: Session = Depends(get_db)):
    f = _load(db, user, followup_id)
    data = body.model_dump(exclude_unset=True)
    if user.role == "beneficiary":
        if f.status != "requested" or set(data) - {"status"} or data.get("status") != "cancelled":
            raise HTTPException(403, "You can only cancel your own pending request")
    if f.status in ("completed", "cancelled") and user.role == "caseworker":
        raise HTTPException(409, "Closed follow-ups cannot be modified")
    if "scheduled_for" in data and data["scheduled_for"] is not None and f.status == "requested" and "status" not in data:
        data["status"] = "scheduled"
    if data.get("status") == "completed":
        f.completed_at = utcnow()
    if data.get("status") == "scheduled" and f.scheduled_for is None and data.get("scheduled_for") is None:
        raise HTTPException(422, "scheduled_for is required to schedule a follow-up")
    for k, v in data.items():
        setattr(f, k, v)
    if user.role == "caseworker" and f.caseworker_id is None:
        cw = deps.current_caseworker(user, db)
        f.caseworker_id = cw.id if cw else None
    audit(db, user, "followup_updated", "followup", f.id, f.status)
    db.commit()
    return _out(f, db, user)


@router.post("/{followup_id}/complete")
def complete_followup(followup_id: int, body: CompleteIn, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    f = _load(db, user, followup_id)
    if f.status != "scheduled":
        raise HTTPException(409, "Only scheduled follow-ups can be marked completed")
    f.status, f.completed_at, f.outcome_notes = "completed", utcnow(), body.outcome_notes
    audit(db, user, "followup_completed", "followup", f.id)
    db.commit()
    return _out(f, db, user)
