/* In-browser port of backend/app/engine (questionnaire + transparent rule-based review priority).
   Used only by the static demo build; the real backend remains the source of truth in server mode. */

export const QUESTIONNAIRE_VERSION = 'saathi-proto-1.0'
export const ENGINE_VERSION = 'rules-1.0'

export const DIMENSIONS: Record<string, string> = {
  emotional: 'Emotional well-being', stress: 'Stress', sleep: 'Sleep quality', safety: 'Feelings of safety',
  social: 'Social support', difficulties: 'Emotional difficulties', functioning: 'Daily activities',
}

const FREQ = ['Not at all', 'Rarely', 'Sometimes', 'Often', 'Almost always']
const FREQ_REV = ['Almost always', 'Often', 'Sometimes', 'Rarely', 'Not at all']
const DAYS = ['Not at all', 'Several days', 'More than half the days', 'Nearly every day']

export interface QItem {
  id: string; dimension: string; type: 'likert' | 'text'; text: string; options: { value: number; label: string }[]
  concern: number[]; critical: boolean; required: boolean; help: string | null
}

const opts = (labels: string[]) => labels.map((label, value) => ({ value, label }))
const q = (id: string, dimension: string, text: string, labels: string[], concern: number[], o: { critical?: boolean; help?: string } = {}): QItem =>
  ({ id, dimension, type: 'likert', text, options: opts(labels), concern, critical: !!o.critical, required: true, help: o.help ?? null })

export const QUESTIONS: QItem[] = [
  q('emo_1', 'emotional', 'Over the last two weeks, how often have you felt low or down?', FREQ, [0, 1, 2, 3, 4]),
  q('emo_2', 'emotional', 'How often have you felt calm and able to enjoy things?', FREQ_REV, [4, 3, 2, 1, 0]),
  q('str_1', 'stress', 'How often have you felt under a lot of stress?', FREQ, [0, 1, 2, 3, 4]),
  q('str_2', 'stress', 'How often have you felt overwhelmed by the things you need to handle?', FREQ, [0, 1, 2, 3, 4]),
  q('slp_1', 'sleep', 'How often have you had trouble falling asleep or staying asleep?', FREQ, [0, 1, 2, 3, 4]),
  q('slp_2', 'sleep', 'How rested have you felt when you wake up?', FREQ_REV, [4, 3, 2, 1, 0], { help: "'Almost always' means you usually wake up feeling rested." }),
  q('saf_1', 'safety', 'How safe have you felt in the place where you are staying?', FREQ_REV, [4, 3, 2, 1, 0], { critical: true }),
  q('saf_2', 'safety', 'How often have you felt afraid for your own safety?', FREQ, [0, 1, 2, 3, 4], { critical: true }),
  q('soc_1', 'social', 'How often have you had someone you could talk to when you needed support?', FREQ_REV, [4, 3, 2, 1, 0]),
  q('soc_2', 'social', 'How often have you felt isolated or alone?', FREQ, [0, 1, 2, 3, 4]),
  q('dif_1', 'difficulties', 'How often have upsetting memories or worries been hard to put aside?', FREQ, [0, 1, 2, 3, 4]),
  q('dif_2', 'difficulties', 'How often have you felt that things are too hard to keep going?', FREQ, [0, 1, 2, 3, 4]),
  q('fun_1', 'functioning', 'How much difficulty have you had with everyday activities such as work, household tasks or self-care?', ['None', 'A little', 'Some', 'A lot', 'Extreme'], [0, 1, 2, 3, 4]),
  q('fun_2', 'functioning', 'How often have you been able to get done the things you planned for the day?', FREQ_REV, [4, 3, 2, 1, 0]),
  q('safe_self', 'safety', 'In the last two weeks, how often have you had thoughts of hurting yourself, or that you would be better off not being here?', DAYS, [0, 2, 3, 4],
    { critical: true, help: 'Your answer is shared only with your authorised support worker. If you are in danger right now, please contact emergency services.' }),
  q('chg_1', 'change', 'Compared with your last check-in, how have you been feeling overall?', ['Much better', 'A little better', 'About the same', 'A little worse', 'Much worse'], [0, 0, 1, 3, 4],
    { help: "If this is your first check-in, choose 'About the same'." }),
  q('help_1', 'support_request', 'Would you like to speak with a support professional?', ['No, not at the moment', 'Maybe later', 'Yes, within the next few days', 'Yes, as soon as possible'], [0, 1, 3, 4]),
  { id: 'text_1', dimension: 'free_text', type: 'text', text: 'Is there anything else you would like your support worker to know? (optional)', options: [], concern: [], critical: false, required: false, help: 'Free text is read only by people; it is not scored by the system.' },
]

