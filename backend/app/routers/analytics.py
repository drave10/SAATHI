"""Dashboards & aggregated analytics. Admin analytics are aggregate-only with small-cell suppression."""
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import deps
from ..config import get_settings
from ..database import get_db, utcnow
from ..deps import require_roles
from ..engine.scoring import wellbeing_index
from ..models import (Assessment, Beneficiary, CaseAssignment, CaseNote, ConsentRecord, FollowUp, Intervention, ReviewAlert, User)
from ..services.cases import case_row
from ..services.settings_service import get_engine_config

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/caseworker-summary")
def caseworker_summary(user: User = Depends(require_roles("caseworker")), db: Session = Depends(get_db)):
    cw = deps.current_caseworker(user, db)
    cfg = get_engine_config(db)
    now = utcnow()
    bens = db.scalars(select(Beneficiary).join(CaseAssignment, CaseAssignment.beneficiary_id == Beneficiary.id).where(
        CaseAssignment.active.is_(True), CaseAssignment.caseworker_id == (cw.id if cw else -1))).all()
    ids = [b.id for b in bens]
    rows = [case_row(db, b, cfg) for b in bens]
    completed = db.scalar(select(func.count()).select_from(Assessment).where(Assessment.beneficiary_id.in_(ids), Assessment.status == "submitted")) or 0
    completed_30 = db.scalar(select(func.count()).select_from(Assessment).where(
        Assessment.beneficiary_id.in_(ids), Assessment.status == "submitted", Assessment.submitted_at >= now - timedelta(days=30))) or 0
    fus = db.scalars(select(FollowUp).where(FollowUp.beneficiary_id.in_(ids))).all() if ids else []
    due_soon = [f for f in fus if f.status == "scheduled" and f.scheduled_for and now <= f.scheduled_for <= now + timedelta(days=7)]
    overdue = [f for f in fus if f.status == "scheduled" and f.scheduled_for and f.scheduled_for < now]
    requested = [f for f in fus if f.status == "requested"]
    alerts = db.scalars(select(ReviewAlert).where(ReviewAlert.caseworker_id == (cw.id if cw else -1), ReviewAlert.status == "open")).all()
    # recent activity feed (no assessment content)
    code = {b.id: b.code for b in bens}
    feed = []
    if ids:
        for a in db.scalars(select(Assessment).where(Assessment.beneficiary_id.in_(ids), Assessment.status == "submitted").order_by(Assessment.submitted_at.desc()).limit(8)):
            lvl = a.score.priority_level if a.score else None
            feed.append({"at": a.submitted_at, "type": "assessment", "beneficiary_id": a.beneficiary_id, "code": code[a.beneficiary_id],
                         "text": "Submitted a check-in", "level": lvl})
        for n in db.scalars(select(CaseNote).where(CaseNote.beneficiary_id.in_(ids)).order_by(CaseNote.created_at.desc()).limit(5)):
            feed.append({"at": n.created_at, "type": "note", "beneficiary_id": n.beneficiary_id, "code": code[n.beneficiary_id], "text": "Case note added", "level": None})
        for i in db.scalars(select(Intervention).where(Intervention.beneficiary_id.in_(ids)).order_by(Intervention.occurred_at.desc()).limit(5)):
            feed.append({"at": i.occurred_at, "type": "intervention", "beneficiary_id": i.beneficiary_id, "code": code[i.beneficiary_id],
                         "text": f"Intervention recorded ({i.type.replace('_', ' ')})", "level": None})
    feed.sort(key=lambda x: x["at"], reverse=True)
    lvl = Counter((r["latest"] or {}).get("priority_level") or "none" for r in rows)
    return {
        "assigned_beneficiaries": len(bens), "assessments_completed": completed, "assessments_completed_30d": completed_30,
        "assessments_pending": sum(1 for r in rows if r["assessment_due"]),
        "awaiting_review": sum(1 for r in rows if r["needs_review"]),
        "urgent_notifications": sum(1 for a in alerts if a.level == "urgent"),
        "attention_notifications": sum(1 for a in alerts if a.level == "attention"),
        "followups_due_7d": len(due_soon), "followups_overdue": len(overdue), "followups_requested": len(requested),
        "priority_distribution": {k: lvl.get(k, 0) for k in ("urgent", "attention", "routine", "none")},
        "recent_activity": feed[:10],
    }


def _consenting_ids(db: Session) -> set[int]:
    """Beneficiary ids whose most recent 'analytics_use' consent is granted."""
    latest: dict[int, bool] = {}
    for c in db.scalars(select(ConsentRecord).where(ConsentRecord.consent_type == "analytics_use").order_by(ConsentRecord.created_at.asc(), ConsentRecord.id.asc())):
        latest[c.user_id] = c.granted
    granted_users = {u for u, g in latest.items() if g}
    return {b.id for b in db.scalars(select(Beneficiary).where(Beneficiary.user_id.in_(granted_users)))} if granted_users else set()


