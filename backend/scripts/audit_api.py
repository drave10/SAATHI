"""Black-box audit of a RUNNING SAATHI API (real HTTP + direct DB checks).

Usage (server running, DB freshly seeded, backend/ as cwd):  python -m scripts.audit_api
Covers every route in /openapi.json, a role matrix, persistence (checked by reading the database directly), and writes
audit_state.txt for scripts.audit_api_phase2 (run after restarting the server).
Works against SQLite or PostgreSQL (whatever DATABASE_URL the server uses).
"""
import json
import re
import sys
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import create_engine, text

from app.config import get_settings

S = get_settings()
BASE = "http://localhost:8000"
c = httpx.Client(base_url=BASE, timeout=20)
covered: set[tuple[str, str]] = set()
fails: list[str] = []
passed = 0
_eng = create_engine(S.database_url)


def norm(path: str) -> str:
    return re.sub(r"/\d+", "/{id}", path)


def call(tok, method, path, expect, **kw):
    global passed
    h = {"Authorization": f"Bearer {tok}"} if tok else {}
    r = c.request(method, "/api" + path, headers=h, **kw)
    covered.add((method.upper(), norm(path.split("?")[0])))
    exp = expect if isinstance(expect, (tuple, list, set)) else (expect,)
    if r.status_code in exp:
        passed += 1
    else:
        fails.append(f"{method} {path} -> {r.status_code} (expected {expect}): {r.text[:200]}")
    try:
        return r.json() if r.content else None
    except Exception:
        return None