export const QINDEX: Record<string, QItem> = Object.fromEntries(QUESTIONS.map((x) => [x.id, x]))
export const LIKERT_IDS = QUESTIONS.filter((x) => x.type === 'likert').map((x) => x.id)
export const REQUIRED_IDS = QUESTIONS.filter((x) => x.required).map((x) => x.id)
export const concernOf = (qid: string, v: number) => QINDEX[qid].concern[v]

export function publicQuestionnaire() {
  return {
    version: QUESTIONNAIRE_VERSION, title: 'SAATHI well-being check-in',
    disclaimer: 'This is a prototype check-in to help your support team understand how you are doing. It is not a medical test and does not diagnose any condition.',
    dimensions: DIMENSIONS,
    items: QUESTIONS.map(({ concern: _c, ...rest }) => rest),
  }
}

export function validateAnswer(qid: string, v: unknown): string | null {
  const it = QINDEX[qid]
  if (!it) return 'Unknown question'
  if (it.type === 'text') return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= it.options.length) return `Invalid answer for '${qid}'.`
  return null
}

/* ---------------------------------------------------------------- configuration */
export interface Cfg {
  dimension_weights: Record<string, number>; min_completion: number; attention_overall: number; urgent_overall: number
  attention_dimension: number; urgent_dimension_safety: number; rise_attention: number; rise_urgent: number
  dimension_rise_attention: number; persistence_dimension: number; persistence_window: number; persistence_min_count: number
  self_report_worse_concern: number; critical_self_harm_item: boolean; critical_unsafe_concern: number
  help_attention_concern: number; help_urgent_concern: number; assessment_interval_days: number; use_ml_advisory: boolean
}

export const DEFAULT_CFG: Cfg = {
  dimension_weights: { emotional: 1, stress: 1, sleep: 1, safety: 1.5, social: 1, difficulties: 1, functioning: 1 },
  min_completion: 0.6, attention_overall: 40, urgent_overall: 70, attention_dimension: 65, urgent_dimension_safety: 75,
  rise_attention: 15, rise_urgent: 30, dimension_rise_attention: 25, persistence_dimension: 50, persistence_window: 3,
  persistence_min_count: 2, self_report_worse_concern: 3, critical_self_harm_item: true, critical_unsafe_concern: 3,
  help_attention_concern: 3, help_urgent_concern: 4, assessment_interval_days: 14, use_ml_advisory: false,
}

export function validateCfg(data: Record<string, unknown>): string[] {
  const errors: string[] = []
  for (const k of Object.keys(data)) if (!(k in DEFAULT_CFG)) errors.push(`Unknown setting '${k}'.`)
  const m = { ...DEFAULT_CFG, ...data } as Cfg
  if (!(0 < m.attention_overall && m.attention_overall < m.urgent_overall && m.urgent_overall <= 100)) errors.push('Require 0 < attention_overall < urgent_overall <= 100.')
  if (!(0 < m.min_completion && m.min_completion <= 1)) errors.push('min_completion must be in (0, 1].')
  if (!(0 < m.rise_attention && m.rise_attention < m.rise_urgent && m.rise_urgent <= 100)) errors.push('Require 0 < rise_attention < rise_urgent <= 100.')
  if (m.persistence_min_count > m.persistence_window || m.persistence_window < 1) errors.push('persistence_min_count must be <= persistence_window (>=1).')
  if (m.assessment_interval_days < 1) errors.push('assessment_interval_days must be >= 1.')
  return errors
}

/* ---------------------------------------------------------------- scoring */
export type Level = 'routine' | 'attention' | 'urgent'
export const LEVEL_ORDER: Record<Level, number> = { routine: 0, attention: 1, urgent: 2 }
export const LEVEL_LABEL: Record<Level, string> = { routine: 'Routine', attention: 'Attention', urgent: 'Urgent review' }
export interface Prior { overall: number | null; dimensions: Record<string, number | null>; level?: Level }
export interface Factor { code: string; label: string; severity: string; detail: string; dimension: string | null; value: number | null }
export interface EngineResult {
  level: Level; overall_score: number | null; dimension_scores: Record<string, number | null>; factors: Factor[]
  change_summary: { has_previous: boolean; overall_delta: number | null; dimension_deltas: Record<string, number>; persistent_dimensions: string[] }
  data_quality: { answered_items: number; total_items: number; completion: number; reliable_for_thresholds: boolean; note: string | null }
}

const r1 = (x: number) => Math.round(x * 10) / 10
const fac = (code: string, label: string, severity: string, detail: string, dimension: string | null = null, value: number | null = null): Factor => ({ code, label, severity, detail, dimension, value })

