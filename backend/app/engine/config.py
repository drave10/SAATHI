"""Configurable parameters of the rule-based review-priority engine.

All values can be overridden by an administrator (stored in system_settings under 'engine_config').
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields

ENGINE_VERSION = "rules-1.0"


@dataclass
class EngineConfig:
    # Relative weight of each dimension in the overall concern index (renormalised when data is missing).
    dimension_weights: dict = field(default_factory=lambda: {
        "emotional": 1.0, "stress": 1.0, "sleep": 1.0, "safety": 1.5,
        "social": 1.0, "difficulties": 1.0, "functioning": 1.0,
    })
    min_completion: float = 0.6            # share of likert items needed to trust threshold-based rules
    attention_overall: float = 40.0        # overall concern index (0-100) -> Attention
    urgent_overall: float = 70.0           # overall concern index -> Urgent review
    attention_dimension: float = 65.0      # any single dimension at/above -> Attention
    urgent_dimension_safety: float = 75.0  # safety dimension at/above -> Urgent review
    rise_attention: float = 15.0           # overall increase vs previous assessment -> Attention
    rise_urgent: float = 30.0              # overall increase vs previous assessment -> Urgent review
    dimension_rise_attention: float = 25.0 # increase in sleep / functioning vs previous -> Attention
    persistence_dimension: float = 50.0    # dimension level counted as "elevated" for persistence rule
    persistence_window: int = 3            # last N assessments considered (incl. current)
    persistence_min_count: int = 2         # elevated in >= this many of the window -> Attention
    self_report_worse_concern: int = 3     # chg_1 concern value at/above -> Attention
    critical_self_harm_item: bool = True   # any non-zero 'safe_self' answer -> Urgent review
    critical_unsafe_concern: int = 3       # saf_1 / saf_2 concern value at/above -> Urgent review
    help_attention_concern: int = 3        # help_1 concern at/above -> Attention (requested support)
    help_urgent_concern: int = 4           # help_1 concern at/above -> Urgent review (ASAP)
    assessment_interval_days: int = 14     # a new check-in is "due" after this many days
    use_ml_advisory: bool = True           # attach the experimental ML advisory if the model exists

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "EngineConfig":
        cfg = cls()
        if not data:
            return cfg
        names = {f.name for f in fields(cls)}
        for k, v in data.items():
            if k in names:
                setattr(cfg, k, v)
        return cfg


def validate_config_dict(data: dict) -> list[str]:
    """Return human-readable problems with a proposed configuration (empty list = ok)."""
    errors: list[str] = []
    names = {f.name for f in fields(EngineConfig)}
    for k in data:
        if k not in names:
            errors.append(f"Unknown setting '{k}'.")
    merged = EngineConfig.from_dict(data)
    if not (0 < merged.attention_overall < merged.urgent_overall <= 100):
        errors.append("Require 0 < attention_overall < urgent_overall <= 100.")
    if not (0 < merged.min_completion <= 1):
        errors.append("min_completion must be in (0, 1].")
    if not (0 < merged.rise_attention < merged.rise_urgent <= 100):
        errors.append("Require 0 < rise_attention < rise_urgent <= 100.")
    if any((not isinstance(w, (int, float))) or w < 0 for w in merged.dimension_weights.values()):
        errors.append("dimension_weights must be non-negative numbers.")
    if merged.persistence_min_count > merged.persistence_window or merged.persistence_window < 1:
        errors.append("persistence_min_count must be <= persistence_window (>=1).")
    if merged.assessment_interval_days < 1:
        errors.append("assessment_interval_days must be >= 1.")
    return errors
