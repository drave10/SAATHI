"""Self-service endpoints: resources, consent & privacy preferences, data export, deletion request."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import deps
from ..database import get_db, utcnow
from ..deps import get_current_user, require_roles
from ..models import Assessment, ConsentRecord, FollowUp, Resource, User
from ..schemas import ConsentIn, ConsentOut, ResourceOut
from ..services.audit import audit

router = APIRouter(tags=["self-service"])
NOTICE_VERSION = "1.0"


@router.get("/resources", response_model=list[ResourceOut])
def resources(category: str | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Resource).where(Resource.is_active.is_(True))
    if category:
        stmt = stmt.where(Resource.category == category)
    return db.scalars(stmt.order_by(Resource.category, Resource.title)).all()


def _current_consents(db: Session, user_id: int) -> dict:
    cur: dict = {}
    for c in db.scalars(select(ConsentRecord).where(ConsentRecord.user_id == user_id).order_by(ConsentRecord.created_at.asc(), ConsentRecord.id.asc())):
        cur[c.consent_type] = c.granted
    return cur


@router.get("/me/consents")
def my_consents(user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    history = db.scalars(select(ConsentRecord).where(ConsentRecord.user_id == user.id).order_by(ConsentRecord.created_at.desc(), ConsentRecord.id.desc())).all()
    b = deps.own_beneficiary(db, user)
    return {"current": _current_consents(db, user.id), "history": [ConsentOut.model_validate(c) for c in history],
            "notice_version": NOTICE_VERSION, "deletion_requested_at": b.deletion_requested_at}


@router.post("/me/consents", response_model=ConsentOut, status_code=201)
def set_consent(body: ConsentIn, user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    c = ConsentRecord(user_id=user.id, consent_type=body.consent_type, granted=body.granted, notice_version=NOTICE_VERSION)
    db.add(c)
    audit(db, user, "consent_changed", "user", user.id, f"{body.consent_type}={body.granted}")
    db.commit()
    return c


@router.post("/me/deletion-request")
def request_deletion(user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    """Flags the account for erasure by an administrator and withdraws analytics consent immediately."""
    b = deps.own_beneficiary(db, user)
    b.deletion_requested_at = b.deletion_requested_at or utcnow()
    db.add(ConsentRecord(user_id=user.id, consent_type="analytics_use", granted=False, notice_version=NOTICE_VERSION))
    audit(db, user, "deletion_requested", "beneficiary", b.id)
    db.commit()
    return {"deletion_requested_at": b.deletion_requested_at}


@router.get("/me/export")
def export_my_data(user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    """Data portability: everything the system holds about the caller (excluding staff-only review levels)."""
    b = deps.own_beneficiary(db, user)
    assessments = db.scalars(select(Assessment).where(Assessment.beneficiary_id == b.id).order_by(Assessment.started_at)).all()
    audit(db, user, "data_exported", "beneficiary", b.id)
    db.commit()
    return {
        "exported_at": utcnow(), "profile": {"code": b.code, "org_unit": b.org_unit, "preferred_language": b.preferred_language, "display_name": user.display_name},
        "consents": [ConsentOut.model_validate(c) for c in db.scalars(select(ConsentRecord).where(ConsentRecord.user_id == user.id))],
        "assessments": [{"id": a.id, "status": a.status, "submitted_at": a.submitted_at,
                         "responses": {r.question_id: (r.value_int if r.value_int is not None else r.value_text) for r in a.responses}} for a in assessments],
        "follow_ups": [{"id": f.id, "status": f.status, "scheduled_for": f.scheduled_for} for f in db.scalars(select(FollowUp).where(FollowUp.beneficiary_id == b.id))],
    }
