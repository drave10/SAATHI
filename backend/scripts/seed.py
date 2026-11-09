"""Seed the SYNTHETIC demonstration environment.

Usage (from backend/):  python -m scripts.seed --reset
Credentials come from environment variables (see .env.example): SEED_ADMIN_PASSWORD, SEED_CASEWORKER_PASSWORD,
SEED_BENEFICIARY_PASSWORD. Nothing here is real: names are generic labels and answers come from engine/synthetic.py.
"""
from __future__ import annotations

import argparse
import secrets
import sys
from datetime import timedelta

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base, SessionLocal, engine, utcnow
from app.engine.config import EngineConfig
from app.engine.synthetic import answers_from_latent, latent_trajectory
from app.models import (Assessment, AssessmentResponse, AuditLog, Beneficiary, CaseAssignment, CaseNote, Caseworker, ConsentRecord,
                        FollowUp, Intervention, Invitation, ReviewAlert, Resource, User)
from app.security import hash_code, hash_password
from app.services.assessment_service import finalize_assessment
from app.services.settings_service import set_setting

ORG_UNITS = ["Demo Unit North", "Demo Unit South", "Demo Unit East", "Demo Unit West", "Demo Unit Central"]
PROFILES = (["stable_low"] * 8 + ["stable_mid"] * 4 + ["stable_high"] * 2 + ["improving"] * 4 + ["declining"] * 5 + ["volatile"] * 2)
# Optional friendlier display names for specific demo beneficiaries (number -> name). Usernames/codes are unchanged.
NAME_OVERRIDES = {1: "Debashish"}
LANGS = ["English", "Hindi", "Marathi", "Tamil", "Bengali"]
AGE_BANDS = ["18-24", "25-34", "35-44", "45-59", "60+"]
SYN_TEXT = ["(synthetic) Sleeping a little better this week.", "(synthetic) Worried about the upcoming hearing date.",
            "(synthetic) Would like a visit sometime next week.", "(synthetic) Nothing else to add."]
NOTES = ["(synthetic) Initial contact made; rapport building in progress.", "(synthetic) Discussed sleep routine and local support group options.",
         "(synthetic) Beneficiary reports improved access to community support.", "(synthetic) Agreed next check-in; shared helpline information.",
         "(synthetic) Reviewed latest check-in together; no immediate concerns raised."]
INT_TYPES = ["counselling_session", "home_visit", "phone_check_in", "referral_health", "referral_legal_aid",
             "referral_social_support", "community_support_group", "safety_planning"]
