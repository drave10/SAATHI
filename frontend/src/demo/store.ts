/* Browser-side database for the static demo build: typed state, persistence in localStorage, seeded synthetic data. */
import { DEFAULT_CFG, answersFromLatent, evaluate, latentTrajectory, mulberry32, normal, randint, type Cfg, type EngineResult, type Level, type Prior, type Profile } from './engine'

export const DEMO_PASSWORD = 'Demo-pass-1'
const KEY = 'saathi.static-demo.v2'
const DAY = 864e5
export const ORG_UNITS = ['Demo Unit North', 'Demo Unit South', 'Demo Unit East', 'Demo Unit West', 'Demo Unit Central']

export interface DUser { id: number; username: string; display_name: string; role: 'beneficiary' | 'caseworker' | 'admin'; is_active: boolean; is_synthetic: boolean; created_at: string; last_login_at: string | null; password: string; token_version: number }
export interface DBen { id: number; user_id: number; code: string; org_unit: string; age_band: string | null; preferred_language: string; case_status: string; is_synthetic: boolean; deletion_requested_at: string | null; created_at: string }
export interface DCw { id: number; user_id: number; org_unit: string }
export interface DAssign { id: number; beneficiary_id: number; caseworker_id: number; active: boolean; assigned_at: string }
export interface DScore extends EngineResult { review_status: 'pending' | 'reviewed'; reviewed_at: string | null; engine_version: string }
export interface DAssess { id: number; beneficiary_id: number; status: 'draft' | 'submitted'; started_at: string; updated_at: string; submitted_at: string | null; is_synthetic: boolean; answers: Record<string, number>; free_text: string | null; score: DScore | null }
export interface DAlert { id: number; assessment_id: number; beneficiary_id: number; caseworker_id: number | null; level: 'attention' | 'urgent'; reason: string; status: 'open' | 'acknowledged' | 'resolved'; created_at: string; resolved_at: string | null }
export interface DNote { id: number; beneficiary_id: number; author_id: number | null; body: string; created_at: string; is_synthetic: boolean }
export interface DFollowUp { id: number; beneficiary_id: number; caseworker_id: number | null; status: 'requested' | 'scheduled' | 'completed' | 'cancelled'; kind: string; scheduled_for: string | null; requested_by_beneficiary: boolean; reason: string | null; outcome_notes: string | null; completed_at: string | null; created_at: string; is_synthetic: boolean }
export interface DIntervention { id: number; beneficiary_id: number; caseworker_id: number | null; type: string; description: string; outcome: string | null; outcome_notes: string | null; occurred_at: string; created_at: string; is_synthetic: boolean }
export interface DResource { id: number; title: string; category: 'education' | 'support' | 'emergency'; summary: string; body: string; contact: string | null; region: string | null; is_verified: boolean; is_active: boolean; updated_at: string }
export interface DConsent { id: number; user_id: number; consent_type: string; granted: boolean; notice_version: string; created_at: string }
export interface DAudit { id: number; actor_user_id: number | null; actor_role: string | null; action: string; entity_type: string | null; entity_id: number | null; detail: string | null; created_at: string }
export interface DInvite { code: string; org_unit: string; caseworker_id: number | null; expires_at: string; used_at: string | null }

export interface DB {
  version: number; seq: Record<string, number>; cfg: Cfg
  users: DUser[]; bens: DBen[]; cws: DCw[]; assigns: DAssign[]; assessments: DAssess[]; alerts: DAlert[]; notes: DNote[]
  followups: DFollowUp[]; interventions: DIntervention[]; resources: DResource[]; consents: DConsent[]; audit: DAudit[]; invites: DInvite[]
}

const iso = (ms: number) => new Date(ms).toISOString()
export const nowIso = () => new Date().toISOString()
export const nextId = (db: DB, t: string) => { db.seq[t] = (db.seq[t] ?? 0) + 1; return db.seq[t] }

