"""Synthetic data generation for the experimental ML advisory and for the demo seed data.

IMPORTANT: everything here is artificial. A latent "support need" value is drawn per synthetic assessment and the
questionnaire answers are generated from it with noise. There is NO real beneficiary data and the generator encodes
our own assumptions, so models trained on it cannot demonstrate clinical or real-world validity.
"""
from __future__ import annotations

import numpy as np

from .questionnaire import LIKERT_IDS, QUESTION_INDEX


def answers_from_latent(z: float, rng: np.random.Generator, *, missing_rate: float = 0.0, noise: float = 0.7) -> dict:
    """z in [0,1]: latent support need. Returns {question_id: option_index} for likert items."""
    answers: dict[str, int] = {}
    for qid in LIKERT_IDS:
        q = QUESTION_INDEX[qid]
        if missing_rate and rng.random() < missing_rate:
            continue
        n = len(q["options"])
        concern_levels = q["concern"]
        max_c = max(concern_levels)
        if qid == "safe_self":
            # rarely non-zero, mostly at high z
            p = max(0.0, (z - 0.55)) * 1.2
            idx = 0 if rng.random() > p else int(rng.integers(1, n))
            answers[qid] = idx
            continue
        target = np.clip(z * max_c + rng.normal(0, noise), 0, max_c)
        # choose option whose concern value is closest to target
        idx = int(np.argmin([abs(c - target) for c in concern_levels]))
        answers[qid] = idx
    return answers


def latent_trajectory(rng: np.random.Generator, n: int, profile: str) -> list[float]:
    """Latent need over n time points for a named profile."""
    base = {"stable_low": 0.12, "stable_mid": 0.4, "stable_high": 0.7, "improving": 0.65, "declining": 0.2, "volatile": 0.35}[profile]
    out = []
    z = base
    for i in range(n):
        if profile == "improving":
            z = max(0.05, z - rng.uniform(0.04, 0.12))
        elif profile == "declining":
            z = min(0.95, z + rng.uniform(0.05, 0.15))
        elif profile == "volatile":
            z = float(np.clip(base + rng.normal(0, 0.2), 0.02, 0.98))
        else:
            z = float(np.clip(base + rng.normal(0, 0.05), 0.02, 0.98))
        out.append(float(z))
    return out
