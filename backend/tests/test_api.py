"""Integration tests: auth, RBAC, assessment workflow, case management, analytics, privacy."""
import os
from datetime import timedelta

from sqlalchemy import select

from app.database import utcnow
from app.models import Assessment, AuditLog, Beneficiary, User
from tests.conftest import BEN_PW, CW_PW, login
from tests.test_engine import answers_with_concern


def _ben_id(db, username):
    return db.scalar(select(Beneficiary.id).join(User, User.id == Beneficiary.user_id).where(User.username == username))


# ------------------------------------------------------------------ seed
def test_seed_meets_requirements(_db, db):
    assert _db["beneficiaries"] >= 25
    assert _db["assessments"] >= 50
    assert db.scalar(select(User.id).where(User.username == "caseworker5")) is not None
    assert db.query(User).filter(User.is_synthetic.is_(False)).count() == 0  # everything seeded is flagged synthetic


# ------------------------------------------------------------------ auth
def test_login_and_me(client):
    h = login(client, "caseworker1", CW_PW)
    r = client.get("/api/auth/me", headers=h)
    assert r.status_code == 200 and r.json()["role"] == "caseworker"
    assert "password" not in r.text


def test_bad_login_and_no_token(client):
    assert client.post("/api/auth/login", json={"username": "admin", "password": "wrong"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_account_lockout(client):
    for _ in range(5):
        client.post("/api/auth/login", json={"username": "ben025", "password": "nope"})
    r = client.post("/api/auth/login", json={"username": "ben025", "password": BEN_PW})
    assert r.status_code == 429


def test_logout_invalidates_token(client):
    h = login(client, "ben024", BEN_PW)
    assert client.get("/api/auth/me", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_password_hashes_not_plaintext(db):
    u = db.scalar(select(User).where(User.username == "admin"))
    assert u.password_hash.startswith("$2") and "Admin" not in u.password_hash


def test_registration_requires_valid_invitation_and_consent(client):
    body = {"invite_code": "WRONGCODE1", "username": "newperson", "password": "Passw0rd-new", "display_name": "New Person",
            "consent_privacy": True, "consent_assessment": True}
    assert client.post("/api/auth/register", json=body).status_code == 400
    body["invite_code"] = os.environ["_DEMO_INVITE"]
    assert client.post("/api/auth/register", json={**body, "consent_privacy": False}).status_code == 422
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 201 and r.json()["user"]["role"] == "beneficiary"
    assert client.post("/api/auth/register", json={**body, "username": "another"}).status_code == 400  # code is single-use


def test_change_password(client):
    h = login(client, "ben023", BEN_PW)
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "bad", "new_password": "NewPass-123"}).status_code == 400
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": BEN_PW, "new_password": "NewPass-123"}).status_code == 204
    assert client.post("/api/auth/login", json={"username": "ben023", "password": "NewPass-123"}).status_code == 200


# ------------------------------------------------------------------ RBAC
def test_role_restrictions(client, admin_h, cw1_h, ben_h):
    assert client.get("/api/admin/users", headers=cw1_h).status_code == 403
    assert client.get("/api/admin/users", headers=ben_h).status_code == 403
    assert client.get("/api/admin/audit-logs", headers=cw1_h).status_code == 403
    assert client.get("/api/analytics/overview", headers=cw1_h).status_code == 403
    assert client.get("/api/cases", headers=ben_h).status_code == 403
    assert client.get("/api/analytics/caseworker-summary", headers=admin_h).status_code == 403
    assert client.get("/api/admin/users", headers=admin_h).status_code == 200


def test_caseworker_only_sees_assigned_cases(client, db, cw1_h, cw2_h):
    mine = client.get("/api/cases?page_size=100", headers=cw1_h).json()
    assert mine["total"] >= 5 and all(c["caseworker_name"].startswith("Demo Caseworker A") for c in mine["items"])
    ben001 = _ben_id(db, "ben001")
    assert client.get(f"/api/cases/{ben001}", headers=cw1_h).status_code == 200
    assert client.get(f"/api/cases/{ben001}", headers=cw2_h).status_code == 404  # existence not disclosed
    assert client.get(f"/api/assessments?beneficiary_id={ben001}", headers=cw2_h).status_code == 404
    assert client.post("/api/cases/%d/notes" % ben001, headers=cw2_h, json={"body": "x"}).status_code == 404
    assert client.patch(f"/api/cases/{ben001}/status", headers=cw2_h, json={"case_status": "closed"}).status_code == 404


def test_admin_cannot_read_clinical_content(client, db, admin_h):
    ben001 = _ben_id(db, "ben001")
    aid = db.scalar(select(Assessment.id).where(Assessment.beneficiary_id == ben001))
    assert client.get(f"/api/assessments/{aid}", headers=admin_h).status_code == 403
    assert client.get(f"/api/cases/{ben001}", headers=admin_h).status_code == 403
    roster = client.get("/api/cases", headers=admin_h).json()["items"][0]
    assert "latest" not in roster  # roster has no clinical fields for admins


def test_beneficiary_cannot_read_others(client, db, ben_h):
    other = _ben_id(db, "ben002")
    aid = db.scalar(select(Assessment.id).where(Assessment.beneficiary_id == other))
    assert client.get(f"/api/assessments/{aid}", headers=ben_h).status_code == 404
    assert client.get(f"/api/beneficiaries/{other}", headers=ben_h).status_code == 404


def test_beneficiary_never_sees_review_level(client, ben_h):
    hist = client.get("/api/assessments", headers=ben_h).json()
    assert hist and all("priority_level" not in a and "overall_score" not in a for a in hist)
    assert "wellbeing_index" in hist[-1]
    aid = hist[-1]["id"]
    assert client.get(f"/api/assessments/{aid}/explanation", headers=ben_h).status_code == 403


# ------------------------------------------------------------------ assessment workflow
def _answers(**kw):
    a = answers_with_concern(0)
    a.update(kw)
    a["chg_1"] = 2
    return a


def test_assessment_validation_and_resume(client):
    h = login(client, "ben010", BEN_PW)
    assert client.post("/api/assessments", headers=h, json={"consent_confirmed": False}).status_code == 422
    r = client.post("/api/assessments", headers=h, json={"consent_confirmed": True})
    aid = r.json()["id"]
    assert client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": {"emo_1": 99}}).status_code == 422
    assert client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": {"nope": 1}}).status_code == 422
    assert client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": {"emo_1": 2}}).status_code == 200
    draft = client.get("/api/assessments/draft", headers=h).json()["draft"]
    assert draft["id"] == aid and draft["answers"]["emo_1"] == 2
    assert client.post("/api/assessments", headers=h, json={"consent_confirmed": True}).json()["resumed"] is True
    sub = client.post(f"/api/assessments/{aid}/submit", headers=h)
    assert sub.status_code == 422 and sub.json()["detail"]["missing"]


def test_full_assessment_routine(client, db):
    h = login(client, "ben011", BEN_PW)
    aid = client.post("/api/assessments", headers=h, json={"consent_confirmed": True}).json()["id"]
    client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": {**_answers(), "text_1": "all fine"}})
    r = client.post(f"/api/assessments/{aid}/submit", headers=h)
    assert r.status_code == 200 and r.json()["show_support_now"] is False
    assert client.post(f"/api/assessments/{aid}/submit", headers=h).status_code == 409
    assert client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": {"emo_1": 1}}).status_code == 409
    a = db.get(Assessment, aid)
    assert a.score.priority_level == "routine" and a.score.engine_version and a.score.factors


def test_urgent_assessment_creates_alert_and_shows_resources(client, db):
    h = login(client, "ben012", BEN_PW)  # assigned to caseworker2
    aid = client.post("/api/assessments", headers=h, json={"consent_confirmed": True}).json()["id"]
    client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": _answers(safe_self=1)})
    r = client.post(f"/api/assessments/{aid}/submit", headers=h).json()
    assert r["show_support_now"] is True and any(x["title"] for x in r["support_resources"])
    assert "priority_level" not in r
    cw = login(client, "caseworker2", CW_PW)
    alerts = client.get("/api/alerts?status=open", headers=cw).json()
    mine = [a for a in alerts if a["assessment_id"] == aid]
    assert mine and mine[0]["level"] == "urgent" and "self-harm" in mine[0]["reason"].lower()
    expl = client.get(f"/api/assessments/{aid}/explanation", headers=cw).json()
    assert expl["priority_level"] == "urgent" and any(f["code"] == "critical_self_harm_item" for f in expl["factors"])
    assert "not diagnoses" in expl["disclaimer"]
    assert client.patch(f"/api/alerts/{mine[0]['id']}", headers=cw, json={"status": "resolved"}).json()["status"] == "resolved"
    cmp = client.get(f"/api/assessments/{aid}/compare", headers=cw).json()
    assert cmp["previous"] is not None and "overall_delta" in cmp


def test_help_request_creates_followup_request(client):
    h = login(client, "ben013", BEN_PW)
    aid = client.post("/api/assessments", headers=h, json={"consent_confirmed": True}).json()["id"]
    client.put(f"/api/assessments/{aid}/responses", headers=h, json={"answers": _answers(help_1=2)})
    client.post(f"/api/assessments/{aid}/submit", headers=h)
    fus = client.get("/api/followups?status=requested", headers=h).json()["items"]
    assert fus and fus[0]["requested_by_beneficiary"]


# ------------------------------------------------------------------ follow-ups, interventions, notes
def test_followup_and_intervention_flow(client, db, cw1_h, ben_h):
    ben001 = _ben_id(db, "ben001")
    when = (utcnow() + timedelta(days=3)).isoformat()
    r = client.post("/api/followups", headers=cw1_h, json={"beneficiary_id": ben001, "scheduled_for": when, "kind": "home_visit"})
    assert r.status_code == 201 and r.json()["status"] == "scheduled"
    fid = r.json()["id"]
    assert client.post("/api/followups", headers=cw1_h, json={"beneficiary_id": ben001}).status_code == 422  # needs date
    assert client.post(f"/api/followups/{fid}/complete", headers=cw1_h, json={"outcome_notes": "ok"}).json()["status"] == "completed"
    assert client.post(f"/api/followups/{fid}/complete", headers=cw1_h, json={}).status_code == 409
    assert any(f["id"] == fid for f in client.get("/api/followups?status=completed&page_size=100", headers=ben_h).json()["items"])
    iv = client.post("/api/interventions", headers=cw1_h, json={"beneficiary_id": ben001, "type": "home_visit", "description": "Visit"})
    assert iv.status_code == 201
    out = client.patch(f"/api/interventions/{iv.json()['id']}/outcome", headers=cw1_h, json={"outcome": "improved"})
    assert out.json()["outcome"] == "improved"
    n = client.post(f"/api/cases/{ben001}/notes", headers=cw1_h, json={"body": "Spoke today."})
    assert n.status_code == 201
    assert client.patch(f"/api/cases/{ben001}/status", headers=cw1_h, json={"case_status": "monitoring"}).json()["case_status"] == "monitoring"
    assert client.patch(f"/api/cases/{ben001}/status", headers=cw1_h, json={"case_status": "bogus"}).status_code == 422


def test_beneficiary_requests_followup_once(client):
    h = login(client, "ben020", BEN_PW)
    first = client.post("/api/followups", headers=h, json={"reason": "Would like to talk"})
    assert first.status_code in (201, 409)  # seed data may already contain an open request
    assert client.post("/api/followups", headers=h, json={}).status_code == 409


def test_case_list_filters_sorting_pagination(client, cw1_h):
    r = client.get("/api/cases?page_size=2&page=1&sort=priority", headers=cw1_h).json()
    assert len(r["items"]) == 2 and r["total"] >= 5
    ranks = {"urgent": 0, "attention": 1, "routine": 2, None: 3}
    allc = client.get("/api/cases?page_size=100&sort=priority", headers=cw1_h).json()["items"]
    order = [ranks[(c["latest"] or {}).get("priority_level")] for c in allc]
    assert order == sorted(order)
    q = client.get("/api/cases?q=BEN-00001", headers=cw1_h).json()
    assert q["total"] == 1
    assert client.get("/api/cases?sort=bad", headers=cw1_h).status_code == 422


def test_caseworker_dashboard_summary(client, cw1_h):
    s = client.get("/api/analytics/caseworker-summary", headers=cw1_h).json()
    assert s["assigned_beneficiaries"] >= 5
    for k in ("assessments_completed", "assessments_pending", "awaiting_review", "urgent_notifications", "followups_due_7d", "followups_overdue", "recent_activity"):
        assert k in s


# ------------------------------------------------------------------ admin, analytics, privacy
def test_admin_analytics_is_aggregate_only(client, admin_h):
    o = client.get("/api/analytics/overview", headers=admin_h).json()
    assert o["total_beneficiaries"] >= 25
    txt = str(o)
    assert "BEN-" not in txt and "Participant" not in txt and "username" not in txt
    assert o["privacy"]["min_cell_size"] == 3
    u = client.get("/api/analytics/overview?org_unit=Demo Unit North", headers=admin_h).json()
    assert 5 <= u["total_beneficiaries"] <= o["total_beneficiaries"]


def test_small_cell_suppression(client, admin_h):
    o = client.get("/api/analytics/overview?org_unit=Demo Unit North", headers=admin_h).json()
    for v in o["priority_distribution"].values():
        assert v is None or v == 0 or v >= 3


def test_admin_user_management(client, admin_h):
    r = client.post("/api/admin/users", headers=admin_h, json={"username": "cw_new", "display_name": "New CW", "password": "Passw0rd-xy", "role": "caseworker", "org_unit": "Demo Unit North"})
    assert r.status_code == 201
    uid = r.json()["id"]
    assert client.post("/api/admin/users", headers=admin_h, json={"username": "cw_new", "display_name": "x", "password": "Passw0rd-xy", "role": "admin"}).status_code == 409
    assert client.post("/api/admin/users", headers=admin_h, json={"username": "weak1", "display_name": "x", "password": "short", "role": "admin"}).status_code == 422
    assert client.patch(f"/api/admin/users/{uid}", headers=admin_h, json={"is_active": False}).json()["is_active"] is False
    assert client.post("/api/auth/login", json={"username": "cw_new", "password": "Passw0rd-xy"}).status_code == 401
    me = client.get("/api/auth/me", headers=admin_h).json()
    assert client.patch(f"/api/admin/users/{me['id']}", headers=admin_h, json={"is_active": False}).status_code == 409


def test_assignment_and_engine_config(client, db, admin_h, cw1_h):
    ben = _ben_id(db, "ben005")  # initially caseworker5's
    cws = client.get("/api/admin/caseworkers", headers=admin_h).json()
    target = next(c for c in cws if c["name"].startswith("Demo Caseworker A"))
    assert client.post(f"/api/cases/{ben}/assign", headers=admin_h, json={"caseworker_id": target["id"]}).json()["changed"] is True
    assert client.get(f"/api/cases/{ben}", headers=cw1_h).status_code == 200
    assert client.post(f"/api/cases/{ben}/assign", headers=cw1_h, json={"caseworker_id": target["id"]}).status_code == 403
    bad = client.put("/api/admin/engine-config", headers=admin_h, json={"attention_overall": 90, "urgent_overall": 50})
    assert bad.status_code == 422
    ok = client.put("/api/admin/engine-config", headers=admin_h, json={"attention_overall": 42})
    assert ok.json()["config"]["attention_overall"] == 42
    client.put("/api/admin/engine-config", headers=admin_h, json={"attention_overall": 40})


def test_resource_management_and_visibility(client, admin_h, ben_h, cw1_h):
    r = client.post("/api/admin/resources", headers=admin_h, json={"title": "Local desk", "category": "emergency", "summary": "s", "contact": "100", "is_verified": True})
    assert r.status_code == 201
    rid = r.json()["id"]
    assert any(x["id"] == rid for x in client.get("/api/resources?category=emergency", headers=ben_h).json())
    assert client.post("/api/admin/resources", headers=cw1_h, json={"title": "x", "category": "support", "summary": "s"}).status_code == 403
    assert client.delete(f"/api/admin/resources/{rid}", headers=admin_h).status_code == 204


def test_audit_log_records_sensitive_access_without_content(client, db, admin_h, cw1_h):
    ben001 = _ben_id(db, "ben001")
    client.get(f"/api/cases/{ben001}", headers=cw1_h)
    logs = client.get("/api/admin/audit-logs?action=case_viewed&page_size=50", headers=admin_h).json()
    assert logs["total"] >= 1 and any(l["entity_id"] == ben001 for l in logs["items"])
    assert not db.scalar(select(AuditLog.id).where(AuditLog.detail.ilike("%password%")))


def test_consent_export_and_erasure(client, db, admin_h):
    h = login(client, "ben021", BEN_PW)
    assert client.post("/api/me/consents", headers=h, json={"consent_type": "analytics_use", "granted": False}).status_code == 201
    assert client.get("/api/me/consents", headers=h).json()["current"]["analytics_use"] is False
    exp = client.get("/api/me/export", headers=h).json()
    assert exp["assessments"] and "priority_level" not in str(exp)
    assert client.post("/api/me/deletion-request", headers=h).status_code == 200
    ben = _ben_id(db, "ben021")
    assert any(d["beneficiary_id"] == ben for d in client.get("/api/admin/deletion-requests", headers=admin_h).json())
    assert client.delete(f"/api/admin/beneficiaries/{ben}", headers=admin_h).status_code == 204
    db.expire_all()
    assert db.get(Beneficiary, ben) is None
    assert db.scalar(select(User.id).where(User.username == "ben021")) is None
    assert db.scalar(select(Assessment.id).where(Assessment.beneficiary_id == ben)) is None
    assert client.post("/api/auth/login", json={"username": "ben021", "password": BEN_PW}).status_code == 401


def test_retention_job(client, admin_h):
    r = client.post("/api/admin/retention/run", headers=admin_h)
    assert r.status_code == 200 and "purged_free_text_answers" in r.json()


def test_health_and_security_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.headers["x-content-type-options"] == "nosniff"
    assert client.get("/openapi.json").status_code == 200  # Swagger schema is served at the root, UI at /docs


def test_validation_errors_are_structured(client):
    r = client.post("/api/auth/login", json={"username": ""})
    assert r.status_code == 422 and r.json()["errors"]


# ------------------------------------------------------------------ demo mode
def test_demo_login_is_off_by_default(client):
    assert client.get("/api/auth/config").json() == {"demo_mode": False}
    assert client.post("/api/auth/demo-login", json={"role": "admin"}).status_code == 404


def test_demo_login_only_reaches_synthetic_accounts(client, db, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    assert client.get("/api/auth/config").json() == {"demo_mode": True}
    for role in ("beneficiary", "caseworker", "admin"):
        r = client.post("/api/auth/demo-login", json={"role": role})
        assert r.status_code == 200 and r.json()["user"]["role"] == role and r.json()["user"]["is_synthetic"] is True
        assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200
    assert client.post("/api/auth/demo-login", json={"role": "superuser"}).status_code == 422
    # a non-synthetic account with the demo username must be refused
    u = db.scalar(select(User).where(User.username == "ben001"))
    u.is_synthetic = False
    db.commit()
    try:
        assert client.post("/api/auth/demo-login", json={"role": "beneficiary"}).status_code == 404
    finally:
        u.is_synthetic = True
        db.commit()
    assert db.query(AuditLog).filter(AuditLog.action == "demo_login").count() >= 3


def test_demo_mode_protects_shared_demo_accounts(client, db, monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    tok = client.post("/api/auth/demo-login", json={"role": "beneficiary"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    other = client.post("/api/auth/demo-login", json={"role": "beneficiary"}).json()["access_token"]
    assert client.post("/api/auth/logout", headers=h).status_code == 204
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {other}"}).status_code == 200  # other visitors stay signed in
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "x", "new_password": "Whatever-1"}).status_code == 403
    admin = {"Authorization": "Bearer " + client.post("/api/auth/demo-login", json={"role": "admin"}).json()["access_token"]}
    ben_user = db.scalar(select(User).where(User.username == "ben001"))
    assert client.patch(f"/api/admin/users/{ben_user.id}", headers=admin, json={"is_active": False}).status_code == 403
    ben = db.scalar(select(Beneficiary).where(Beneficiary.user_id == ben_user.id))
    assert client.delete(f"/api/admin/beneficiaries/{ben.id}", headers=admin).status_code == 403