export function audit(db: DB, user: DUser | null, action: string, entityType: string | null = null, entityId: number | null = null, detail: string | null = null) {
  db.audit.push({ id: nextId(db, 'audit'), actor_user_id: user?.id ?? null, actor_role: user?.role ?? null, action, entity_type: entityType, entity_id: entityId, detail: detail?.slice(0, 400) ?? null, created_at: nowIso() })
}

/* ---------------------------------------------------------------- shared scoring side-effects (used by seed and live submit) */
export function historyBefore(db: DB, benId: number, beforeIso: string, excludeId?: number): Prior[] {
  return db.assessments
    .filter((a) => a.beneficiary_id === benId && a.status === 'submitted' && a.score && (a.submitted_at as string) < beforeIso && a.id !== excludeId)
    .sort((a, b) => (a.submitted_at as string).localeCompare(b.submitted_at as string))
    .map((a) => ({ overall: a.score!.overall_score, dimensions: a.score!.dimension_scores, level: a.score!.level as Level }))
}

export function activeAssignment(db: DB, benId: number) { return db.assigns.find((a) => a.beneficiary_id === benId && a.active) }

export function finalizeAssessment(db: DB, a: DAssess) {
  const res = evaluate(a.answers, historyBefore(db, a.beneficiary_id, a.submitted_at ?? nowIso(), a.id), db.cfg)
  a.score = { ...res, review_status: 'pending', reviewed_at: null, engine_version: 'rules-1.0' }
  const cw = activeAssignment(db, a.beneficiary_id)?.caseworker_id ?? null
  if (res.level !== 'routine' && !db.alerts.some((x) => x.assessment_id === a.id && x.level === res.level)) {
    const labels = res.factors.filter((f) => f.severity === 'urgent' || f.severity === 'attention').slice(0, 3).map((f) => f.label)
    db.alerts.push({ id: nextId(db, 'alert'), assessment_id: a.id, beneficiary_id: a.beneficiary_id, caseworker_id: cw, level: res.level as 'attention' | 'urgent',
      reason: `${res.level === 'urgent' ? 'Urgent review' : 'Attention'}: ${labels.join('; ')}`.slice(0, 400), status: 'open', created_at: nowIso(), resolved_at: null })
  }
  if (res.factors.some((f) => f.code === 'help_requested' || f.code === 'help_requested_asap') && !db.followups.some((f) => f.beneficiary_id === a.beneficiary_id && f.status === 'requested')) {
    db.followups.push({ id: nextId(db, 'fu'), beneficiary_id: a.beneficiary_id, caseworker_id: cw, status: 'requested', kind: 'requested_contact', scheduled_for: null, requested_by_beneficiary: true,
      reason: 'Requested via well-being check-in', outcome_notes: null, completed_at: null, created_at: nowIso(), is_synthetic: a.is_synthetic })
  }
  return a.score
}

