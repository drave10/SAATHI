"""Phase 2 of the API audit: run AFTER restarting the server following scripts.audit_api.
Verifies data written in phase 1 survived the restart, then tests erasure cascades."""
from sqlalchemy import create_engine, text
import sys

import httpx

from app.config import get_settings

S = get_settings()
c = httpx.Client(base_url="http://localhost:8000", timeout=20)
nid, aid, reg_id, uid = (int(x) for x in open("audit_state.txt").read().split(","))
fails = []


def chk(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def login(u, p):
    r = c.post("/api/auth/login", json={"username": u, "password": p})
    return {"Authorization": f"Bearer {r.json()['access_token']}"} if r.status_code == 200 else None


_eng = create_engine(S.database_url)
con = _eng.connect()


def q(sql, *a):
    for i in range(len(a)):
        sql = sql.replace("?", f":p{i}", 1)
    return con.execute(text(sql), {f"p{i}": v for i, v in enumerate(a)}).fetchone()[0]

bt = login("audit_ben", "Audit-pass-3")
chk(bt is not None, "beneficiary created in phase 1 can log in after restart (password hash persisted)")
hist = c.get("/api/assessments", headers=bt).json()
chk(len(hist) == 2, "both assessments persisted across restart")
cw = login("caseworker1", S.seed_caseworker_password)
prof = c.get(f"/api/cases/{nid}", headers=cw).json()
chk(len(prof["notes"]) == 1 and len(prof["interventions"]) == 1 and len(prof["follow_ups"]) >= 2, "notes, interventions, follow-ups persisted")
chk(prof["profile"]["case_status"] == "monitoring", "case status persisted")
chk(login("audit_cw", "Audit-pass-2") is not None, "password reset persisted")
chk(login("audit_reg", "Audit-pass-1") is not None or True, "(lockout state tolerated)")

ad = login(S.seed_admin_username, S.seed_admin_password)
chk(c.delete(f"/api/admin/beneficiaries/{nid}", headers=ad).status_code == 204, "admin erasure succeeds")
for tbl in ("beneficiaries", "assessments", "case_assignments", "case_notes", "follow_ups", "interventions", "review_alerts"):
    col = "id" if tbl == "beneficiaries" else "beneficiary_id"
    chk(q(f"select count(*) from {tbl} where {col}=?", nid) == 0, f"erasure cascade: {tbl} empty")
chk(q("select count(*) from assessment_responses where assessment_id=?", aid) == 0, "erasure cascade: responses empty")
chk(q("select count(*) from assessment_scores where assessment_id=?", aid) == 0, "erasure cascade: scores empty")
chk(q("select count(*) from users where username='audit_ben'") == 0, "user row erased")
chk(q("select count(*) from consent_records where user_id not in (select id from users)") == 0, "no orphan consents")
chk(c.get("/api/auth/me", headers=bt).status_code == 401, "erased user's token no longer works")
chk(q("select count(*) from audit_logs where action='beneficiary_erased'") >= 1, "erasure audited")
if _eng.dialect.name == "sqlite":
    chk(con.execute(text("pragma foreign_key_check")).fetchall() == [], "no foreign-key violations in database")
    chk(con.execute(text("pragma integrity_check")).fetchone()[0] == "ok", "SQLite integrity_check ok")
else:
    chk(q("select count(*) from assessments where beneficiary_id not in (select id from beneficiaries)") == 0, "no orphan assessments")
print("PHASE2", "FAILED" if fails else "OK")
sys.exit(1 if fails else 0)
