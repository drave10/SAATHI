"""Application settings, loaded from environment variables / .env (never hard-coded secrets)."""
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
INSECURE_DEFAULT_KEY = "dev-only-insecure-key-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(BACKEND_DIR / ".env"), str(BACKEND_DIR.parent / ".env")),
        extra="ignore",
    )

    app_env: str = "development"
    secret_key: str = INSECURE_DEFAULT_KEY
    access_token_minutes: int = 60
    bcrypt_rounds: int = 12  # lowered only in the automated test-suite
    database_url: str = f"sqlite:///{(BACKEND_DIR / 'saathi.db').as_posix()}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Demo mode: shows one-click "enter as ..." buttons for the SYNTHETIC seeded accounts. Never enable with real data.
    demo_mode: bool = False
    # Login throttling
    max_failed_logins: int = 5
    lockout_minutes: int = 15
    # Data retention: free-text answers older than this are purged by the retention job
    retention_free_text_days: int = 365
    # Analytics: counts below this are suppressed in aggregate views (small-cell protection)
    analytics_min_cell: int = 3
    # Seed credentials (demo only, supplied via environment)
    seed_admin_username: str = "admin"
    seed_admin_password: str = ""
    seed_caseworker_password: str = ""
    seed_beneficiary_password: str = ""

    @field_validator("database_url")
    @classmethod
    def _normalise_db_url(cls, v: str) -> str:
        # Hosting platforms hand out postgres:// or postgresql:// URLs; SQLAlchemy needs the driver suffix.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+psycopg2://" + v[len(prefix):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def validate_for_runtime(self) -> None:
        if self.app_env.lower() == "production" and (
            self.secret_key == INSECURE_DEFAULT_KEY or len(self.secret_key) < 32
        ):
            raise RuntimeError("SECRET_KEY must be set to a random value (>=32 chars) in production.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