/* ---------------------------------------------------------------- seed */
const RESOURCES: [DResource['category'], string, string, string, string | null][] = [
  ['education', 'Understanding stress and how the body responds', 'Plain-language overview of common stress reactions and why they happen.', 'Stress reactions such as trouble sleeping, irritability or feeling on edge are common after very difficult experiences. They are not a sign of weakness. Small routines — regular meals, gentle movement, daylight, and time with people you trust — can help. If these feelings are getting in the way of daily life, speak with your support worker.', null],
  ['education', 'Sleep routines that can help', 'Simple, practical steps for winding down and improving rest.', 'Try to keep regular sleep and wake times, limit screens and caffeine late in the day, and keep your sleeping space as calm and dark as you can. If worries keep you awake, writing them down earlier in the evening can help. Persistent sleep difficulty is worth mentioning to your support worker.', null],
  ['education', 'Grounding exercises for difficult moments', 'A short breathing and grounding technique you can use anywhere.', 'Slowly breathe in for four counts and out for six. Notice five things you can see, four you can touch, three you can hear. Repeat until the intensity eases. These techniques are coping tools, not a treatment.', null],
  ['education', 'Talking to someone you trust', 'Ideas for reaching out when things feel heavy.', "You do not need the perfect words. Something like 'I have been finding things hard lately and would like to talk' is enough. Your support worker is available if you would like help starting that conversation.", null],
  ['education', 'About your privacy in SAATHI', 'How your check-in information is used and who can see it.', 'Your answers are visible to your authorised support worker. Administrators only see aggregated statistics. You can change your consent choices, export your data, or request deletion in Settings & Privacy.', null],
  ['education', 'Taking care of yourself day to day', 'Everyday habits that support well-being.', 'Eat regularly, move your body in ways you enjoy, spend time outdoors, and keep contact with supportive people. Be patient with yourself — recovery is not a straight line.', null],
  ['support', 'Tele-MANAS national mental health helpline', 'Free tele-counselling support (national programme).', 'Placeholder entry seeded for the demo. An administrator must verify the number and hours before real-world use.', '14416'],
  ['support', 'Local legal aid and rehabilitation desk (demo)', "Sample entry — replace with your district's verified service.", "Replace this entry with the verified contact details of the legal-aid and rehabilitation service for your district.", '(configure in Admin → Resources)'],
  ['support', 'Community support group (demo)', 'Sample peer-support group entry.', 'Replace with details of verified local peer-support groups.', '(configure in Admin → Resources)'],
  ['emergency', 'National emergency number', 'If you or someone else is in immediate danger.', 'Placeholder entry seeded for the demo. An administrator must verify before real-world use.', '112'],
  ['emergency', 'Tele-MANAS 24x7 helpline', 'Talk to a trained counsellor at any time.', 'Placeholder entry seeded for the demo. An administrator must verify before real-world use.', '14416'],
  ['emergency', 'Your support worker', 'Contact your assigned support worker directly.', 'Use the contact method agreed with your support worker. Administrators can add a local desk number here.', '(configure in Admin → Resources)'],
]
const PROFILES: Profile[] = [...Array(8).fill('stable_low'), ...Array(4).fill('stable_mid'), ...Array(2).fill('stable_high'), ...Array(4).fill('improving'), ...Array(5).fill('declining'), ...Array(2).fill('volatile')]
const LANGS = ['English', 'Hindi', 'Marathi', 'Tamil', 'Bengali']
const AGES = ['18-24', '25-34', '35-44', '45-59', '60+']
const SYN_TEXT = ['(synthetic) Sleeping a little better this week.', '(synthetic) Worried about the upcoming hearing date.', '(synthetic) Would like a visit sometime next week.', '(synthetic) Nothing else to add.']
const NOTES = ['(synthetic) Initial contact made; rapport building in progress.', '(synthetic) Discussed sleep routine and local support group options.', '(synthetic) Beneficiary reports improved access to community support.', '(synthetic) Agreed next check-in; shared helpline information.', '(synthetic) Reviewed latest check-in together; no immediate concerns raised.']
export const INTERVENTION_TYPES = ['counselling_session', 'home_visit', 'phone_check_in', 'referral_health', 'referral_legal_aid', 'referral_social_support', 'community_support_group', 'safety_planning', 'other']
const NAME_OVERRIDES: Record<number, string> = { 1: 'Debashish' }

