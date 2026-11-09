from sqlalchemy.orm import Session

from ..engine.config import EngineConfig
from ..models import SystemSetting


def get_engine_config(db: Session) -> EngineConfig:
    row = db.get(SystemSetting, "engine_config")
    return EngineConfig.from_dict(row.value if row else None)


def set_setting(db: Session, key: str, value: dict, user_id: int | None) -> None:
    row = db.get(SystemSetting, key)
    if row is None:
        db.add(SystemSetting(key=key, value=value, updated_by=user_id))
    else:
        row.value = value
        row.updated_by = user_id
