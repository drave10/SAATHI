"""Authentication & authorisation dependencies. RBAC is enforced here, server-side."""
from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Beneficiary, CaseAssignment, Caseworker, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    unauthorized = HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    if creds is None:
        raise unauthorized
    try:
        payload = decode_token(creds.credentials)
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    if user is None or not user.is_active or payload.get("tv") != user.token_version:
        raise unauthorized
    return user


def require_roles(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to perform this action")
        return user

    return checker


def staff_only(user: User = Depends(require_roles("caseworker", "admin"))) -> User:
    return user


def current_caseworker(user: User, db: Session) -> Caseworker | None:
    return db.scalar(select(Caseworker).where(Caseworker.user_id == user.id))


def active_assignment(db: Session, beneficiary_id: int) -> CaseAssignment | None:
    return db.scalar(
        select(CaseAssignment).where(CaseAssignment.beneficiary_id == beneficiary_id, CaseAssignment.active.is_(True))
    )


def get_beneficiary_or_404(db: Session, beneficiary_id: int) -> Beneficiary:
    b = db.get(Beneficiary, beneficiary_id)
    if b is None:
        raise HTTPException(404, "Beneficiary not found")
    return b


def authorize_beneficiary_access(db: Session, user: User, beneficiary_id: int, *, allow_admin_profile: bool = False) -> Beneficiary:
    """Return the beneficiary if `user` may access them, else raise 403/404.

    - beneficiary: only their own record
    - caseworker: only actively assigned cases
    - admin: only when allow_admin_profile (non-clinical data such as profile / assignment)
    A non-assigned caseworker receives 404 (not 403) so that case existence is not disclosed.
    """
    b = get_beneficiary_or_404(db, beneficiary_id)
    if user.role == "beneficiary":
        if b.user_id != user.id:
            raise HTTPException(404, "Beneficiary not found")
    elif user.role == "caseworker":
        cw = current_caseworker(user, db)
        a = active_assignment(db, b.id)
        if cw is None or a is None or a.caseworker_id != cw.id:
            raise HTTPException(404, "Beneficiary not found")
    elif user.role == "admin":
        if not allow_admin_profile:
            raise HTTPException(403, "Administrators cannot access individual assessment or case content")
    return b


def own_beneficiary(db: Session, user: User) -> Beneficiary:
    b = db.scalar(select(Beneficiary).where(Beneficiary.user_id == user.id))
    if b is None:
        raise HTTPException(404, "No beneficiary profile for this user")
    return b