def _week_start(d: datetime) -> str:
    return (d.date() - timedelta(days=d.weekday())).isoformat()


@router.get("/overview")
def overview(from_date: date | None = None, to_date: date | None = None, org_unit: str | None = None,
             user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    """Aggregate system analytics. No identifiers are returned. Cells smaller than ANALYTICS_MIN_CELL are suppressed."""
    k = get_settings().analytics_min_cell
    to_d = to_date or utcnow().date()
    from_d = from_date or (to_d - timedelta(days=120))
    start = datetime.combine(from_d, time.min, tzinfo=timezone.utc)
    end = datetime.combine(to_d, time.max, tzinfo=timezone.utc)

    bq = select(Beneficiary)
    if org_unit:
        bq = bq.where(Beneficiary.org_unit == org_unit)
    bens = db.scalars(bq).all()
    ben_ids = {b.id for b in bens}
    consenting = _consenting_ids(db) & ben_ids

    all_assess = db.scalars(select(Assessment).where(Assessment.status == "submitted", Assessment.beneficiary_id.in_(ben_ids),
                                                     Assessment.submitted_at >= start, Assessment.submitted_at <= end)).all() if ben_ids else []
    with_assess = {a.beneficiary_id for a in all_assess}
    consented_assess = [a for a in all_assess if a.beneficiary_id in consenting and a.score]

    # priority distribution: each consenting beneficiary's latest assessment within the period
    latest_by_ben: dict[int, Assessment] = {}
    for a in sorted(consented_assess, key=lambda x: x.submitted_at):
        latest_by_ben[a.beneficiary_id] = a
    dist = Counter(a.score.priority_level for a in latest_by_ben.values())

    def sup(n: int):  # small-cell suppression
        return None if 0 < n < k else n

    weekly = defaultdict(int)
    for a in all_assess:
        weekly[_week_start(a.submitted_at)] += 1
    monthly: dict[str, list[float]] = defaultdict(list)
    for a in consented_assess:
        if a.score.overall_score is not None:
            monthly[a.submitted_at.strftime("%Y-%m")].append(wellbeing_index(a.score.overall_score))
    wellbeing_trend = [{"month": m, "avg_wellbeing": round(sum(v) / len(v), 1) if len(v) >= k else None, "n": sup(len(v))} for m, v in sorted(monthly.items())]

    fus = db.scalars(select(FollowUp).where(FollowUp.beneficiary_id.in_(ben_ids), FollowUp.created_at >= start, FollowUp.created_at <= end)).all() if ben_ids else []
    now = utcnow()
    fu_status = Counter(f.status for f in fus)
    overdue = sum(1 for f in fus if f.status == "scheduled" and f.scheduled_for and f.scheduled_for < now)
    resolvable = fu_status["completed"] + overdue + fu_status["cancelled"]
    ints = db.scalars(select(Intervention).where(Intervention.beneficiary_id.in_(ben_ids), Intervention.occurred_at >= start, Intervention.occurred_at <= end)).all() if ben_ids else []
    by_type, by_outcome = Counter(i.type for i in ints), Counter(i.outcome or "not_recorded" for i in ints)
    return {
        "period": {"from": from_d.isoformat(), "to": to_d.isoformat(), "org_unit": org_unit},
        "privacy": {"min_cell_size": k, "note": "Counts below the minimum cell size are suppressed (null). Wellbeing and priority views include only people who consented to analytics use."},
        "total_beneficiaries": len(bens),
        "active_cases": sum(1 for b in bens if b.case_status != "closed"),
        "assessments_submitted": len(all_assess),
        "assessment_completion_rate": round(len(with_assess) / len(bens), 3) if bens else None,
        "consenting_beneficiaries": sup(len(consenting)),
        "priority_distribution": {lvl: sup(dist.get(lvl, 0)) for lvl in ("routine", "attention", "urgent")},
        "assessments_per_week": [{"week": w, "count": c} for w, c in sorted(weekly.items())],
        "wellbeing_trend": wellbeing_trend,
        "followups": {"total": len(fus), "completed": fu_status["completed"], "scheduled": fu_status["scheduled"],
                      "requested": fu_status["requested"], "cancelled": fu_status["cancelled"], "overdue": overdue,
                      "completion_rate": round(fu_status["completed"] / resolvable, 3) if resolvable else None},
        "interventions": {"total": len(ints), "by_type": [{"type": t, "count": c} for t, c in by_type.most_common()],
                          "by_outcome": [{"outcome": o, "count": c} for o, c in by_outcome.most_common()]},
        "org_units": sorted({b.org_unit for b in db.scalars(select(Beneficiary))}),
    }


@router.get("/trends")
def trends(from_date: date | None = None, to_date: date | None = None, org_unit: str | None = None,
           user: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    """Subset of /overview for chart widgets."""
    o = overview(from_date, to_date, org_unit, user, db)
    return {k: o[k] for k in ("period", "assessments_per_week", "wellbeing_trend", "priority_distribution")}
