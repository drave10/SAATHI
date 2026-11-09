"""Start-up helper for hosted deployments:  python -m scripts.bootstrap

1. applies Alembic migrations,
2. seeds the SYNTHETIC demo data ONLY if the database has no users and SEED_* passwords are set,
3. trains the optional experimental ML advisory if the model file is missing.
Safe to run on every start: it never wipes existing data.
"""
from alembic import command
from alembic.config import Config
from sqlalchemy import select

from app.config import BACKEND_DIR, get_settings
from app.database import SessionLocal
from app.models import User


def main():
    s = get_settings()
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", s.database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")
    print("migrations applied")

    with SessionLocal() as db:
        empty = db.scalar(select(User.id).limit(1)) is None
        if empty and s.seed_admin_password and s.seed_caseworker_password and s.seed_beneficiary_password:
            from scripts.seed import seed
            stats = seed(db, admin_pw=s.seed_admin_password, cw_pw=s.seed_caseworker_password,
                         ben_pw=s.seed_beneficiary_password, admin_username=s.seed_admin_username)
            print("seeded synthetic demo data:", {k: v for k, v in stats.items() if k != "demo_invitation_code"})
        elif empty:
            print("database is empty and SEED_* passwords are not set: skipping demo data")

    from app.engine import ml
    if not ml.MODEL_PATH.exists():
        ml.train()
        print("trained experimental ML advisory (synthetic data)")


if __name__ == "__main__":
    main()