RESOURCES = [
    ("education", "Understanding stress and how the body responds", "Plain-language overview of common stress reactions and why they happen.",
     "Stress reactions such as trouble sleeping, irritability or feeling on edge are common after very difficult experiences. They are not a sign of weakness. Small routines — regular meals, gentle movement, daylight, and time with people you trust — can help. If these feelings are getting in the way of daily life, speak with your support worker.", None),
    ("education", "Sleep routines that can help", "Simple, practical steps for winding down and improving rest.",
     "Try to keep regular sleep and wake times, limit screens and caffeine late in the day, and keep your sleeping space as calm and dark as you can. If worries keep you awake, writing them down earlier in the evening can help. Persistent sleep difficulty is worth mentioning to your support worker.", None),
    ("education", "Grounding exercises for difficult moments", "A short breathing and grounding technique you can use anywhere.",
     "Slowly breathe in for four counts and out for six. Notice five things you can see, four you can touch, three you can hear. Repeat until the intensity eases. These techniques are coping tools, not a treatment.", None),
    ("education", "Talking to someone you trust", "Ideas for reaching out when things feel heavy.",
     "You do not need the perfect words. Something like 'I have been finding things hard lately and would like to talk' is enough. Your support worker is available if you would like help starting that conversation.", None),
    ("education", "About your privacy in SAATHI", "How your check-in information is used and who can see it.",
     "Your answers are visible to your authorised support worker. Administrators only see aggregated statistics. You can change your consent choices, export your data, or request deletion in Settings & Privacy.", None),
    ("education", "Taking care of yourself day to day", "Everyday habits that support well-being.",
     "Eat regularly, move your body in ways you enjoy, spend time outdoors, and keep contact with supportive people. Be patient with yourself — recovery is not a straight line.", None),
    ("support", "Tele-MANAS national mental health helpline", "Free tele-counselling support (national programme).",
     "Placeholder entry seeded for the demo. An administrator must verify the number and hours before real-world use.", "14416"),
    ("support", "Local legal aid and rehabilitation desk (demo)", "Sample entry — replace with your district's verified service.",
     "Replace this entry with the verified contact details of the legal-aid and rehabilitation service for your district.", "(configure in Admin → Resources)"),
    ("support", "Community support group (demo)", "Sample peer-support group entry.",
     "Replace with details of verified local peer-support groups.", "(configure in Admin → Resources)"),
    ("emergency", "National emergency number", "If you or someone else is in immediate danger.",
     "Placeholder entry seeded for the demo. An administrator must verify before real-world use.", "112"),
    ("emergency", "Tele-MANAS 24x7 helpline", "Talk to a trained counsellor at any time.",
     "Placeholder entry seeded for the demo. An administrator must verify before real-world use.", "14416"),
    ("emergency", "Your support worker", "Contact your assigned support worker directly.",
     "Use the contact method agreed with your support worker. Administrators can add a local desk number here.", "(configure in Admin → Resources)"),
]


def _add_responses(db: Session, a: Assessment, answers: dict, text_note: str | None):
    for qid, v in answers.items():
        db.add(AssessmentResponse(assessment_id=a.id, question_id=qid, value_int=int(v)))
    if text_note:
        db.add(AssessmentResponse(assessment_id=a.id, question_id="text_1", value_text=text_note))
    db.flush()
    db.refresh(a)


