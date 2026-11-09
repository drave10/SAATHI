# Assessment methodology

> **Not a diagnostic instrument.** The questionnaire is an *original prototype* (`saathi-proto-1.0`) written for this project. It has **not**
> been clinically validated, and no licensed instrument (PHQ-9, GAD-7, K10, …) is used or reproduced, because their licensing/scoring terms
> were not verified. The output is a **review priority** that asks a human to look sooner or later — not a diagnosis and not a probability of harm.

## 1. Questionnaire (`backend/app/engine/questionnaire.py`)
17 items over a two-week look-back; 16 are scored Likert/multiple-choice items and 1 is optional free text (never scored or analysed).

| Dimension | Items |
|---|---|
| Emotional well-being | `emo_1` (low mood), `emo_2` (calm/enjoyment, reverse-keyed) |
| Stress | `str_1`, `str_2` |
| Sleep | `slp_1`, `slp_2` (rested, reverse-keyed) |
| Feelings of safety | `saf_1` (safe where staying, reverse), `saf_2` (afraid for safety), `safe_self` (thoughts of self-harm — critical) |
| Social support | `soc_1` (someone to talk to, reverse), `soc_2` (isolated) |
| Emotional difficulties | `dif_1`, `dif_2` |
| Daily activities | `fun_1`, `fun_2` (reverse) |
| Outside the dimensions | `chg_1` (change since last check-in), `help_1` (would like to speak to someone), `text_1` (optional free text) |

Each answer maps to a **concern value 0–4** through an explicit per-item table (e.g. reverse-keyed items `[4,3,2,1,0]`). The map lives on the server
and is not sent to the browser. Answers are validated server-side; required items must be answered to submit.

## 2. Scores
* **Dimension score (0–100)** = mean concern of *answered* items ÷ 4 × 100. Unanswered items are **excluded**, not counted as zero.
* **Overall concern index (0–100)** = weighted mean of available dimension scores (weights configurable; safety defaults to 1.5, others 1.0, re-normalised when dimensions are missing).
* **Well-being score** shown to beneficiaries = 100 − concern index (higher = better).

## 3. Review-priority rules (`backend/app/engine/scoring.py`)
Default thresholds in `engine/config.py`; all configurable by an administrator (validated) and **snapshotted with each result**.

| Level | Meaning | Triggers (any) |
|---|---|---|
| **Routine** | No significant new indicators | none of the below |
| **Attention** | Indicators warrant timely human review | overall ≥ 40 · any dimension ≥ 65 · contact requested "within a few days" · self-reported "worse/much worse" · overall rose ≥ 15 since last check-in · sleep or daily-activities dimension rose ≥ 25 · a dimension ≥ 50 in ≥ 2 of the last 3 check-ins (persistence) |
| **Urgent review** | Needs prompt human assessment | **critical items:** any non-zero answer to the self-harm item; "unsafe where staying" or "afraid for own safety" at the top two concern levels; contact requested "as soon as possible" · overall ≥ 70 · safety dimension ≥ 75 · overall rose ≥ 30 |

The level is the highest level triggered. Every triggered rule becomes a **factor** `{code, label, severity, detail, value}` stored with the score; this is
what caseworkers see under "Why this review priority?". If nothing triggers, the single factor `no_new_indicators` is recorded.

### Missing data
If fewer than `min_completion` (60 %) of the scored items were answered, **threshold, change and persistence rules are not applied** (they would be unreliable) and
a data-quality note is attached; **critical-item rules are always evaluated** on whatever was answered. Incomplete data therefore never silently produces a "Routine"
verdict without a visible caveat, and never suppresses a safety trigger.

### What the engine does *not* use
Only questionnaire answers and the person's own previous results are inputs. `evaluate(answers, history, cfg)` has no demographic parameters
(asserted by a unit test); age band, language, organisational unit, caste, religion, gender or victim status are never features.

### Actions that result
* Attention/Urgent → an in-app **review alert** for the assigned caseworker; "contact requested" → a follow-up *request*.
* Urgent/critical → the beneficiary is shown configured support resources and told that their worker will follow up. This is a pointer to humans,
  **not** an automated crisis response; nothing is sent to third parties.

## 4. Longitudinal monitoring
Previous *scored, submitted* assessments earlier than the current one form the history. The engine reports `overall_delta`, per-dimension deltas and persistent dimensions;
`GET /assessments/{id}/compare` returns the same comparison for any two check-ins; the case profile charts the full timeline.

## 5. Known limitations
Thresholds are illustrative; no sensitivity/specificity is claimed; item wording has not been tested with beneficiaries; translation/cultural adaptation is future work.