export function seedDb(seed = 2026): DB {
  const rng = mulberry32(seed), now = Date.now()
  const db: DB = { version: 2, seq: {}, cfg: structuredClone(DEFAULT_CFG), users: [], bens: [], cws: [], assigns: [], assessments: [], alerts: [], notes: [], followups: [], interventions: [], resources: [], consents: [], audit: [], invites: [] }
  const mkUser = (username: string, display: string, role: DUser['role']): DUser => {
    const u: DUser = { id: nextId(db, 'user'), username, display_name: display, role, is_active: true, is_synthetic: true, created_at: iso(now - 150 * DAY), last_login_at: null, password: DEMO_PASSWORD, token_version: 0 }
    db.users.push(u); return u
  }
  mkUser('admin', 'Demo Administrator (synthetic)', 'admin')
  ORG_UNITS.forEach((unit, i) => { const u = mkUser(`caseworker${i + 1}`, `Demo Caseworker ${String.fromCharCode(65 + i)} (synthetic)`, 'caseworker'); db.cws.push({ id: nextId(db, 'cw'), user_id: u.id, org_unit: unit }) })
  RESOURCES.forEach(([category, title, summary, body, contact]) => db.resources.push({ id: nextId(db, 'res'), title, category, summary, body, contact, region: null, is_verified: false, is_active: true, updated_at: nowIso() }))

  const profiles = [...PROFILES]
  for (let i = profiles.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[profiles[i], profiles[j]] = [profiles[j], profiles[i]] }

  for (let i = 0; i < 25; i++) {
    const cw = db.cws[i % 5]
    const u = mkUser(`ben${String(i + 1).padStart(3, '0')}`, `${NAME_OVERRIDES[i + 1] ?? `Participant ${String(i + 1).padStart(3, '0')}`} (synthetic)`, 'beneficiary')
    const b: DBen = { id: nextId(db, 'ben'), user_id: u.id, code: `BEN-${String(i + 1).padStart(5, '0')}`, org_unit: cw.org_unit, age_band: AGES[randint(rng, 0, 5)], preferred_language: LANGS[randint(rng, 0, 5)], case_status: 'open', is_synthetic: true, deletion_requested_at: null, created_at: iso(now - 150 * DAY) }
    db.bens.push(b)
    db.assigns.push({ id: nextId(db, 'assign'), beneficiary_id: b.id, caseworker_id: cw.id, active: true, assigned_at: iso(now - 148 * DAY) })
    for (const [t, g] of [['privacy_notice', true], ['assessment_data', true], ['analytics_use', rng() > 0.15]] as const) db.consents.push({ id: nextId(db, 'consent'), user_id: u.id, consent_type: t, granted: g, notice_version: '1.0', created_at: iso(now - 149 * DAY) })

    const profile = profiles[i], n = randint(rng, 2, 6)
    const gap = [1, 3, 6, 9, 12, 18, 24][randint(rng, 0, 7)]
    let zs = latentTrajectory(rng, n, profile)
    if (profile === 'stable_high') zs = zs.map((z) => Math.max(z, 0.72))
    let prevZ: number | null = null
    const mine: DAssess[] = []
    zs.forEach((z, k) => {
      const when = now - (gap + 14 * (n - 1 - k) + randint(rng, -1, 2)) * DAY
      const ans = answersFromLatent(z, rng, i === 7 && k === n - 1 ? 0.3 : 0)
      const dz = prevZ === null ? 0 : z - prevZ
      ans['chg_1'] = dz > 0.25 ? 4 : dz > 0.12 ? 3 : dz < -0.1 ? 1 : 2
      prevZ = z
      const a: DAssess = { id: nextId(db, 'assess'), beneficiary_id: b.id, status: 'submitted', started_at: iso(when - 9 * 60e3), updated_at: iso(when), submitted_at: iso(when), is_synthetic: true, answers: ans, free_text: rng() < 0.25 ? SYN_TEXT[randint(rng, 0, 4)] : null, score: null }
      db.assessments.push(a); finalizeAssessment(db, a); mine.push(a)
    })
    const latest = mine[mine.length - 1]
    mine.slice(0, -1).forEach((a) => { a.score!.review_status = 'reviewed'; a.score!.reviewed_at = iso(Date.parse(a.submitted_at!) + DAY) })
    db.alerts.filter((x) => x.beneficiary_id === b.id).forEach((al) => {
      if (al.assessment_id !== latest.id) { al.status = 'resolved'; al.resolved_at = iso(Date.parse(al.created_at) + DAY) } else if (rng() < 0.25) al.status = 'acknowledged'
    })
    db.followups.filter((f) => f.beneficiary_id === b.id && f.status === 'requested').forEach((f) => { if (rng() < 0.5) { f.status = 'scheduled'; f.scheduled_for = iso(now + randint(rng, -4, 7) * DAY) } })
    for (let k = randint(rng, 1, 3); k > 0; k--) {
      const w = now - randint(rng, 10, 80) * DAY
      db.followups.push({ id: nextId(db, 'fu'), beneficiary_id: b.id, caseworker_id: cw.id, status: 'completed', kind: ['check_in', 'home_visit', 'counselling'][randint(rng, 0, 3)], scheduled_for: iso(w), requested_by_beneficiary: false, reason: null, outcome_notes: '(synthetic) Follow-up completed.', completed_at: iso(w + 3600e3), created_at: iso(w - 5 * DAY), is_synthetic: true })
    }
    const roll = rng()
    if (roll < 0.5) db.followups.push({ id: nextId(db, 'fu'), beneficiary_id: b.id, caseworker_id: cw.id, status: 'scheduled', kind: 'check_in', scheduled_for: iso(now + randint(rng, 1, 10) * DAY), requested_by_beneficiary: false, reason: null, outcome_notes: null, completed_at: null, created_at: nowIso(), is_synthetic: true })
    else if (roll < 0.72) db.followups.push({ id: nextId(db, 'fu'), beneficiary_id: b.id, caseworker_id: cw.id, status: 'scheduled', kind: 'check_in', scheduled_for: iso(now - randint(rng, 1, 6) * DAY), requested_by_beneficiary: false, reason: null, outcome_notes: null, completed_at: null, created_at: iso(now - 12 * DAY), is_synthetic: true })
    const pool = { improving: ['improved', 'improved', 'no_change'], declining: ['no_change', 'worsened', 'pending', 'referred'], stable_low: ['improved', 'no_change'], stable_mid: ['no_change', 'improved', 'referred'], stable_high: ['referred', 'no_change', 'pending'], volatile: ['no_change', 'pending', 'referred'] }[profile]
    for (let k = randint(rng, 1, 4); k > 0; k--) {
      const t = INTERVENTION_TYPES[randint(rng, 0, 8)]
      db.interventions.push({ id: nextId(db, 'iv'), beneficiary_id: b.id, caseworker_id: cw.id, type: t, description: `(synthetic) ${t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())} provided.`, outcome: pool[randint(rng, 0, pool.length)], outcome_notes: '(synthetic) Outcome recorded by caseworker.', occurred_at: iso(now - randint(rng, 3, 100) * DAY), created_at: nowIso(), is_synthetic: true })
    }
    for (let k = randint(rng, 1, 3); k > 0; k--) db.notes.push({ id: nextId(db, 'note'), beneficiary_id: b.id, author_id: cw.user_id, body: NOTES[randint(rng, 0, 5)], created_at: iso(now - randint(rng, 1, 90) * DAY), is_synthetic: true })
    b.case_status = latest.score!.level === 'urgent' ? 'follow_up_needed' : latest.score!.level === 'attention' ? 'monitoring' : 'open'
  }
  void normal
  audit(db, db.users[0], 'seed_run', null, null, 'synthetic demo data generated in the browser')
  return db
}

/* ---------------------------------------------------------------- persistence */
let mem: DB | null = null
export function loadDb(): DB {
  if (mem) return mem
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) { const d = JSON.parse(raw) as DB; if (d.version === 2) { mem = d; return d } }
  } catch { /* corrupted or unavailable storage: fall through to a fresh seed */ }
  mem = seedDb(); saveDb(); return mem
}
export function saveDb() { try { if (mem) localStorage.setItem(KEY, JSON.stringify(mem)) } catch { /* storage full / blocked: keep working in memory */ } }
export function resetDb() { mem = seedDb(); saveDb(); return mem }
export function _setDbForTests(d: DB | null) { mem = d }
