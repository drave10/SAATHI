import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="saathi_test_")) / "test.db"
# Set TEST_DATABASE_URL (e.g. a throwaway PostgreSQL database) to run the suite on another backend; its tables are DROPPED.
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_tmp.as_posix()}"
os.environ["BCRYPT_ROUNDS"] = "4"
os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-only-0123456789"
os.environ["APP_ENV"] = "test"
os.environ["DEMO_MODE"] = "false"   # deterministic regardless of the developer's .env; demo tests switch it on explicitly

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from scripts.seed import seed  # noqa: E402

ADMIN_PW, CW_PW, BEN_PW = "Admin-pass-1", "Worker-pass-1", "Benef-pass-1"


@pytest.fixture(scope="session", autouse=True)
def _db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        stats = seed(db, admin_pw=ADMIN_PW, cw_pw=CW_PW, ben_pw=BEN_PW)
    os.environ["_DEMO_INVITE"] = stats["demo_invitation_code"]
    yield stats


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def db():
    with SessionLocal() as s:
        yield s


def login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def admin_h(client):
    return login(client, "admin", ADMIN_PW)


@pytest.fixture()
def cw1_h(client):
    return login(client, "caseworker1", CW_PW)


@pytest.fixture()
def cw2_h(client):
    return login(client, "caseworker2", CW_PW)


@pytest.fixture()
def ben_h(client):
    # ben001 is assigned to caseworker1 (index 0)
    return login(client, "ben001", BEN_PW)
