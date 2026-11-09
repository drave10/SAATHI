"""Audit logging. Details must never contain assessment answers, passwords or tokens."""
from sqlalchemy.orm import Session

from ..models import AuditLog, User


def audit(db: Session, user: User | None, action: str, entity_type: str | None = None,
          entity_id: int | None = None, detail: str | None = None, *, commit: bool = False) -> None:
    db.add(AuditLog(
        actor_user_id=user.id if user else None, actor_role=user.role if user else None,
        action=action, entity_type=entity_type, entity_id=entity_id, detail=(detail or "")[:400] or None,
    ))
    if commit:
        db.commit()