def login(u, p):
    r = c.post("/api/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, f"login {u}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def check(cond, msg):
    global passed
    if cond:
        passed += 1
    else:
        fails.append("ASSERT: " + msg)


def scalar(sql, *a):
    """Run raw SQL with ? placeholders against whatever database the server uses."""
    params = {f"p{i}": v for i, v in enumerate(a)}
    for i in range(len(a)):
        sql = sql.replace("?", f":p{i}", 1)
    with _eng.connect() as con:
        row = con.execute(text(sql), params).fetchone()
    return row[0] if row else None


ADMIN, CW, BEN = S.seed_admin_password, S.seed_caseworker_password, S.seed_beneficiary_password
A = login(S.seed_admin_username, ADMIN)
C1 = login("caseworker1", CW)
C2 = login("caseworker2", CW)
B1 = login("ben001", BEN)   # assigned to caseworker1
B2 = login("ben002", BEN)   # assigned to caseworker2

# ---------------------------------------------------------------- system + auth
call(None, "GET", "/health", 200)
check(c.get("/openapi.json").status_code == 200 and c.get("/docs").status_code == 200, "swagger available")
call(None, "POST", "/auth/login", 401, json={"username": "admin", "password": "wrong-pass-1"})
call(None, "POST", "/auth/login", 422, json={"username": ""})
call(None, "GET", "/auth/me", 401)
call(None, "GET", "/auth/config", 200)
call(None, "POST", "/auth/demo-login", (200, 404), json={"role": "beneficiary"})   # 404 when DEMO_MODE is off
call(None, "POST", "/auth/demo-login", 422, json={"role": "superuser"})
call("garbage", "GET", "/auth/me", 401)
me = call(A, "GET", "/auth/me", 200)
check(me["role"] == "admin" and "password" not in str(me), "me payload safe")

# ---------------------------------------------------------------- admin: users, caseworkers, resources, config
u = call(A, "POST", "/admin/users", 201, json={"username": "audit_cw", "display_name": "Audit CW", "password": "Audit-pass-1", "role": "caseworker", "org_unit": "Demo Unit North"})
call(A, "POST", "/admin/users", 409, json={"username": "audit_cw", "display_name": "x", "password": "Audit-pass-1", "role": "caseworker"})
call(A, "POST", "/admin/users", 422, json={"username": "weakpw", "display_name": "x", "password": "short", "role": "admin"})
call(A, "POST", "/admin/users", 422, json={"username": "benx1", "display_name": "x", "password": "Audit-pass-1", "role": "beneficiary"})
uid = u["id"]
check(scalar("select role from users where id=?", uid) == "caseworker" and scalar("select count(*) from caseworkers where user_id=?", uid) == 1, "DB: user+caseworker row persisted")
check(scalar("select password_hash from users where id=?", uid).startswith("$2"), "DB: password hashed")
page = call(A, "GET", "/admin/users?role=caseworker&q=audit&page=1&page_size=5", 200)
check(page["total"] >= 1, "user search works")
call(A, "PATCH", f"/admin/users/{uid}", 200, json={"display_name": "Audit CW 2"})
call(A, "PATCH", "/admin/users/999999", 404, json={"display_name": "x"})
call(A, "PATCH", f"/admin/users/{me['id']}", (403, 409), json={"is_active": False})  # 403 in demo mode (protected demo account), else 409
tok_audit = login("audit_cw", "Audit-pass-1")
call(A, "PATCH", f"/admin/users/{uid}", 200, json={"is_active": False})
call(tok_audit, "GET", "/auth/me", 401)  # deactivation revokes tokens
check(c.post("/api/auth/login", json={"username": "audit_cw", "password": "Audit-pass-1"}).status_code == 401, "deactivated cannot log in")
call(A, "PATCH", f"/admin/users/{uid}", 200, json={"is_active": True, "new_password": "Audit-pass-2"})
check(c.post("/api/auth/login", json={"username": "audit_cw", "password": "Audit-pass-2"}).status_code == 200, "password reset works")

cws = call(A, "GET", "/admin/caseworkers", 200)
check(len(cws) >= 5 and all("caseload" in x for x in cws), "caseworker list")
cw1_id = next(x["id"] for x in cws if x["name"].startswith("Demo Caseworker A"))

res = call(A, "POST", "/admin/resources", 201, json={"title": "Audit desk", "category": "emergency", "summary": "s", "contact": "100", "is_verified": True})
call(A, "POST", "/admin/resources", 422, json={"title": "x", "category": "bogus", "summary": "s"})
call(A, "PUT", f"/admin/resources/{res['id']}", 200, json={"title": "Audit desk 2", "category": "emergency", "summary": "s", "contact": "101", "is_verified": True, "is_active": True})
check(scalar("select title from resources where id=?", res["id"]) == "Audit desk 2", "DB: resource update persisted")
call(A, "PUT", "/admin/resources/999999", 404, json={"title": "x", "category": "support", "summary": "s"})
check(any(r["id"] == res["id"] for r in call(A, "GET", "/admin/resources", 200)), "admin resource list")
call(A, "DELETE", f"/admin/resources/{res['id']}", 204)
call(A, "DELETE", f"/admin/resources/{res['id']}", 404)

cfg = call(A, "GET", "/admin/engine-config", 200)
check("defaults" in cfg and "ml" in cfg, "config payload")
call(A, "PUT", "/admin/engine-config", 422, json={"attention_overall": 90, "urgent_overall": 50})
call(A, "PUT", "/admin/engine-config", 422, json={"bogus_key": 1})
call(A, "PUT", "/admin/engine-config", 200, json={"attention_overall": 41})
_v = scalar("select value from system_settings where key='engine_config'")
_v = json.loads(_v) if isinstance(_v, str) else _v
check(_v["attention_overall"] == 41, "DB: config persisted")
call(A, "PUT", "/admin/engine-config", 200, json={"attention_overall": 40})
call(C1, "GET", "/admin/engine-config", 200)
check("Demo Unit North" in call(C1, "GET", "/admin/org-units", 200), "org units list")
call(B1, "GET", "/admin/org-units", 403)
check("login" in call(A, "GET", "/admin/audit-actions", 200), "audit actions list")
call(C1, "GET", "/admin/audit-actions", 403)

# ---------------------------------------------------------------- invitations + registration
inv = call(A, "POST", "/admin/invitations", 201, json={"org_unit": "Demo Unit North", "caseworker_id": cw1_id, "valid_days": 2})
call(C1, "POST", "/admin/invitations", 201, json={"org_unit": "Demo Unit North", "valid_days": 1})
call(B1, "POST", "/admin/invitations", 403, json={"org_unit": "x"})
check(scalar("select count(*) from invitations where code_hash=?", inv["code"]) == 0, "DB: invitation code not stored in plaintext")
reg = {"invite_code": inv["code"], "username": "audit_reg", "password": "Audit-pass-1", "display_name": "Audit Reg", "consent_privacy": True, "consent_assessment": True}
call(None, "POST", "/auth/register", 422, json={**reg, "consent_assessment": False})
call(None, "POST", "/auth/register", 422, json={**reg, "password": "allletters"})
call(None, "POST", "/auth/register", 400, json={**reg, "invite_code": "NOSUCHCODE1"})
r = call(None, "POST", "/auth/register", 201, json=reg)
call(None, "POST", "/auth/register", 400, json={**reg, "username": "audit_reg2"})  # single use
reg_id = scalar("select id from users where username='audit_reg'")
check(scalar("select count(*) from consent_records where user_id=?", reg_id) == 3, "DB: 3 consent rows on registration")
check(scalar("select count(*) from case_assignments a join beneficiaries b on b.id=a.beneficiary_id where b.user_id=? and a.active is true", reg_id) == 1, "DB: invited user assigned")
call(r["access_token"], "GET", "/beneficiaries/me", 200)

# ---------------------------------------------------------------- beneficiaries (create by caseworker)
nb = call(C1, "POST", "/beneficiaries", 201, json={"username": "audit_ben", "display_name": "Audit Ben", "password": "Audit-pass-1", "org_unit": "Demo Unit North", "age_band": "25-34"})
nid = nb["id"]
call(C1, "POST", "/beneficiaries", 409, json={"username": "audit_ben", "display_name": "x", "password": "Audit-pass-1", "org_unit": "x"})
call(C1, "POST", "/beneficiaries", 422, json={"username": "audit_b2", "display_name": "x", "password": "Audit-pass-1", "org_unit": "x", "age_band": "9-9"})
call(B1, "POST", "/beneficiaries", 403, json={"username": "audit_b3", "display_name": "x", "password": "Audit-pass-1", "org_unit": "x"})
call(A, "POST", "/beneficiaries", 404, json={"username": "audit_b4", "display_name": "x", "password": "Audit-pass-1", "org_unit": "x", "caseworker_id": 999999})
check(scalar("select count(*) from case_assignments where beneficiary_id=? and active is true", nid) == 1, "DB: self-assignment on create")
lst = call(C1, "GET", "/beneficiaries?q=audit&page_size=5", 200)
check(lst["total"] >= 1 and all("latest" not in i for i in lst["items"]), "beneficiary roster has no clinical data")
call(A, "GET", "/beneficiaries", 200)
call(B1, "GET", "/beneficiaries", 403)
call(C1, "GET", f"/beneficiaries/{nid}", 200)
call(A, "GET", f"/beneficiaries/{nid}", 200)
call(C2, "GET", f"/beneficiaries/{nid}", 404)
call(C1, "GET", "/beneficiaries/999999", 404)
call(C1, "PATCH", f"/beneficiaries/{nid}", 200, json={"org_unit": "Demo Unit North", "preferred_language": "Hindi"})
check(scalar("select preferred_language from beneficiaries where id=?", nid) == "Hindi", "DB: beneficiary patch persisted")
call(C2, "PATCH", f"/beneficiaries/{nid}", 404, json={"preferred_language": "x"})

# ---------------------------------------------------------------- beneficiary assessment workflow
BT = login("audit_ben", "Audit-pass-1")
check(call(BT, "GET", "/beneficiaries/me", 200)["check_in_due"] is True, "new beneficiary check-in due")
q = call(BT, "GET", "/assessments/questionnaire", 200)
check(all("concern" not in i for i in q["items"]), "scoring map not exposed")
call(C1, "POST", "/assessments", 403, json={"consent_confirmed": True})
call(BT, "POST", "/assessments", 422, json={"consent_confirmed": False})
check(call(BT, "GET", "/assessments/draft", 200)["draft"] is None, "no draft yet")
a = call(BT, "POST", "/assessments", 201, json={"consent_confirmed": True})
aid = a["id"]
check(call(BT, "POST", "/assessments", 201, json={"consent_confirmed": True})["resumed"] is True, "draft resumed")
call(BT, "PUT", f"/assessments/{aid}/responses", 422, json={"answers": {"emo_1": 99}})
call(BT, "PUT", f"/assessments/{aid}/responses", 422, json={"answers": {"nope": 1}})
call(BT, "PUT", f"/assessments/{aid}/responses", 200, json={"answers": {"emo_1": 2}})
call(B2, "PUT", f"/assessments/{aid}/responses", 404, json={"answers": {"emo_1": 1}})
call(BT, "POST", f"/assessments/{aid}/submit", 422)
answers = {i["id"]: 0 for i in q["items"] if i["type"] == "likert"}
answers["safe_self"] = 1
answers["help_1"] = 2
answers["text_1"] = "audit free text"
call(BT, "PUT", f"/assessments/{aid}/responses", 200, json={"answers": answers})
check(scalar("select count(*) from assessment_responses where assessment_id=?", aid) == 18, "DB: 18 responses persisted")
sub = call(BT, "POST", f"/assessments/{aid}/submit", 200)
check(sub["show_support_now"] is True and "priority_level" not in sub, "urgent: support shown, no label to beneficiary")
call(BT, "POST", f"/assessments/{aid}/submit", 409)
call(BT, "PUT", f"/assessments/{aid}/responses", 409, json={"answers": {"emo_1": 1}})
check(scalar("select priority_level from assessment_scores where assessment_id=?", aid) == "urgent", "DB: score persisted as urgent")
check(scalar("select count(*) from review_alerts where assessment_id=? and level='urgent' and status='open'", aid) == 1, "DB: urgent alert created")
check(scalar("select count(*) from follow_ups where beneficiary_id=? and status='requested'", nid) == 1, "DB: follow-up request created from help request")

hist = call(BT, "GET", "/assessments", 200)
check(len(hist) == 1 and "priority_level" not in hist[0] and "wellbeing_index" in hist[0], "beneficiary history safe")
call(BT, "GET", f"/assessments?beneficiary_id={nid}", 200)
call(C1, "GET", "/assessments", 422)
ch = call(C1, "GET", f"/assessments?beneficiary_id={nid}", 200)
check(ch[0]["priority_level"] == "urgent", "caseworker sees level")
call(C2, "GET", f"/assessments?beneficiary_id={nid}", 404)
call(A, "GET", "/assessments", 403)
call(BT, "GET", f"/assessments/{aid}", 200)
call(C1, "GET", f"/assessments/{aid}", 200)
call(B2, "GET", f"/assessments/{aid}", 404)
call(C2, "GET", f"/assessments/{aid}", 404)
call(A, "GET", f"/assessments/{aid}", 403)
call(C1, "GET", "/assessments/999999", 404)
call(BT, "GET", f"/assessments/{aid}/explanation", 403)
ex = call(C1, "GET", f"/assessments/{aid}/explanation", 200)
check(ex["priority_level"] == "urgent" and any(f["code"] == "critical_self_harm_item" for f in ex["factors"]) and ex["ml_advisory"] is not None, "explanation + ML advisory present")
call(C1, "GET", f"/assessments/{aid}/compare", 200)
call(C1, "POST", f"/assessments/{aid}/recalculate", 200)
call(BT, "POST", f"/assessments/{aid}/recalculate", 403)
call(C1, "POST", f"/assessments/{aid}/mark-reviewed", 200)
check(scalar("select review_status from assessment_scores where assessment_id=?", aid) == "reviewed", "DB: reviewed")
# second assessment (routine) to test compare/history logic
a2 = call(BT, "POST", "/assessments", 201, json={"consent_confirmed": True})["id"]
low = {i["id"]: 0 for i in q["items"] if i["type"] == "likert"}
call(BT, "PUT", f"/assessments/{a2}/responses", 200, json={"answers": low})
call(BT, "POST", f"/assessments/{a2}/submit", 200)
cmp_ = call(C1, "GET", f"/assessments/{a2}/compare", 200)
check(cmp_["previous"] is not None and cmp_["overall_delta"] is not None, "compare uses previous")
call(C1, "GET", f"/assessments/{a2}/compare?with_id={aid}", 200)
call(C1, "GET", f"/assessments/{a2}/compare?with_id=1", 422)    # assigned, but a different beneficiary
other = scalar("select a.id from assessments a join case_assignments c on c.beneficiary_id=a.beneficiary_id where c.caseworker_id=2 and c.active is true limit 1")
call(C1, "GET", f"/assessments/{a2}/compare?with_id={other}", 404)  # not my case: existence hidden

# ---------------------------------------------------------------- cases
cl = call(C1, "GET", "/cases?sort=priority&page=1&page_size=3&q=BEN", 200)
check(cl["page_size"] == 3 and len(cl["items"]) <= 3, "case paging")
for qs in ("priority=urgent", "status=open", "needs_review=true", "assessment_due=true", "sort=name&order=desc", "sort=last_assessment", "org_unit=Demo Unit North"):
    call(C1, "GET", f"/cases?{qs}", 200)
call(C1, "GET", "/cases?sort=bad", 422)
call(C1, "GET", "/cases?page=0", 422)
call(A, "GET", "/cases", 200)
call(B1, "GET", "/cases", 403)
prof = call(C1, "GET", f"/cases/{nid}", 200)
check(len(prof["timeline"]) == 2 and prof["notes"] == [] and prof["latest_explanation"], "case profile aggregate")
call(C2, "GET", f"/cases/{nid}", 404)
call(A, "GET", f"/cases/{nid}", 403)
call(B1, "GET", f"/cases/{nid}", 403)
call(C1, "PATCH", f"/cases/{nid}/status", 200, json={"case_status": "monitoring"})
call(C1, "PATCH", f"/cases/{nid}/status", 422, json={"case_status": "nope"})
call(C2, "PATCH", f"/cases/{nid}/status", 404, json={"case_status": "closed"})
check(scalar("select case_status from beneficiaries where id=?", nid) == "monitoring", "DB: status persisted")
call(C1, "POST", f"/cases/{nid}/notes", 201, json={"body": "Audit note"})
call(C1, "POST", f"/cases/{nid}/notes", 422, json={"body": ""})
call(C2, "POST", f"/cases/{nid}/notes", 404, json={"body": "x"})
check(scalar("select count(*) from case_notes where beneficiary_id=?", nid) == 1, "DB: note persisted")
call(C1, "POST", f"/cases/{nid}/assign", 403, json={"caseworker_id": cw1_id})
call(A, "POST", f"/cases/{nid}/assign", 404, json={"caseworker_id": 999999})
check(call(A, "POST", f"/cases/{nid}/assign", 200, json={"caseworker_id": cw1_id})["changed"] is False, "assign idempotent")
cw2_id = next(x["id"] for x in cws if x["name"].startswith("Demo Caseworker B"))
check(call(A, "POST", f"/cases/{nid}/assign", 200, json={"caseworker_id": cw2_id})["changed"] is True, "reassign")
call(C2, "GET", f"/cases/{nid}", 200)
call(C1, "GET", f"/cases/{nid}", 404)
check(scalar("select count(*) from case_assignments where beneficiary_id=? and active is true", nid) == 1, "DB: single active assignment")
call(A, "POST", f"/cases/{nid}/assign", 200, json={"caseworker_id": cw1_id})

# ---------------------------------------------------------------- alerts
al = call(C1, "GET", "/alerts?status=open", 200)
mine = [x for x in al if x["beneficiary_id"] == nid]
check(mine and mine[0]["level"] == "urgent", "alert visible to assigned caseworker")
call(C2, "GET", "/alerts", 200)
call(B1, "GET", "/alerts", 403)
call(C1, "PATCH", f"/alerts/{mine[0]['id']}", 200, json={"status": "acknowledged"})
call(C1, "PATCH", f"/alerts/{mine[0]['id']}", 200, json={"status": "resolved"})
call(C1, "PATCH", f"/alerts/{mine[0]['id']}", 422, json={"status": "bogus"})
call(C1, "PATCH", "/alerts/999999", 404, json={"status": "resolved"})
check(scalar("select status from review_alerts where id=?", mine[0]["id"]) == "resolved", "DB: alert resolved")

# ---------------------------------------------------------------- follow-ups
fu_req = call(BT, "GET", "/followups?status=requested", 200)["items"]
check(len(fu_req) == 1, "beneficiary sees own request")
call(BT, "POST", "/followups", 409, json={"reason": "again"})
when = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
call(C1, "PATCH", f"/followups/{fu_req[0]['id']}", 200, json={"scheduled_for": when})
check(scalar("select status from follow_ups where id=?", fu_req[0]["id"]) == "scheduled", "DB: request scheduled")
fu = call(C1, "POST", "/followups", 201, json={"beneficiary_id": nid, "scheduled_for": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "kind": "home_visit"})
call(C1, "POST", "/followups", 422, json={"beneficiary_id": nid})
call(C2, "POST", "/followups", 404, json={"beneficiary_id": nid, "scheduled_for": when})
call(A, "POST", "/followups", 403, json={"beneficiary_id": nid, "scheduled_for": when})
ov = call(C1, "GET", "/followups?overdue=true", 200)["items"]
check(any(f["id"] == fu["id"] and f["is_overdue"] for f in ov), "overdue detection")
call(C1, "GET", "/followups?due_within_days=7&status=scheduled&beneficiary_id=%d&page=1&page_size=5" % nid, 200)
call(A, "GET", "/followups", 403)
call(B2, "PATCH", f"/followups/{fu['id']}", 404, json={"status": "cancelled"})
call(BT, "PATCH", f"/followups/{fu['id']}", 403, json={"status": "cancelled"})
call(C1, "POST", f"/followups/{fu['id']}/complete", 200, json={"outcome_notes": "done"})
call(C1, "POST", f"/followups/{fu['id']}/complete", 409, json={})
call(C1, "PATCH", f"/followups/{fu['id']}", 409, json={"status": "cancelled"})
call(C1, "POST", "/followups/999999/complete", 404, json={})
check(scalar("select status from follow_ups where id=?", fu["id"]) == "completed", "DB: follow-up completed")
# beneficiary cancels own request
reqb = call(B2, "POST", "/followups", (201, 409), json={"reason": "talk"})
if reqb and "id" in reqb:
    call(B2, "PATCH", f"/followups/{reqb['id']}", 200, json={"status": "cancelled"})

# ---------------------------------------------------------------- interventions
call(C1, "GET", "/interventions/types", 200)
call(B1, "GET", "/interventions/types", 403)
iv = call(C1, "POST", "/interventions", 201, json={"beneficiary_id": nid, "type": "home_visit", "description": "Audit visit"})
call(C1, "POST", "/interventions", 422, json={"beneficiary_id": nid, "type": "home_visit", "description": "x", "outcome": "bogus"})
call(C2, "POST", "/interventions", 404, json={"beneficiary_id": nid, "type": "home_visit", "description": "x"})
call(C1, "PATCH", f"/interventions/{iv['id']}/outcome", 200, json={"outcome": "improved"})
call(C2, "PATCH", f"/interventions/{iv['id']}/outcome", 404, json={"outcome": "improved"})
call(C1, "PATCH", "/interventions/999999/outcome", 404, json={"outcome": "improved"})
check(scalar("select outcome from interventions where id=?", iv["id"]) == "improved", "DB: outcome persisted")
check(any(i["id"] == iv["id"] for i in call(C1, "GET", f"/interventions?beneficiary_id={nid}&outcome=improved", 200)), "intervention list filter")
call(A, "GET", "/interventions", 403)

# ---------------------------------------------------------------- analytics
s = call(C1, "GET", "/analytics/caseworker-summary", 200)
check(s["assigned_beneficiaries"] >= 6 and s["urgent_notifications"] >= 0, "caseworker summary")
call(A, "GET", "/analytics/caseworker-summary", 403)
ovw = call(A, "GET", "/analytics/overview?org_unit=Demo Unit North&from_date=2026-01-01&to_date=2026-12-31", 200)
check("BEN-" not in str(ovw) and "audit" not in str(ovw).lower(), "overview has no identifiers")
call(A, "GET", "/analytics/trends", 200)
call(A, "GET", "/analytics/overview?from_date=notadate", 422)
call(C1, "GET", "/analytics/overview", 403)
call(B1, "GET", "/analytics/trends", 403)

# ---------------------------------------------------------------- self-service
call(B1, "GET", "/resources?category=emergency", 200)
call(C1, "GET", "/resources", 200)
call(None, "GET", "/resources", 401)
call(BT, "POST", "/me/consents", 201, json={"consent_type": "analytics_use", "granted": True})
call(BT, "POST", "/me/consents", 422, json={"consent_type": "bogus", "granted": True})
check(call(BT, "GET", "/me/consents", 200)["current"]["analytics_use"] is True, "consent state")
call(C1, "GET", "/me/consents", 403)
call(BT, "PATCH", f"/beneficiaries/{nid}", 200, json={"preferred_language": "Tamil", "org_unit": "HACK"})
check(scalar("select org_unit from beneficiaries where id=?", nid) == "Demo Unit North", "beneficiary cannot change org_unit")
ex_ = call(BT, "GET", "/me/export", 200)
check(len(ex_["assessments"]) == 2 and "priority_level" not in str(ex_), "export complete, no review level")

# ---------------------------------------------------------------- password + logout
call(BT, "POST", "/auth/change-password", 400, json={"current_password": "bad", "new_password": "Audit-pass-3"})
call(BT, "POST", "/auth/change-password", 422, json={"current_password": "Audit-pass-1", "new_password": "12345678"})
call(BT, "POST", "/auth/change-password", 204, json={"current_password": "Audit-pass-1", "new_password": "Audit-pass-3"})
call(BT, "GET", "/auth/me", 401)
BT = login("audit_ben", "Audit-pass-3")
call(BT, "POST", "/auth/logout", 204)
call(BT, "GET", "/auth/me", 401)
BT = login("audit_ben", "Audit-pass-3")

# lockout on a throwaway account
for _ in range(5):
    c.post("/api/auth/login", json={"username": "audit_reg", "password": "bad-pass-99"})
check(c.post("/api/auth/login", json={"username": "audit_reg", "password": "Audit-pass-1"}).status_code == 429, "lockout after 5 failures")

# ---------------------------------------------------------------- deletion / retention / audit log
call(BT, "POST", "/me/deletion-request", 200)
dr = call(A, "GET", "/admin/deletion-requests", 200)
check(any(d["beneficiary_id"] == nid for d in dr), "deletion request visible")
call(C1, "GET", "/admin/deletion-requests", 403)
call(A, "POST", "/admin/retention/run", 200)
call(C1, "POST", "/admin/retention/run", 403)
logs = call(A, "GET", "/admin/audit-logs?action=assessment_submitted&page_size=5", 200)
check(logs["total"] >= 2, "audit log recorded submissions")
call(A, "GET", "/admin/audit-logs?actor_user_id=1&page=1", 200)
call(C1, "GET", "/admin/audit-logs", 403)
check(scalar("select count(*) from audit_logs where detail like '%Audit-pass%' or detail like '%audit free text%'") == 0, "audit log contains no secrets/answers")
call(C1, "DELETE", f"/admin/beneficiaries/{nid}", 403)
call(A, "DELETE", "/admin/beneficiaries/999999", 404)

# ---------------------------------------------------------------- hand over to phase 2 (run after restarting the server)
print(f"PHASE1 passed={passed} failed={len(fails)} (erasure + restart persistence checked in phase 2)")
with open("audit_state.txt", "w") as f:
    f.write(f"{nid},{aid},{reg_id},{uid}")

# ---------------------------------------------------------------- coverage vs openapi
spec = c.get("/openapi.json").json()
missing = []
for path, ops in spec["paths"].items():
    for m in ops:
        key = (m.upper(), re.sub(r"\{[^}]+\}", "{id}", path[4:] if path.startswith("/api") else path))
        if key not in covered and path.startswith("/api"):
            missing.append(f"{m.upper()} {path}")
print("Endpoints in OpenAPI:", sum(len(v) for k, v in spec["paths"].items() if k.startswith("/api")), "| not exercised:", missing or "none")
for f_ in fails:
    print("FAIL:", f_)
sys.exit(1 if fails else 0)
