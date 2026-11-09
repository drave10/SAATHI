from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db, utcnow
from ..deps import get_current_user
from ..models import Beneficiary, CaseAssignment, ConsentRecord, Invitation, User
from ..schemas import DemoLoginIn, LoginIn, PasswordChangeIn, RegisterIn, TokenOut, UserOut
from ..security import (create_access_token, hash_code, hash_password, validate_password_strength, verify_password)
from ..services.audit import audit

router = APIRouter(prefix="/auth", tags=["auth"])

# Hash used to equalise timing when the username does not exist.
_DUMMY_HASH = hash_password("dummy-password-1")


def next_beneficiary_code(db: Session) -> str:
    n = (db.scalar(select(Beneficiary.id).order_by(Beneficiary.id.desc()).limit(1)) or 0) + 1
    return f"BEN-{n:05d}"


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    s = get_settings()
    user = db.scalar(select(User).where(User.username == body.username))
    now = utcnow()
    if user and user.locked_until and user.locked_until > now:
        audit(db, None, "login_blocked_locked", "user", user.id, commit=True)
        raise HTTPException(429, "Too many failed attempts. Please try again later.")
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok or not user.is_active:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= s.max_failed_logins:
                user.locked_until = now + timedelta(minutes=s.lockout_minutes)
                user.failed_logins = 0
        audit(db, None, "login_failed", "user", user.id if user else None, commit=True)
        raise HTTPException(401, "Incorrect username or password")
    user.failed_logins = 0
    user.locked_until = None
    user.last_login_at = now
    audit(db, user, "login", "user", user.id)
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user))


@router.get("/config")
def public_config():
    """Tells the login page whether one-click demo access is enabled."""
    return {"demo_mode": get_settings().demo_mode}


@router.post("/demo-login", response_model=TokenOut)
def demo_login(body: DemoLoginIn, db: Session = Depends(get_db)):
    """Passwordless sign-in for the seeded SYNTHETIC demo accounts, only when DEMO_MODE=true.
    Refuses any account that is not flagged is_synthetic, so real users can never be reached this way."""
    s = get_settings()
    if not s.demo_mode:
        raise HTTPException(404, "Not found")
    username = {"admin": s.seed_admin_username, "caseworker": "caseworker1", "beneficiary": "ben001"}[body.role]
    user = db.scalar(select(User).where(User.username == username))
    if user is None or not user.is_synthetic or not user.is_active or user.role != body.role:
        raise HTTPException(404, "Demo account is not available (run the seed script)")
    user.last_login_at = utcnow()
    audit(db, user, "demo_login", "user", user.id)
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Invalidate every token issued to this user (token_version bump).
    In demo mode the shared synthetic accounts are exempt, otherwise one visitor logging out would sign out everybody else."""
    if not (get_settings().demo_mode and user.is_synthetic):
        user.token_version += 1
    audit(db, user, "logout", "user", user.id)
    db.commit()


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.post("/change-password", status_code=204)
def change_password(body: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if get_settings().demo_mode and user.is_synthetic:
        raise HTTPException(403, "Password changes are disabled for the shared demo accounts")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    problem = validate_password_strength(body.new_password)
    if problem:
        raise HTTPException(422, problem)
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    audit(db, user, "password_changed", "user", user.id)
    db.commit()


@router.post("/register", response_model=TokenOut, status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    """Authorised onboarding: requires a valid one-time invitation code created by staff."""
    if not (body.consent_privacy and body.consent_assessment):
        raise HTTPException(422, "You must accept the privacy notice and consent to assessment data processing to register")
    problem = validate_password_strength(body.password)
    if problem:
        raise HTTPException(422, problem)
    inv = db.scalar(select(Invitation).where(Invitation.code_hash == hash_code(body.invite_code)))
    if inv is None or inv.used_at is not None or inv.expires_at < utcnow():
        raise HTTPException(400, "Invitation code is invalid or has expired")
    if db.scalar(select(User.id).where(User.username == body.username)):
        raise HTTPException(409, "Username is already taken")
    user = User(username=body.username, display_name=body.display_name, password_hash=hash_password(body.password), role="beneficiary")
    db.add(user)
    db.flush()
    ben = Beneficiary(user_id=user.id, code=next_beneficiary_code(db), org_unit=inv.org_unit, preferred_language=body.preferred_language)
    db.add(ben)
    db.flush()
    if inv.caseworker_id:
        db.add(CaseAssignment(beneficiary_id=ben.id, caseworker_id=inv.caseworker_id, assigned_by=inv.created_by))
    inv.used_at = utcnow()
    for ctype, granted in (("privacy_notice", True), ("assessment_data", True), ("analytics_use", body.consent_analytics)):
        db.add(ConsentRecord(user_id=user.id, consent_type=ctype, granted=granted))
    audit(db, user, "register", "user", user.id, "via invitation")
    db.commit()
    return TokenOut(access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user))
