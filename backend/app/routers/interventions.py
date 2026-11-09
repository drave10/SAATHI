from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import deps
from ..database import get_db, utcnow
from ..deps import require_roles
from ..models import Beneficiary, CaseAssignment, Intervention, ReviewAlert, User
from ..schemas import AlertOut, AlertUpdateIn, InterventionIn, InterventionOut, InterventionOutcomeIn
from ..services.audit import audit

router = APIRouter(tags=["interventions"])

INTERVENTION_TYPES = ["counselling_session", "home_visit", "phone_check_in", "referral_health", "referral_legal_aid",
                      "referral_social_support", "community_support_group", "safety_planning", "other"]


def _out(i: Intervention, db: Session) -> dict:
    d = InterventionOut.model_validate(i).model_dump()
    b = db.get(Beneficiary, i.beneficiary_id)
    d["beneficiary_code"], d["beneficiary_name"] = b.code, b.user.display_name
    return d


@router.get("/interventions/types")
def types(_: User = Depends(require_roles("caseworker"))):
    return INTERVENTION_TYPES


@router.post("/interventions", status_code=201)
def record_intervention(body: InterventionIn, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    b = deps.authorize_beneficiary_access(db, user, body.beneficiary_id)
    cw = deps.current_caseworker(user, db)
    i = Intervention(beneficiary_id=b.id, caseworker_id=cw.id if cw else None, type=body.type, description=body.description,
                     outcome=body.outcome, outcome_notes=body.outcome_notes, occurred_at=body.occurred_at or utcnow(), is_synthetic=b.is_synthetic)
    db.add(i)
    audit(db, user, "intervention_recorded", "beneficiary", b.id, body.type)
    db.commit()
    return _out(i, db)


@router.get("/interventions")
def list_interventions(beneficiary_id: int | None = None, outcome: str | None = None,
                       user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    cw = deps.current_caseworker(user, db)
    stmt = select(Intervention).join(CaseAssignment, CaseAssignment.beneficiary_id == Intervention.beneficiary_id).where(
        CaseAssignment.active.is_(True), CaseAssignment.caseworker_id == (cw.id if cw else -1))
    if beneficiary_id:
        stmt = stmt.where(Intervention.beneficiary_id == beneficiary_id)
    if outcome:
        stmt = stmt.where(Intervention.outcome == outcome)
    return [_out(i, db) for i in db.scalars(stmt.order_by(Intervention.occurred_at.desc()).limit(500))]


@router.patch("/interventions/{intervention_id}/outcome")
def record_outcome(intervention_id: int, body: InterventionOutcomeIn, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    i = db.get(Intervention, intervention_id)
    if i is None:
        raise HTTPException(404, "Intervention not found")
    deps.authorize_beneficiary_access(db, user, i.beneficiary_id)
    i.outcome, i.outcome_notes = body.outcome, body.outcome_notes
    audit(db, user, "intervention_outcome", "intervention", i.id, body.outcome)
    db.commit()
    return _out(i, db)


# ---- review alerts (in-app notifications for the assigned caseworker) ---------------------------------
@router.get("/alerts")
def my_alerts(status: str | None = "open", user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    cw = deps.current_caseworker(user, db)
    stmt = select(ReviewAlert).where(ReviewAlert.caseworker_id == (cw.id if cw else -1))
    if status:
        stmt = stmt.where(ReviewAlert.status == status)
    out = []
    for a in db.scalars(stmt.order_by(ReviewAlert.created_at.desc()).limit(200)):
        b = db.get(Beneficiary, a.beneficiary_id)
        out.append(AlertOut.model_validate(a).model_dump() | {"beneficiary_code": b.code, "beneficiary_name": b.user.display_name})
    out.sort(key=lambda x: (0 if x["level"] == "urgent" else 1))
    return out


@router.patch("/alerts/{alert_id}")
def update_alert(alert_id: int, body: AlertUpdateIn, user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    a = db.get(ReviewAlert, alert_id)
    if a is None:
        raise HTTPException(404, "Alert not found")
    deps.authorize_beneficiary_access(db, user, a.beneficiary_id)
    a.status = body.status
    if body.status == "resolved":
        a.resolved_at, a.resolved_by = utcnow(), user.id
    audit(db, user, "alert_" + body.status, "alert", a.id)
    db.commit()
    return AlertOut.model_validate(a)
