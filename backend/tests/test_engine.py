"""Unit tests for the rule-based engine (pure functions, no DB)."""
import pytest

from app.engine import EngineConfig, PriorResult, evaluate
from app.engine import ml
from app.engine.config import validate_config_dict
from app.engine.questionnaire import LIKERT_IDS, QUESTION_INDEX


def answers_with_concern(level: int, **overrides) -> dict:
    """Pick, for each likert item, the option whose concern value is closest to `level` (0-4)."""
    out = {}
    for qid in LIKERT_IDS:
        c = QUESTION_INDEX[qid]["concern"]
        out[qid] = min(range(len(c)), key=lambda i: abs(c[i] - level))
    out.update(overrides)
    return out


def test_low_concern_is_routine():
    r = evaluate(answers_with_concern(0))
    assert r.level == "routine"
    assert r.overall_score == 0
    assert r.factors[0]["code"] == "no_new_indicators"


def test_high_overall_is_urgent_with_explanation():
    r = evaluate(answers_with_concern(4, safe_self=0))
    assert r.level == "urgent"
    codes = {f["code"] for f in r.factors}
    assert "overall_very_high" in codes
    assert all("detail" in f and "label" in f for f in r.factors)


def test_moderate_overall_is_attention():
    r = evaluate(answers_with_concern(2, chg_1=2, help_1=0, safe_self=0))
    assert r.level == "attention"  # 50 >= 40 attention threshold, < 70


def test_self_harm_item_always_urgent_even_with_otherwise_low_scores():
    r = evaluate(answers_with_concern(0, safe_self=1))
    assert r.level == "urgent"
    assert any(f["code"] == "critical_self_harm_item" for f in r.factors)


def test_critical_item_works_with_very_sparse_data():
    r = evaluate({"safe_self": 3})
    assert r.level == "urgent"
    assert r.data_quality["reliable_for_thresholds"] is False


def test_missing_data_suppresses_threshold_rules_but_is_flagged():
    sparse = {"emo_1": 4, "emo_2": 0}  # very high concern but only 2 of 15 items answered
    r = evaluate(sparse)
    assert r.level == "routine"
    assert r.data_quality["completion"] < 0.6
    assert r.data_quality["note"]


def test_missing_items_are_excluded_not_zero():
    a = answers_with_concern(4)
    del a["slp_1"], a["slp_2"]
    r = evaluate(a)
    assert r.dimension_scores["sleep"] is None
    assert r.overall_score == 100.0  # remaining dimensions all maximal; no dilution by zeros


def test_help_request_levels():
    assert evaluate(answers_with_concern(0, help_1=2)).level == "attention"
    assert evaluate(answers_with_concern(0, help_1=3)).level == "urgent"


def test_rise_vs_previous_triggers_attention():
    prev = evaluate(answers_with_concern(0))
    cur = answers_with_concern(1, chg_1=2, safe_self=0)  # overall ~23 -> rise within [15, 30)
    r = evaluate(cur, [PriorResult(prev.overall_score, prev.dimension_scores)])
    assert 15 <= r.change_summary["overall_delta"] < 30
    assert any(f["code"] == "rise" for f in r.factors)
    assert r.level == "attention"


def test_sharp_rise_triggers_urgent():
    prev = evaluate(answers_with_concern(0))
    r = evaluate(answers_with_concern(2, chg_1=2, help_1=0, safe_self=0), [PriorResult(prev.overall_score, prev.dimension_scores)])
    assert r.change_summary["overall_delta"] >= 30
    assert any(f["code"] == "sharp_rise" for f in r.factors)
    assert r.level == "urgent"


def test_persistence_rule():
    hist = [PriorResult(55.0, {"sleep": 60.0}), PriorResult(30.0, {"sleep": 20.0})]
    a = answers_with_concern(1, slp_1=3, slp_2=1)  # sleep dimension 62.5 (>=50), overall low
    r = evaluate(a, hist[::-1][::-1])
    assert "sleep" in r.change_summary["persistent_dimensions"]


def test_no_previous_means_no_change_factors():
    r = evaluate(answers_with_concern(0))
    assert r.change_summary["has_previous"] is False
    assert r.change_summary["overall_delta"] is None


def test_configuration_is_respected():
    a = answers_with_concern(2, chg_1=2, help_1=0, safe_self=0)  # overall 50
    assert evaluate(a, cfg=EngineConfig(attention_overall=60, urgent_overall=90, attention_dimension=90)).level == "routine"
    assert evaluate(a, cfg=EngineConfig(attention_overall=20, urgent_overall=45)).level == "urgent"


def test_config_validation_rejects_bad_values():
    assert validate_config_dict({"attention_overall": 80, "urgent_overall": 50})
    assert validate_config_dict({"nonsense": 1})
    assert validate_config_dict({"min_completion": 0})
    assert validate_config_dict({}) == []


def test_engine_has_no_demographic_inputs():
    import inspect
    params = inspect.signature(evaluate).parameters
    assert set(params) == {"answers", "history", "cfg"}


def test_ml_advisory_is_optional(monkeypatch):
    monkeypatch.setattr(ml, "load_model", lambda: None)
    assert ml.advisory({}, {}, 50.0, None) is None
    r = evaluate(answers_with_concern(2))  # the engine itself never depends on ML
    assert r.level in ("routine", "attention", "urgent")


@pytest.mark.skipif(not ml.MODEL_PATH.exists(), reason="model not trained")
def test_ml_advisory_output_shape():
    a = answers_with_concern(2)
    r = evaluate(a)
    adv = ml.advisory(a, r.dimension_scores, r.overall_score, None)
    assert adv["estimated_class"] in ml.CLASSES
    assert abs(sum(adv["class_scores"].values()) - 1) < 0.01
    assert "Not a diagnosis" in adv["label"]