def seed(db: Session, *, admin_pw: str, cw_pw: str, ben_pw: str, admin_username: str = "admin", seed_value: int = 2026) -> dict:
    rng = np.random.default_rng(seed_value)
    now = utcnow()
    cfg = EngineConfig()
    set_setting(db, "engine_config", cfg.to_dict(), None)

    admin = User(username=admin_username, display_name="Demo Administrator (synthetic)", password_hash=hash_password(admin_pw), role="admin", is_synthetic=True)
    db.add(admin)
    cws: list[Caseworker] = []
    for i in range(5):
        u = User(username=f"caseworker{i+1}", display_name=f"Demo Caseworker {chr(65+i)} (synthetic)", password_hash=hash_password(cw_pw), role="caseworker", is_synthetic=True)
        db.add(u)
        db.flush()
        cw = Caseworker(user_id=u.id, org_unit=ORG_UNITS[i], is_synthetic=True)
        db.add(cw)
        cws.append(cw)
    db.flush()

    for cat, title, summary, body, contact in RESOURCES:
        db.add(Resource(title=title, category=cat, summary=summary, body=body, contact=contact, is_verified=False, is_active=True))

    profiles = list(PROFILES)
    rng.shuffle(profiles)
    stats = {"beneficiaries": 0, "assessments": 0, "followups": 0, "interventions": 0, "alerts": 0}
    for i in range(25):
        cw = cws[i % 5]
        u = User(username=f"ben{i+1:03d}", display_name=NAME_OVERRIDES.get(i + 1, f"Participant {i+1:03d}") + " (synthetic)", password_hash=hash_password(ben_pw), role="beneficiary", is_synthetic=True)
        db.add(u)
        db.flush()
        b = Beneficiary(user_id=u.id, code=f"BEN-{i+1:05d}", org_unit=cw.org_unit, age_band=AGE_BANDS[int(rng.integers(0, 5))],
                        preferred_language=LANGS[int(rng.integers(0, 5))], is_synthetic=True, case_status="open",
                        created_at=now - timedelta(days=150))
        db.add(b)
        db.flush()
        db.add(CaseAssignment(beneficiary_id=b.id, caseworker_id=cw.id, assigned_by=admin.id, assigned_at=now - timedelta(days=148)))
        for ctype, granted in (("privacy_notice", True), ("assessment_data", True), ("analytics_use", bool(rng.random() > 0.15))):
            db.add(ConsentRecord(user_id=u.id, consent_type=ctype, granted=granted, created_at=now - timedelta(days=149)))
        stats["beneficiaries"] += 1

        profile = profiles[i]
        n = int(rng.integers(2, 6))
        last_gap_days = int(rng.choice([1, 3, 6, 9, 12, 18, 24]))   # some beneficiaries are overdue for a new check-in
        zs = latent_trajectory(rng, n, profile)
        if profile == "stable_high":
            zs = [max(z, 0.72) for z in zs]
        assessments: list[Assessment] = []
        prev_z = None
        for k, z in enumerate(zs):
            when = now - timedelta(days=last_gap_days + 14 * (n - 1 - k) + int(rng.integers(-1, 2)))
            ans = answers_from_latent(z, rng, missing_rate=0.3 if (i == 7 and k == n - 1) else 0.0)
            dz = 0 if prev_z is None else z - prev_z
            if "chg_1" in ans or True:
                ans["chg_1"] = 4 if dz > 0.25 else 3 if dz > 0.12 else 1 if dz < -0.1 else 2
            prev_z = z
            a = Assessment(beneficiary_id=b.id, status="submitted", questionnaire_version="saathi-proto-1.0", consent_confirmed=True,
                           started_at=when - timedelta(minutes=9), submitted_at=when, is_synthetic=True)
            db.add(a)
            db.flush()
            _add_responses(db, a, ans, SYN_TEXT[int(rng.integers(0, 4))] if rng.random() < 0.25 else None)
            finalize_assessment(db, a, cfg)
            db.flush()
            assessments.append(a)
            stats["assessments"] += 1
        # resolve older alerts / requests; keep the latest ones live (some already acknowledged)
        latest = assessments[-1]
        for a in assessments[:-1]:
            a.score.review_status = "reviewed"
            a.score.reviewed_by, a.score.reviewed_at = cw.user_id, a.submitted_at + timedelta(days=1)
        for al in db.scalars(select(ReviewAlert).where(ReviewAlert.beneficiary_id == b.id)):
            if al.assessment_id != latest.id:
                al.status, al.resolved_at, al.resolved_by = "resolved", al.created_at + timedelta(days=1), cw.user_id
            elif rng.random() < 0.25:
                al.status = "acknowledged"
            stats["alerts"] += 1
        for fu in db.scalars(select(FollowUp).where(FollowUp.beneficiary_id == b.id, FollowUp.status == "requested")):
            if fu.created_at is not None and rng.random() < 0.5:
                fu.status = "scheduled"
                fu.scheduled_for = now + timedelta(days=int(rng.integers(-4, 7)))  # some become overdue
        db.flush()

        # follow-ups: completed history + upcoming / overdue
        for k in range(int(rng.integers(1, 3))):
            when = now - timedelta(days=int(rng.integers(10, 80)))
            db.add(FollowUp(beneficiary_id=b.id, caseworker_id=cw.id, status="completed", kind=str(rng.choice(["check_in", "home_visit", "counselling"])),
                            scheduled_for=when, completed_at=when + timedelta(hours=1), outcome_notes="(synthetic) Follow-up completed.",
                            created_at=when - timedelta(days=5), is_synthetic=True))
            stats["followups"] += 1
        roll = rng.random()
        if roll < 0.5:
            db.add(FollowUp(beneficiary_id=b.id, caseworker_id=cw.id, status="scheduled", kind="check_in", scheduled_for=now + timedelta(days=int(rng.integers(1, 10))), is_synthetic=True))
            stats["followups"] += 1
        elif roll < 0.72:
            db.add(FollowUp(beneficiary_id=b.id, caseworker_id=cw.id, status="scheduled", kind="check_in", scheduled_for=now - timedelta(days=int(rng.integers(1, 6))),
                            created_at=now - timedelta(days=12), is_synthetic=True))  # overdue
            stats["followups"] += 1
        # interventions with outcomes loosely matching trajectory
        outcome_pool = {"improving": ["improved", "improved", "no_change"], "declining": ["no_change", "worsened", "pending", "referred"],
                        "stable_low": ["improved", "no_change"], "stable_mid": ["no_change", "improved", "referred"],
                        "stable_high": ["referred", "no_change", "pending"], "volatile": ["no_change", "pending", "referred"]}[profile]
        for k in range(int(rng.integers(1, 4))):
            t = str(rng.choice(INT_TYPES))
            db.add(Intervention(beneficiary_id=b.id, caseworker_id=cw.id, type=t, description="(synthetic) " + t.replace("_", " ").capitalize() + " provided.",
                                outcome=str(rng.choice(outcome_pool)), outcome_notes="(synthetic) Outcome recorded by caseworker.",
                                occurred_at=now - timedelta(days=int(rng.integers(3, 100))), is_synthetic=True))
            stats["interventions"] += 1
        for k in range(int(rng.integers(1, 3))):
            db.add(CaseNote(beneficiary_id=b.id, author_id=cw.user_id, body=str(rng.choice(NOTES)), created_at=now - timedelta(days=int(rng.integers(1, 90))), is_synthetic=True))
        b.case_status = "follow_up_needed" if latest.score.priority_level == "urgent" else ("monitoring" if latest.score.priority_level == "attention" else "open")

    code = secrets.token_urlsafe(9).upper().replace("-", "X").replace("_", "Y")
    db.add(Invitation(code_hash=hash_code(code), org_unit=ORG_UNITS[0], created_by=admin.id, caseworker_id=cws[0].id, expires_at=now + timedelta(days=30)))
    db.add(AuditLog(actor_user_id=admin.id, actor_role="admin", action="seed_run", detail="synthetic demo data generated"))
    db.commit()
    stats["demo_invitation_code"] = code
    return stats


