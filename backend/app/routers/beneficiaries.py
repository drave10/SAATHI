from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import deps
from ..database import get_db, utcnow
from ..deps import get_current_user, require_roles
from ..engine.scoring import wellbeing_index
from ..models import Assessment, Beneficiary, CaseAssignment, Caseworker, ConsentRecord, FollowUp, User
from ..schemas import BeneficiaryCreateIn, BeneficiaryOut, BeneficiaryUpdateIn
from ..security import hash_password, validate_password_strength
from ..services.audit import audit
from ..services.cases import case_row, latest_scored
from ..services.settings_service import get_engine_config
from .auth import next_beneficiary_code

router = APIRouter(prefix="/beneficiaries", tags=["beneficiaries"])


@router.post("", response_model=BeneficiaryOut, status_code=201)
def create_beneficiary(body: BeneficiaryCreateIn, user: User = Depends(require_roles("caseworker", "admin")), db: Session = Depends(get_db)):
    """Staff-led onboarding. Records consent as *pending* (beneficiary confirms on first login/assessment)."""
    problem = validate_password_strength(body.password)
    if problem:
        raise HTTPException(422, problem)
    if db.scalar(select(User.id).where(User.username == body.username)):
        raise HTTPException(409, "Username is already taken")
    if user.role == "caseworker":
        cw = deps.current_caseworker(user, db)
    else:
        cw = db.get(Caseworker, body.caseworker_id) if body.caseworker_id else None
        if body.caseworker_id and cw is None:
            raise HTTPException(404, "Caseworker not found")
    u = User(username=body.username, display_name=body.display_name, password_hash=hash_password(body.password), role="beneficiary")
    db.add(u)
    db.flush()
    b = Beneficiary(user_id=u.id, code=next_beneficiary_code(db), org_unit=body.org_unit, age_band=body.age_band,
                    preferred_language=body.preferred_language)
    db.add(b)
    db.flush()
    if cw:
        db.add(CaseAssignment(beneficiary_id=b.id, caseworker_id=cw.id, assigned_by=user.id))
    audit(db, user, "beneficiary_created", "beneficiary", b.id)
    db.commit()
    return b


@router.get("")
def list_beneficiaries(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), q: str | None = None,
                       user: User = Depends(require_roles("caseworker", "admin")), db: Session = Depends(get_db)):
    """Basic roster (no assessment data). Caseworkers see only assigned beneficiaries."""
    stmt = select(Beneficiary).join(User, User.id == Beneficiary.user_id)
    if user.role == "caseworker":
        cw = deps.current_caseworker(user, db)
        stmt = stmt.join(CaseAssignment, CaseAssignment.beneficiary_id == Beneficiary.id).where(
            CaseAssignment.active.is_(True), CaseAssignment.caseworker_id == (cw.id if cw else -1))
    if q:
        stmt = stmt.where(Beneficiary.code.ilike(f"%{q}%") | User.display_name.ilike(f"%{q}%"))
    rows = db.scalars(stmt.order_by(Beneficiary.code)).all()
    cfg = get_engine_config(db)
    items = [case_row(db, b, cfg, include_clinical=False) for b in rows[(page - 1) * page_size: page * page_size]]
    return {"items": items, "total": len(rows), "page": page, "page_size": page_size}


@router.get("/me")
def my_dashboard(user: User = Depends(require_roles("beneficiary")), db: Session = Depends(get_db)):
    b = deps.own_beneficiary(db, user)
    cfg = get_engine_config(db)
    assign = deps.active_assignment(db, b.id)
    cw = db.get(Caseworker, assign.caseworker_id) if assign else None
    now = utcnow()
    last2 = latest_scored(db, b.id, 2)
    total = len(db.scalars(select(Assessment.id).where(Assessment.beneficiary_id == b.id, Assessment.status == "submitted")).all())
    draft = db.scalar(select(Assessment).where(Assessment.beneficiary_id == b.id, Assessment.status == "draft"))
    fus = db.scalars(select(FollowUp).where(FollowUp.beneficiary_id == b.id, FollowUp.status.in_(["requested", "scheduled"]))
                     .order_by(FollowUp.scheduled_for.asc())).all()
    from datetime import timedelta
    due = last2[0].submitted_at + timedelta(days=cfg.assessment_interval_days) if last2 else None
    return {
        "profile": BeneficiaryOut.model_validate(b), "display_name": user.display_name,
        "caseworker_name": cw.user.display_name if cw else None,
        "assessments_completed": total,
        "latest_wellbeing": wellbeing_index(last2[0].score.overall_score) if last2 and last2[0].score else None,
        "previous_wellbeing": wellbeing_index(last2[1].score.overall_score) if len(last2) > 1 and last2[1].score else None,
        "last_submitted_at": last2[0].submitted_at if last2 else None,
        "check_in_due": due is None or due < now, "next_due_at": due,
        "has_draft": draft is not None,
        "upcoming_followups": [{"id": f.id, "status": f.status, "kind": f.kind, "scheduled_for": f.scheduled_for} for f in fus],
    }


@router.get("/{beneficiary_id}")
def get_beneficiary(beneficiary_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = deps.authorize_beneficiary_access(db, user, beneficiary_id, allow_admin_profile=True)
    return case_row(db, b, get_engine_config(db), include_clinical=False) | {
        "age_band": b.age_band, "preferred_language": b.preferred_language, "created_at": b.created_at}


@router.patch("/{beneficiary_id}", response_model=BeneficiaryOut)
def update_beneficiary(beneficiary_id: int, body: BeneficiaryUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    b = deps.authorize_beneficiary_access(db, user, beneficiary_id, allow_admin_profile=True)
    data = body.model_dump(exclude_unset=True)
    if user.role == "beneficiary":
        data = {k: v for k, v in data.items() if k in ("preferred_language", "display_name")}  # least-privilege
    if "display_name" in data and data["display_name"]:
        b.user.display_name = data.pop("display_name")
    data.pop("display_name", None)
    for k, v in data.items():
        if v is not None:
            setattr(b, k, v)
    audit(db, user, "beneficiary_updated", "beneficiary", b.id, ",".join(sorted(body.model_dump(exclude_unset=True))))
    db.commit()
    return b