export function dimensionScores(answers: Record<string, number>) {
  const buckets: Record<string, number[]> = Object.fromEntries(Object.keys(DIMENSIONS).map((d) => [d, []]))
  let answered = 0
  for (const qid of LIKERT_IDS) {
    const v = answers[qid]
    if (v === undefined || v === null) continue
    answered++
    const dim = QINDEX[qid].dimension
    if (dim in buckets) buckets[dim].push(concernOf(qid, v))
  }
  const scores: Record<string, number | null> = {}
  for (const [d, vals] of Object.entries(buckets)) scores[d] = vals.length ? r1((vals.reduce((a, b) => a + b, 0) / (4 * vals.length)) * 100) : null
  return { scores, answered }
}

export function overallOf(dims: Record<string, number | null>, cfg: Cfg): number | null {
  let num = 0, den = 0
  for (const [d, s] of Object.entries(dims)) {
    if (s === null) continue
    const w = Number(cfg.dimension_weights[d] ?? 1)
    num += w * s; den += w
  }
  return den > 0 ? r1(num / den) : null
}

export function evaluate(answers: Record<string, number>, history: Prior[] = [], cfg: Cfg = DEFAULT_CFG): EngineResult {
  const factors: Factor[] = []
  let level: Level = 'routine'
  const raise = (n: Level) => { if (LEVEL_ORDER[n] > LEVEL_ORDER[level]) level = n }
  const { scores: dims, answered } = dimensionScores(answers)
  const overall = overallOf(dims, cfg)
  const completion = answered / LIKERT_IDS.length
  const reliable = completion >= cfg.min_completion
  const dq = { answered_items: answered, total_items: LIKERT_IDS.length, completion: Math.round(completion * 100) / 100, reliable_for_thresholds: reliable,
    note: reliable ? null : 'Too few items answered; threshold rules were not applied (critical items still are).' }

  const sh = answers['safe_self']
  if (cfg.critical_self_harm_item && sh !== undefined && sh > 0) {
    raise('urgent')
    factors.push(fac('critical_self_harm_item', 'Reported thoughts of self-harm', 'urgent', "The person answered the self-harm safety item above 'Not at all'. Prompt human contact is recommended.", 'safety', sh))
  }
  for (const [qid, label] of [['saf_1', 'Reported feeling unsafe where staying'], ['saf_2', 'Reported frequently being afraid for own safety']] as const) {
    const v = answers[qid]
    if (v !== undefined && concernOf(qid, v) >= cfg.critical_unsafe_concern) {
      raise('urgent')
      factors.push(fac(`critical_${qid}`, label, 'urgent', 'Self-reported safety answer is at the highest-concern levels.', 'safety', concernOf(qid, v)))
    }
  }
  const hv = answers['help_1']
  if (hv !== undefined) {
    const hc = concernOf('help_1', hv)
    if (hc >= cfg.help_urgent_concern) { raise('urgent'); factors.push(fac('help_requested_asap', 'Asked to speak to someone as soon as possible', 'urgent', 'The person requested contact as soon as possible.', 'support_request', hc)) }
    else if (hc >= cfg.help_attention_concern) { raise('attention'); factors.push(fac('help_requested', 'Asked to speak to someone within a few days', 'attention', 'The person requested contact with a support professional.', 'support_request', hc)) }
  }

  if (reliable && overall !== null) {
    if (overall >= cfg.urgent_overall) { raise('urgent'); factors.push(fac('overall_very_high', 'Overall concern index very high', 'urgent', `Overall concern index ${overall} ≥ ${cfg.urgent_overall}.`, null, overall)) }
    else if (overall >= cfg.attention_overall) { raise('attention'); factors.push(fac('overall_elevated', 'Overall concern index elevated', 'attention', `Overall concern index ${overall} ≥ ${cfg.attention_overall}.`, null, overall)) }
    for (const [d, s] of Object.entries(dims)) {
      if (s === null) continue
      if (d === 'safety' && s >= cfg.urgent_dimension_safety) { raise('urgent'); factors.push(fac('safety_dimension_very_high', 'Safety dimension very high', 'urgent', `Safety dimension ${s} ≥ ${cfg.urgent_dimension_safety}.`, d, s)) }
      else if (s >= cfg.attention_dimension) { raise('attention'); factors.push(fac(`dimension_high_${d}`, `${DIMENSIONS[d]} high`, 'attention', `${DIMENSIONS[d]} score ${s} ≥ ${cfg.attention_dimension}.`, d, s)) }
    }
    const chg = answers['chg_1']
    if (chg !== undefined && concernOf('chg_1', chg) >= cfg.self_report_worse_concern) {
      raise('attention'); factors.push(fac('self_reported_worse', 'Reports feeling worse than last check-in', 'attention', "Self-reported change since the previous check-in is 'worse' or 'much worse'.", null, concernOf('chg_1', chg)))
    }
  }

  const change: EngineResult['change_summary'] = { has_previous: history.length > 0, overall_delta: null, dimension_deltas: {}, persistent_dimensions: [] }
  const prev = [...history].reverse().find((h) => h.overall !== null)
  if (prev && overall !== null) {
    const delta = r1(overall - (prev.overall as number))
    change.overall_delta = delta
    for (const d of Object.keys(DIMENSIONS)) { const a = dims[d], b = prev.dimensions[d]; if (a != null && b != null) change.dimension_deltas[d] = r1(a - b) }
    if (reliable) {
      if (delta >= cfg.rise_urgent) { raise('urgent'); factors.push(fac('sharp_rise', 'Sharp rise in overall concern index', 'urgent', `Overall index rose by ${delta} points since the previous check-in (≥ ${cfg.rise_urgent}).`, null, delta)) }
      else if (delta >= cfg.rise_attention) { raise('attention'); factors.push(fac('rise', 'Rise in overall concern index', 'attention', `Overall index rose by ${delta} points since the previous check-in (≥ ${cfg.rise_attention}).`, null, delta)) }
      for (const d of ['sleep', 'functioning']) {
        const dd = change.dimension_deltas[d]
        if (dd !== undefined && dd >= cfg.dimension_rise_attention) { raise('attention'); factors.push(fac(`${d}_decline`, `${DIMENSIONS[d]} has worsened`, 'attention', `${DIMENSIONS[d]} score rose by ${dd} points since the previous check-in.`, d, dd)) }
      }
    }
  }
  const win: Prior[] = [...(overall !== null ? [{ overall, dimensions: dims } as Prior] : []), ...[...history].reverse()].slice(0, cfg.persistence_window)
  if (reliable && win.length >= 2) {
    for (const d of Object.keys(DIMENSIONS)) {
      const count = win.filter((w) => w.dimensions[d] != null && (w.dimensions[d] as number) >= cfg.persistence_dimension).length
      const cur = dims[d]
      if (count >= cfg.persistence_min_count && cur != null && cur >= cfg.persistence_dimension) {
        change.persistent_dimensions.push(d); raise('attention')
        factors.push(fac(`persistent_${d}`, `Persistently elevated: ${DIMENSIONS[d]}`, 'attention', `${DIMENSIONS[d]} was at or above ${cfg.persistence_dimension} in ${count} of the last ${win.length} check-ins.`, d, count))
      }
    }
  }
  if (!factors.length) factors.push(fac('no_new_indicators', 'No significant new indicators', 'info', 'No rule was triggered by this check-in.'))
  const rank: Record<string, number> = { urgent: 3, attention: 2, info: 1 }
  factors.sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0))
  return { level, overall_score: overall, dimension_scores: dims, factors, change_summary: change, data_quality: dq }
}

