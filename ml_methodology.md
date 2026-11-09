# Machine-learning methodology (experimental advisory)

> **Read this first.** The model is trained on **synthetic data produced by this repository's own generator**. It therefore learns our generator's
> assumptions, *not* real distress. Its metrics are **not evidence of clinical or real-world predictive validity**, and it must not be used for decisions.

## Role in the application
* The **rule-based engine decides** the review priority. The ML output is an *advisory* attached to the caseworker's explanation view, labelled
  "Experimental advisory (synthetic-trained). Not a diagnosis or prediction of harm." It **never** changes the level or triggers alerts.
* If `backend/models/ml_advisory.joblib` is missing or fails to load, `ml.advisory()` returns `None` and everything else works (covered by a unit test).
* Can be disabled with the engine setting `use_ml_advisory = false`.

## Synthetic dataset (`app/engine/synthetic.py`, `app/engine/ml.py::generate_dataset`)
1. For each of *N* = 6000 samples draw a latent "support need" `z ~ Beta(1.6, 2.2)` (seeded, `seed=42`).
2. Generate each questionnaire answer from `z` with Gaussian noise (σ = 0.7 on the 0–4 concern scale) by choosing the option whose concern value is closest;
   the self-harm item is non-zero with probability rising once `z > 0.55`; 25 % of samples have 15 % of items missing.
3. With probability 0.6 a "previous" check-in is generated from `z_prev = clip(z + N(0, 0.12))` to create change features.
4. Features are computed with the **same engine code** used in production: 7 dimension scores, overall index, change since previous, has-previous flag,
   help-request concern, self-harm-item flag (12 features). **No demographic features.**
5. Label = class of `z + N(0, 0.08)` with cut-points 0.35 / 0.62 (routine / attention / urgent-review). The label is derived from the *latent state*, not from the rule engine's output, so the model is not simply re-learning the rules — but it also is not tied to any real outcome.

## Model and training (`python -m scripts.train_model`)
`StandardScaler` → multinomial `LogisticRegression` (C = 1, interpretable). 75/25 stratified split. A majority-class `DummyClassifier` is the baseline.
The script writes `backend/models/ml_advisory.joblib` and `backend/models/ml_metrics.json`.

## Results of the committed run (synthetic held-out test set, n = 1500)
| Metric | Value |
|---|---|
| Accuracy | 0.7913 |
| Macro-F1 | 0.7855 |
| ROC-AUC (one-vs-rest, macro) | 0.9305 |
| Majority-class baseline accuracy | 0.416 |
| Agreement of model class with the rule engine's level | 0.7047 |

Confusion matrix (rows = true, cols = predicted; routine / attention / urgent): `[[537, 87, 0], [79, 406, 60], [0, 87, 244]]`.
These numbers come from `ml_metrics.json` produced by the script (re-running with the same seed reproduces them on the same library versions). They describe agreement with a
synthetic labelling process only.

## Explainability
For the predicted class the per-feature contribution is `coef × scaled feature`; the top four are returned as "influences".

## Limitations
Synthetic labels; no real-world validation; no calibration claim (class scores are model outputs, not probabilities of harm); linear model cannot capture interactions;
no fairness evaluation is possible without real data. Any future real-data model would need ethical approval, clinical co-design, bias/fairness audits and prospective validation.
