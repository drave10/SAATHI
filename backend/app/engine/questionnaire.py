"""SAATHI prototype well-being check-in (v1).

NOT a clinically validated instrument. Items are original, non-stigmatising wordings written for this
prototype. Each scored item maps a response value to a 0-4 "concern" value (0 = no concern, 4 = most concern),
so positively-worded items are reverse-mapped explicitly rather than implicitly.
"""
from __future__ import annotations

QUESTIONNAIRE_VERSION = "saathi-proto-1.0"

DIMENSIONS = {
    "emotional": "Emotional well-being",
    "stress": "Stress",
    "sleep": "Sleep quality",
    "safety": "Feelings of safety",
    "social": "Social support",
    "difficulties": "Emotional difficulties",
    "functioning": "Daily activities",
}

FREQ = ["Not at all", "Rarely", "Sometimes", "Often", "Almost always"]
FREQ_REV = ["Almost always", "Often", "Sometimes", "Rarely", "Not at all"]
DAYS = ["Not at all", "Several days", "More than half the days", "Nearly every day"]


def _opts(labels: list[str]) -> list[dict]:
    return [{"value": i, "label": l} for i, l in enumerate(labels)]


def _q(qid, dim, text, labels, concern, *, critical=False, required=True, help_text=None):
    assert len(labels) == len(concern)
    return {
        "id": qid, "dimension": dim, "type": "likert", "text": text, "options": _opts(labels),
        "concern": list(concern), "critical": critical, "required": required, "help": help_text,
    }


QUESTIONS: list[dict] = [
    _q("emo_1", "emotional", "Over the last two weeks, how often have you felt low or down?", FREQ, [0, 1, 2, 3, 4]),
    _q("emo_2", "emotional", "How often have you felt calm and able to enjoy things?", FREQ_REV, [4, 3, 2, 1, 0]),
    _q("str_1", "stress", "How often have you felt under a lot of stress?", FREQ, [0, 1, 2, 3, 4]),
    _q("str_2", "stress", "How often have you felt overwhelmed by the things you need to handle?", FREQ, [0, 1, 2, 3, 4]),
    _q("slp_1", "sleep", "How often have you had trouble falling asleep or staying asleep?", FREQ, [0, 1, 2, 3, 4]),
    _q("slp_2", "sleep", "How rested have you felt when you wake up?", FREQ_REV, [4, 3, 2, 1, 0],
       help_text="'Almost always' means you usually wake up feeling rested."),
    _q("saf_1", "safety", "How safe have you felt in the place where you are staying?", FREQ_REV, [4, 3, 2, 1, 0], critical=True),
    _q("saf_2", "safety", "How often have you felt afraid for your own safety?", FREQ, [0, 1, 2, 3, 4], critical=True),
    _q("soc_1", "social", "How often have you had someone you could talk to when you needed support?", FREQ_REV, [4, 3, 2, 1, 0]),
    _q("soc_2", "social", "How often have you felt isolated or alone?", FREQ, [0, 1, 2, 3, 4]),
    _q("dif_1", "difficulties", "How often have upsetting memories or worries been hard to put aside?", FREQ, [0, 1, 2, 3, 4]),
    _q("dif_2", "difficulties", "How often have you felt that things are too hard to keep going?", FREQ, [0, 1, 2, 3, 4]),
    _q("fun_1", "functioning", "How much difficulty have you had with everyday activities such as work, household tasks or self-care?",
       ["None", "A little", "Some", "A lot", "Extreme"], [0, 1, 2, 3, 4]),
    _q("fun_2", "functioning", "How often have you been able to get done the things you planned for the day?", FREQ_REV, [4, 3, 2, 1, 0]),
    _q("safe_self", "safety",
       "In the last two weeks, how often have you had thoughts of hurting yourself, or that you would be better off not being here?",
       DAYS, [0, 2, 3, 4], critical=True,
       help_text="Your answer is shared only with your authorised support worker. If you are in danger right now, please contact emergency services."),
    _q("chg_1", "change", "Compared with your last check-in, how have you been feeling overall?",
       ["Much better", "A little better", "About the same", "A little worse", "Much worse"], [0, 0, 1, 3, 4],
       help_text="If this is your first check-in, choose 'About the same'."),
    _q("help_1", "support_request", "Would you like to speak with a support professional?",
       ["No, not at the moment", "Maybe later", "Yes, within the next few days", "Yes, as soon as possible"], [0, 1, 3, 4]),
    {
        "id": "text_1", "dimension": "free_text", "type": "text", "text": "Is there anything else you would like your support worker to know? (optional)",
        "options": [], "concern": [], "critical": False, "required": False, "help": "Free text is read only by people; it is not scored by the system.",
    },
]

QUESTION_INDEX = {q["id"]: q for q in QUESTIONS}
SCORED_DIMENSIONS = [d for d in DIMENSIONS]  # excludes 'change' and 'support_request'
LIKERT_IDS = [q["id"] for q in QUESTIONS if q["type"] == "likert"]
REQUIRED_IDS = [q["id"] for q in QUESTIONS if q["required"]]


def concern_value(qid: str, value: int) -> int:
    q = QUESTION_INDEX[qid]
    return q["concern"][value]


def validate_answer(qid: str, value) -> str | None:
    q = QUESTION_INDEX.get(qid)
    if q is None:
        return f"Unknown question '{qid}'."
    if q["type"] == "text":
        return None
    if not isinstance(value, int) or isinstance(value, bool) or not (0 <= value < len(q["options"])):
        return f"Invalid answer for '{qid}'."
    return None


def public_questionnaire() -> dict:
    """Questionnaire as sent to the client (concern mapping is hidden to keep scoring server-side)."""
    items = [{k: v for k, v in q.items() if k != "concern"} for q in QUESTIONS]
    return {
        "version": QUESTIONNAIRE_VERSION,
        "title": "SAATHI well-being check-in",
        "disclaimer": (
            "This is a prototype check-in to help your support team understand how you are doing. "
            "It is not a medical test and does not diagnose any condition."
        ),
        "dimensions": DIMENSIONS,
        "items": items,
    }
