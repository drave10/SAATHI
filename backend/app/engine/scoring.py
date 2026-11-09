"""Transparent, rule-based review-priority engine.

Pure functions only (no database, no network) so the engine can be unit-tested and replaced independently.

Output is a *review-priority recommendation* for human follow-up (routine / attention / urgent). It is not a
diagnosis, not a probability of harm, and never uses demographic attributes.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .config import ENGINE_VERSION, EngineConfig
from .questionnaire import DIMENSIONS, LIKERT_IDS, QUESTION_INDEX, concern_value

LEVEL_ORDER = {"routine": 0, "attention": 1, "urgent": 2}
LEVEL_LABEL = {"routine": "Routine", "attention": "Attention", "urgent": "Urgent review"}


@dataclass
class PriorResult:
    """Summary of an earlier submitted assessment (oldest-first lists are passed to evaluate())."""
    overall: float | None
    dimensions: dict
    level: str = "routine"


@dataclass
class EngineResult:
    level: str
    overall_score: float | None
    dimension_scores: dict
    factors: list = field(default_factory=list)
    change_summary: dict = field(default_factory=dict)
    data_quality: dict = field(default_factory=dict)
    engine_version: str = ENGINE_VERSION

    def to_dict(self) -> dict:
        return {
            "level": self.level, "overall_score": self.overall_score, "dimension_scores": self.dimension_scores,
            "factors": self.factors, "change_summary": self.change_summary, "data_quality": self.data_quality,
            "engine_version": self.engine_version,
        }


def _factor(code: str, label: str, severity: str, detail: str, dimension: str | None = None, value=None) -> dict:
    return {"code": code, "label": label, "severity": severity, "detail": detail, "dimension": dimension, "value": value}


def compute_dimension_scores(answers: dict) -> tuple[dict, int]:
    """Mean concern per dimension scaled to 0-100. Unanswered items are excluded (not treated as zero)."""
    buckets: dict[str, list[int]] = {d: [] for d in DIMENSIONS}
    answered = 0
    for qid in LIKERT_IDS:
        v = answers.get(qid)
        if v is None:
            continue
        answered += 1
        dim = QUESTION_INDEX[qid]["dimension"]
        if dim in buckets:
            buckets[dim].append(concern_value(qid, v))
    scores = {d: (round(sum(vals) / (4 * len(vals)) * 100, 1) if vals else None) for d, vals in buckets.items()}
    return scores, answered


def compute_overall(dim_scores: dict, cfg: EngineConfig) -> float | None:
    num = den = 0.0
    for d, s in dim_scores.items():
        if s is None:
            continue
        w = float(cfg.dimension_weights.get(d, 1.0))
        num += w * s
        den += w
    return round(num / den, 1) if den > 0 else None


def evaluate(answers: dict, history: list[PriorResult] | None = None, cfg: EngineConfig | None = None) -> EngineResult:
    """Evaluate one assessment. `answers` maps question id -> int option index (None/absent = missing).
    `history` is oldest-first and excludes the current assessment."""
    cfg = cfg or EngineConfig()
    history = history or []
    factors: list[dict] = []
    level = "routine"

    def raise_to(new: str):
        nonlocal level
        if LEVEL_ORDER[new] > LEVEL_ORDER[level]:
            level = new

    dim_scores, answered = compute_dimension_scores(answers)
    overall = compute_overall(dim_scores, cfg)
    completion = answered / len(LIKERT_IDS)
    reliable = completion >= cfg.min_completion
    dq = {
        "answered_items": answered, "total_items": len(LIKERT_IDS), "completion": round(completion, 2),
        "reliable_for_thresholds": reliable,
        "note": None if reliable else "Too few items answered; threshold rules were not applied (critical items still are).",
    }

    # ---- critical item rules: always evaluated, even with partial data -------------------------------------
    sh = answers.get("safe_self")
    if cfg.critical_self_harm_item and sh is not None and sh > 0:
        raise_to("urgent")
        factors.append(_factor("critical_self_harm_item", "Reported thoughts of self-harm", "urgent",
                               "The person answered the self-harm safety item above 'Not at all'. Prompt human contact is recommended.",
                               "safety", sh))
    for qid, label in (("saf_1", "Reported feeling unsafe where staying"), ("saf_2", "Reported frequently being afraid for own safety")):
        v = answers.get(qid)
        if v is not None and concern_value(qid, v) >= cfg.critical_unsafe_concern:
            raise_to("urgent")
            factors.append(_factor(f"critical_{qid}", label, "urgent",
                                   "Self-reported safety answer is at the highest-concern levels.", "safety", concern_value(qid, v)))
    hv = answers.get("help_1")
    if hv is not None:
        hc = concern_value("help_1", hv)
        if hc >= cfg.help_urgent_concern:
            raise_to("urgent")
            factors.append(_factor("help_requested_asap", "Asked to speak to someone as soon as possible", "urgent",
                                   "The person requested contact as soon as possible.", "support_request", hc))
        elif hc >= cfg.help_attention_concern:
            raise_to("attention")
            factors.append(_factor("help_requested", "Asked to speak to someone within a few days", "attention",
                                   "The person requested contact with a support professional.", "support_request", hc))

    # ---- threshold rules (only when enough data) -----------------------------------------------------------
    if reliable and overall is not None:
        if overall >= cfg.urgent_overall:
            raise_to("urgent")
            factors.append(_factor("overall_very_high", "Overall concern index very high", "urgent",
                                   f"Overall concern index {overall} ≥ {cfg.urgent_overall}.", None, overall))
        elif overall >= cfg.attention_overall:
            raise_to("attention")
            factors.append(_factor("overall_elevated", "Overall concern index elevated", "attention",
                                   f"Overall concern index {overall} ≥ {cfg.attention_overall}.", None, overall))
        for d, s in dim_scores.items():
            if s is None:
                continue
            if d == "safety" and s >= cfg.urgent_dimension_safety:
                raise_to("urgent")
                factors.append(_factor("safety_dimension_very_high", "Safety dimension very high", "urgent",
                                       f"Safety dimension {s} ≥ {cfg.urgent_dimension_safety}.", d, s))
            elif s >= cfg.attention_dimension:
                raise_to("attention")
                factors.append(_factor(f"dimension_high_{d}", f"{DIMENSIONS[d]} high", "attention",
                                       f"{DIMENSIONS[d]} score {s} ≥ {cfg.attention_dimension}.", d, s))
        chg = answers.get("chg_1")
        if chg is not None and concern_value("chg_1", chg) >= cfg.self_report_worse_concern:
            raise_to("attention")
            factors.append(_factor("self_reported_worse", "Reports feeling worse than last check-in", "attention",
                                   "Self-reported change since the previous check-in is 'worse' or 'much worse'.", None, concern_value("chg_1", chg)))

    # ---- change / persistence versus history ---------------------------------------------------------------
    change: dict = {"has_previous": bool(history), "overall_delta": None, "dimension_deltas": {}, "persistent_dimensions": []}
    prev = next((h for h in reversed(history) if h.overall is not None), None)
    if prev is not None and overall is not None:
        delta = round(overall - prev.overall, 1)
        change["overall_delta"] = delta
        for d in DIMENSIONS:
            a, b = dim_scores.get(d), prev.dimensions.get(d)
            if a is not None and b is not None:
                change["dimension_deltas"][d] = round(a - b, 1)
        if reliable:
            if delta >= cfg.rise_urgent:
                raise_to("urgent")
                factors.append(_factor("sharp_rise", "Sharp rise in overall concern index", "urgent",
                                       f"Overall index rose by {delta} points since the previous check-in (≥ {cfg.rise_urgent}).", None, delta))
            elif delta >= cfg.rise_attention:
                raise_to("attention")
                factors.append(_factor("rise", "Rise in overall concern index", "attention",
                                       f"Overall index rose by {delta} points since the previous check-in (≥ {cfg.rise_attention}).", None, delta))
            for d in ("sleep", "functioning"):
                dd = change["dimension_deltas"].get(d)
                if dd is not None and dd >= cfg.dimension_rise_attention:
                    raise_to("attention")
                    factors.append(_factor(f"{d}_decline", f"{DIMENSIONS[d]} has worsened", "attention",
                                           f"{DIMENSIONS[d]} score rose by {dd} points since the previous check-in.", d, dd))
    window = ([PriorResult(overall, dim_scores)] if overall is not None else []) + list(reversed(history))
    window = window[: cfg.persistence_window]
    if reliable and len(window) >= 2:
        for d in DIMENSIONS:
            count = sum(1 for w in window if w.dimensions.get(d) is not None and w.dimensions[d] >= cfg.persistence_dimension)
            current = dim_scores.get(d)
            if count >= cfg.persistence_min_count and current is not None and current >= cfg.persistence_dimension:
                change["persistent_dimensions"].append(d)
                raise_to("attention")
                factors.append(_factor(f"persistent_{d}", f"Persistently elevated: {DIMENSIONS[d]}", "attention",
                                       f"{DIMENSIONS[d]} was at or above {cfg.persistence_dimension} in {count} of the last {len(window)} check-ins.", d, count))

    if not factors:
        factors.append(_factor("no_new_indicators", "No significant new indicators", "info",
                               "No rule was triggered by this check-in.", None, None))
    factors.sort(key=lambda f: -{"urgent": 3, "attention": 2, "info": 1}.get(f["severity"], 0))
    return EngineResult(level=level, overall_score=overall, dimension_scores=dim_scores, factors=factors,
                        change_summary=change, data_quality=dq)


def wellbeing_index(concern: float | None) -> float | None:
    """Beneficiary-facing framing: 100 - concern, so higher is better."""
    return None if concern is None else round(100 - concern, 1)


def summary_text(result: EngineResult) -> str:
    top = [f["label"] for f in result.factors if f["severity"] in ("urgent", "attention")][:3]
    base = f"Review priority: {LEVEL_LABEL[result.level]}."
    if top:
        base += " Contributing factors: " + "; ".join(top) + "."
    return base + " This is a prompt for human review, not a diagnosis."
