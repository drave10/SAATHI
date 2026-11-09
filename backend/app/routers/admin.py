"""Administration: users, roles, invitations, resources, engine configuration, audit logs, retention & erasure."""
import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db, utcnow
from ..deps import require_roles
from ..engine import ml
from ..engine.config import EngineConfig, validate_config_dict
from ..models import (Assessment, AssessmentResponse, AuditLog, Beneficiary, CaseAssignment, Caseworker, Invitation, Resource, User)
from ..schemas import (AuditOut, InvitationIn, ResourceIn, ResourceOut, UserCreateIn, UserOut, UserUpdateIn)
from ..security import hash_code, hash_password, validate_password_strength
from ..services.audit import audit
from ..services.settings_service import get_engine_config, set_setting

router = APIRouter(prefix="/admin", tags=["admin"])
admin_only = require_roles("admin")


# ---- users ----------------------------------------------------------------------------------------------
@router.get("/users")
def list_users(role: str | None = None, q: str | None = None, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
               user: User = Depends(admin_only), db: Session = Depends(get_db)):
    stmt = select(User)
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        stmt = stmt.where(User.username.ilike(f"%{q}%") | User.display_name.ilike(f"%{q}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(User.id).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [UserOut.model_validate(u) for u in rows], "total": total, "page": page, "page_size": page_size}


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreateIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    if body.role == "beneficiary":
        raise HTTPException(422, "Create beneficiaries via POST /beneficiaries or an invitation")
    problem = validate_password_strength(body.password)
    if problem:
        raise HTTPException(422, problem)
    if db.scalar(select(User.id).where(User.username == body.username)):
        raise HTTPException(409, "Username is already taken")
    u = User(username=body.username, display_name=body.display_name, password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    db.flush()
    if body.role == "caseworker":
        db.add(Caseworker(user_id=u.id, org_unit=body.org_unit or "Unassigned"))
    audit(db, admin, "user_created", "user", u.id, body.role)
    db.commit()
    return u


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdateIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "User not found")
    data = body.model_dump(exclude_unset=True)
    if get_settings().demo_mode and u.is_synthetic and (set(data) & {"is_active", "role", "new_password"}):
        raise HTTPException(403, "Shared demo accounts cannot be deactivated, re-roled or have their password reset in demo mode")
    if u.id == admin.id and (data.get("is_active") is False or (data.get("role") and data["role"] != "admin")):
        raise HTTPException(409, "You cannot deactivate or demote your own account")
    if "role" in data and data["role"] != u.role:
        if u.role == "beneficiary" or data["role"] == "beneficiary":
            raise HTTPException(422, "Beneficiary accounts cannot change role")
        u.role = data["role"]
        u.token_version += 1
        if u.role == "caseworker" and u.caseworker is None:
            db.add(Caseworker(user_id=u.id, org_unit="Unassigned"))
    if "display_name" in data and data["display_name"]:
        u.display_name = data["display_name"]
    if "is_active" in data:
        u.is_active = data["is_active"]
        u.token_version += 1
    if data.get("new_password"):
        problem = validate_password_strength(data["new_password"])
        if problem:
            raise HTTPException(422, problem)
        u.password_hash, u.token_version = hash_password(data["new_password"]), u.token_version + 1
    audit(db, admin, "user_updated", "user", u.id, ",".join(k for k in data if k != "new_password") + (",password" if "new_password" in data else ""))
    db.commit()
    return u


@router.get("/caseworkers")
def caseworkers(admin: User = Depends(require_roles("admin", "caseworker")), db: Session = Depends(get_db)):
    out = []
    for cw in db.scalars(select(Caseworker).join(User).where(User.is_active.is_(True))):
        n = db.scalar(select(func.count()).select_from(CaseAssignment).where(
            CaseAssignment.caseworker_id == cw.id, CaseAssignment.active.is_(True))) or 0
        out.append({"id": cw.id, "name": cw.user.display_name, "org_unit": cw.org_unit, "caseload": n})
    return out


# ---- invitations ------------------------------------------------------------------------------------------
@router.post("/invitations", status_code=201)
def create_invitation(body: InvitationIn, user: User = Depends(require_roles("admin", "caseworker")), db: Session = Depends(get_db)):
    """Returns the one-time code ONCE; only its hash is stored."""
    code = secrets.token_urlsafe(9).upper().replace("-", "X").replace("_", "Y")
    cw_id = body.caseworker_id
    if user.role == "caseworker":
        cw = db.scalar(select(Caseworker).where(Caseworker.user_id == user.id))
        cw_id = cw.id if cw else None
    db.add(Invitation(code_hash=hash_code(code), org_unit=body.org_unit, created_by=user.id, caseworker_id=cw_id,
                      expires_at=utcnow() + timedelta(days=body.valid_days)))
    audit(db, user, "invitation_created", "invitation", None, body.org_unit)
    db.commit()
    return {"code": code, "expires_in_days": body.valid_days, "org_unit": body.org_unit}


# ---- resources (education / support / emergency contacts) -------------------------------------------------
@router.get("/resources", response_model=list[ResourceOut])
def all_resources(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return db.scalars(select(Resource).order_by(Resource.category, Resource.title)).all()


@router.post("/resources", response_model=ResourceOut, status_code=201)
def create_resource(body: ResourceIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    r = Resource(**body.model_dump())
    db.add(r)
    audit(db, admin, "resource_created", "resource", None, body.category)
    db.commit()
    return r


@router.put("/resources/{resource_id}", response_model=ResourceOut)
def update_resource(resource_id: int, body: ResourceIn, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    r = db.get(Resource, resource_id)
    if r is None:
        raise HTTPException(404, "Resource not found")
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    audit(db, admin, "resource_updated", "resource", r.id)
    db.commit()
    return r


@router.delete("/resources/{resource_id}", status_code=204)
def delete_resource(resource_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    r = db.get(Resource, resource_id)
    if r is None:
        raise HTTPException(404, "Resource not found")
    db.delete(r)
    audit(db, admin, "resource_deleted", "resource", resource_id)
    db.commit()


# ---- configuration ------------------------------------------------------------------------------------------
@router.get("/engine-config")
def get_config(admin: User = Depends(require_roles("admin", "caseworker")), db: Session = Depends(get_db)):
    return {"config": get_engine_config(db).to_dict(), "defaults": EngineConfig().to_dict(), "ml": ml.model_status()}


@router.put("/engine-config")
def put_config(body: dict, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    errors = validate_config_dict(body)
    if errors:
        raise HTTPException(422, {"message": "Invalid configuration", "errors": errors})
    merged = EngineConfig.from_dict(body).to_dict()
    set_setting(db, "engine_config", merged, admin.id)
    audit(db, admin, "engine_config_updated", "system_setting")
    db.commit()
    return {"config": merged}


@router.get("/org-units")
def org_units(user: User = Depends(require_roles("admin", "caseworker")), db: Session = Depends(get_db)):
    """Distinct organisational units in use (drives dropdowns; nothing is hard-coded in the UI)."""
    units = set(db.scalars(select(Beneficiary.org_unit).distinct())) | set(db.scalars(select(Caseworker.org_unit).distinct()))
    return sorted(u for u in units if u and u != "Unassigned")


@router.get("/audit-actions")
def audit_actions(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    return sorted(db.scalars(select(AuditLog.action).distinct()))


# ---- audit logs --------------------------------------------------------------------------------------------
@router.get("/audit-logs")
def audit_logs(action: str | None = None, actor_user_id: int | None = None, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
               admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if actor_user_id:
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [AuditOut.model_validate(r) for r in rows], "total": total, "page": page, "page_size": page_size}


# ---- retention & erasure ------------------------------------------------------------------------------------
@router.get("/deletion-requests")
def deletion_requests(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    rows = db.scalars(select(Beneficiary).where(Beneficiary.deletion_requested_at.is_not(None))).all()
    return [{"beneficiary_id": b.id, "code": b.code, "requested_at": b.deletion_requested_at} for b in rows]


@router.delete("/beneficiaries/{beneficiary_id}", status_code=204)
def erase_beneficiary(beneficiary_id: int, admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Permanently erase a beneficiary and all of their records (assessments, notes, follow-ups, ...)."""
    b = db.get(Beneficiary, beneficiary_id)
    if b is None:
        raise HTTPException(404, "Beneficiary not found")
    if get_settings().demo_mode and b.is_synthetic:
        raise HTTPException(403, "Synthetic demo records are protected from erasure in demo mode")
    code, uid = b.code, b.user_id
    db.delete(b)  # ORM cascade: assignments, assessments(+responses,+scores); DB cascade: notes, follow-ups, interventions, alerts
    db.flush()
    db.execute(delete(User).where(User.id == uid))
    audit(db, admin, "beneficiary_erased", "beneficiary", beneficiary_id, f"code {code}")
    db.commit()


@router.post("/retention/run")
def run_retention(admin: User = Depends(admin_only), db: Session = Depends(get_db)):
    """Purge free-text answers older than RETENTION_FREE_TEXT_DAYS (scored data is retained)."""
    days = get_settings().retention_free_text_days
    cutoff = utcnow() - timedelta(days=days)
    old_ids = select(Assessment.id).where(Assessment.submitted_at < cutoff)
    rows = db.scalars(select(AssessmentResponse).where(AssessmentResponse.assessment_id.in_(old_ids), AssessmentResponse.value_text.is_not(None))).all()
    for r in rows:
        r.value_text = None
    audit(db, admin, "retention_run", detail=f"purged {len(rows)} free-text answers older than {days} days")
    db.commit()
    return {"purged_free_text_answers": len(rows), "older_than_days": days}