def reset_database():
    """Drop everything and rebuild the schema via Alembic migrations."""
    from alembic import command
    from alembic.config import Config
    from app.config import BACKEND_DIR
    Base.metadata.drop_all(engine)
    with engine.begin() as c:
        c.execute(text("DROP TABLE IF EXISTS alembic_version"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")


def main(argv=None):
    p = argparse.ArgumentParser(description="Seed SAATHI synthetic demo data")
    p.add_argument("--reset", action="store_true", help="drop all tables, re-run migrations, then seed")
    args = p.parse_args(argv)
    s = get_settings()
    missing = [n for n, v in (("SEED_ADMIN_PASSWORD", s.seed_admin_password), ("SEED_CASEWORKER_PASSWORD", s.seed_caseworker_password),
                              ("SEED_BENEFICIARY_PASSWORD", s.seed_beneficiary_password)) if not v]
    if missing:
        sys.exit(f"Missing environment variables: {', '.join(missing)}. Copy .env.example to .env and set them.")
    if args.reset:
        reset_database()
    with SessionLocal() as db:
        if db.scalar(select(User.id).limit(1)) is not None:
            sys.exit("Database already contains users. Re-run with --reset to wipe and regenerate the demo data.")
        stats = seed(db, admin_pw=s.seed_admin_password, cw_pw=s.seed_caseworker_password, ben_pw=s.seed_beneficiary_password,
                     admin_username=s.seed_admin_username)
    print("Seeded SYNTHETIC demo data:")
    for k, v in stats.items():
        print(f"  {k}: {v}")
    print(f"Logins: {s.seed_admin_username} | caseworker1..caseworker5 | ben001..ben025 (passwords from your .env)")


if __name__ == "__main__":
    main()