export const wellbeing = (concern: number | null | undefined) => (concern == null ? null : r1(100 - concern))

/* ---------------------------------------------------------------- synthetic generator (seeded) */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
export type Rng = ReturnType<typeof mulberry32>
export const normal = (rng: Rng, mu = 0, sd = 1) => { const u = Math.max(rng(), 1e-9), v = rng(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) }
export const randint = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo))
const clip = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function answersFromLatent(z: number, rng: Rng, missingRate = 0, noise = 0.7): Record<string, number> {
  const out: Record<string, number> = {}
  for (const qid of LIKERT_IDS) {
    const it = QINDEX[qid]
    if (missingRate && rng() < missingRate) continue
    const n = it.options.length, maxC = Math.max(...it.concern)
    if (qid === 'safe_self') { const p = Math.max(0, z - 0.55) * 1.2; out[qid] = rng() > p ? 0 : randint(rng, 1, n); continue }
    const target = clip(z * maxC + normal(rng, 0, noise), 0, maxC)
    let best = 0, bd = 1e9
    it.concern.forEach((c, i) => { const d = Math.abs(c - target); if (d < bd) { bd = d; best = i } })
    out[qid] = best
  }
  return out
}

export type Profile = 'stable_low' | 'stable_mid' | 'stable_high' | 'improving' | 'declining' | 'volatile'
export function latentTrajectory(rng: Rng, n: number, profile: Profile): number[] {
  const base = { stable_low: 0.12, stable_mid: 0.4, stable_high: 0.7, improving: 0.65, declining: 0.2, volatile: 0.35 }[profile]
  const out: number[] = []; let z = base
  for (let i = 0; i < n; i++) {
    if (profile === 'improving') z = Math.max(0.05, z - (0.04 + rng() * 0.08))
    else if (profile === 'declining') z = Math.min(0.95, z + (0.05 + rng() * 0.1))
    else if (profile === 'volatile') z = clip(base + normal(rng, 0, 0.2), 0.02, 0.98)
    else z = clip(base + normal(rng, 0, 0.05), 0.02, 0.98)
    out.push(z)
  }
  return out
}
