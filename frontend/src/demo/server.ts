/* In-browser implementation of the SAATHI REST API for the static demo build.
   Mirrors the FastAPI routers (backend/app/routers) for every endpoint the UI uses, including role checks. */
import { DEFAULT_CFG, LEVEL_LABEL, QINDEX, QUESTIONS, QUESTIONNAIRE_VERSION, REQUIRED_IDS, publicQuestionnaire, validateAnswer, validateCfg, wellbeing, type Level } from './engine'
import {
  DEMO_PASSWORD, INTERVENTION_TYPES, ORG_UNITS, activeAssignment, audit, finalizeAssessment, loadDb, nextId, nowIso, saveDb, resetDb,
  type DAssess, type DB, type DBen, type DUser,
} from './store'

export class HttpError extends Error { constructor(public status: number, public detail: unknown, public errors?: unknown) { super(typeof detail === 'string' ? detail : 'error') } }
interface Res { status: number; data: unknown }
const ok = (data: unknown, status = 200): Res => ({ status, data })
const DAY = 864e5
const FORBIDDEN = 'You do not have permission to perform this action'

interface Ctx { db: DB; user: DUser | null; params: Record<string, string>; query: Record<string, any>; body: any }
type Handler = (c: Ctx) => Res | unknown
const routes: { method: string; re: RegExp; keys: string[]; fn: Handler }[] = []
function route(method: string, path: string, fn: Handler) {
  const keys: string[] = []
  const re = new RegExp('^' + path.replace(/:([a-z_]+)/g, (_m, k) => { keys.push(k); return '([^/]+)' }) + '$')
  routes.push({ method, re, keys, fn })
}

/* ---------------------------------------------------------------- helpers */
const pubUser = (u: DUser) => { const { password: _p, token_version: _t, ...rest } = u; return rest }
const tokenFor = (u: DUser) => `demo.${u.id}.${u.token_version}`
const userOf = (db: DB, id: number) => db.users.find((u) => u.id === id)!
const cwOfUser = (db: DB, u: DUser) => db.cws.find((c) => c.user_id === u.id) ?? null
const benOfUser = (db: DB, u: DUser) => db.bens.find((b) => b.user_id === u.id) ?? null
const req = (c: Ctx, ...roles: string[]): DUser => {
  if (!c.user) throw new HttpError(401, 'Not authenticated')
  if (roles.length && !roles.includes(c.user.role)) throw new HttpError(403, FORBIDDEN)
  return c.user
}
function authorizeBen(c: Ctx, benId: number, allowAdminProfile = false): DBen {
  const user = req(c)
  const b = c.db.bens.find((x) => x.id === benId)
  if (!b) throw new HttpError(404, 'Beneficiary not found')
  if (user.role === 'beneficiary') { if (b.user_id !== user.id) throw new HttpError(404, 'Beneficiary not found') }
  else if (user.role === 'caseworker') {
    const cw = cwOfUser(c.db, user), a = activeAssignment(c.db, b.id)
    if (!cw || !a || a.caseworker_id !== cw.id) throw new HttpError(404, 'Beneficiary not found')
  } else if (!allowAdminProfile) throw new HttpError(403, 'Administrators cannot access individual assessment or case content')
  return b
}
const myBen = (c: Ctx) => { const b = benOfUser(c.db, req(c, 'beneficiary')); if (!b) throw new HttpError(404, 'No beneficiary profile for this user'); return b }
const myCwBens = (c: Ctx) => { const cw = cwOfUser(c.db, req(c, 'caseworker')); return c.db.bens.filter((b) => cw && activeAssignment(c.db, b.id)?.caseworker_id === cw.id) }
const submitted = (db: DB, benId: number) => db.assessments.filter((a) => a.beneficiary_id === benId && a.status === 'submitted' && a.score).sort((a, b) => a.submitted_at!.localeCompare(b.submitted_at!))
const page = <T,>(items: T[], q: Record<string, any>, dflt = 20) => {
  const p = Math.max(1, Number(q.page ?? 1)), size = Math.min(200, Math.max(1, Number(q.page_size ?? dflt)))
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, page_size: size }
}
const pwProblem = (pw: string) => (pw.length < 8 ? 'Password must be at least 8 characters.' : /^[A-Za-z]+$/.test(pw) || /^\d+$/.test(pw) ? 'Password must mix letters with numbers or symbols.' : null)
const code = (n = 12) => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('')
const benOut = (b: DBen) => ({ id: b.id, code: b.code, org_unit: b.org_unit, age_band: b.age_band, preferred_language: b.preferred_language, case_status: b.case_status, is_synthetic: b.is_synthetic, created_at: b.created_at })
const LRANK: Record<string, number> = { urgent: 0, attention: 1, routine: 2 }

function caseRow(db: DB, b: DBen, clinical = true) {
  const now = Date.now(), a = activeAssignment(db, b.id), cw = a ? db.cws.find((x) => x.id === a.caseworker_id) : undefined
  const row: Record<string, any> = {
    id: b.id, code: b.code, display_name: userOf(db, b.user_id).display_name, org_unit: b.org_unit, case_status: b.case_status, is_synthetic: b.is_synthetic,
    caseworker_id: cw?.id ?? null, caseworker_name: cw ? userOf(db, cw.user_id).display_name : null, deletion_requested: !!b.deletion_requested_at,
  }
  if (!clinical) return row
  const subs = submitted(db, b.id), last = subs[subs.length - 1], prev = subs[subs.length - 2], s = last?.score
  const delta = last && prev && s!.overall_score != null && prev.score!.overall_score != null ? Math.round((s!.overall_score - prev.score!.overall_score!) * 10) / 10 : null
  const fus = db.followups.filter((f) => f.beneficiary_id === b.id && (f.status === 'scheduled' || f.status === 'requested'))
  const nextFu = fus.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) >= now).sort((x, y) => x.scheduled_for!.localeCompare(y.scheduled_for!))[0]
  const dueBy = last ? Date.parse(last.submitted_at!) + db.cfg.assessment_interval_days * DAY : null
  Object.assign(row, {
    latest: last ? { assessment_id: last.id, submitted_at: last.submitted_at, priority_level: s!.level, overall_score: s!.overall_score, review_status: s!.review_status, delta } : null,
    needs_review: !!(s && s.level !== 'routine' && s.review_status === 'pending'),
    open_alerts: db.alerts.filter((x) => x.beneficiary_id === b.id && x.status === 'open').length,
    requested_followups: fus.filter((f) => f.status === 'requested').length,
    next_followup: nextFu?.scheduled_for ?? null,
    overdue_followups: fus.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) < now).length,
    assessment_due: !last || (dueBy !== null && dueBy < now),
  })
  return row
}
const fuOut = (db: DB, f: DB['followups'][number], user: DUser) => {
  const o: Record<string, any> = { ...f, is_overdue: !!(f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) < Date.now()) }
  if (user.role === 'caseworker') { const b = db.bens.find((x) => x.id === f.beneficiary_id)!; o.beneficiary_code = b.code; o.beneficiary_name = userOf(db, b.user_id).display_name }
  return o
}
const ivOut = (db: DB, i: DB['interventions'][number]) => { const b = db.bens.find((x) => x.id === i.beneficiary_id)!; return { ...i, beneficiary_code: b.code, beneficiary_name: userOf(db, b.user_id).display_name } }
const alertOut = (db: DB, a: DB['alerts'][number]) => { const b = db.bens.find((x) => x.id === a.beneficiary_id)!; return { ...a, beneficiary_code: b.code, beneficiary_name: userOf(db, b.user_id).display_name } }

function assessSummary(a: DAssess, user: DUser) {
  const base: Record<string, any> = { id: a.id, beneficiary_id: a.beneficiary_id, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, questionnaire_version: QUESTIONNAIRE_VERSION, is_synthetic: a.is_synthetic }
  const s = a.score
  if (!s) return base
  if (user.role === 'beneficiary') {
    base.wellbeing_index = wellbeing(s.overall_score)
    base.dimension_wellbeing = Object.fromEntries(Object.entries(s.dimension_scores).map(([d, v]) => [d, wellbeing(v)]))
  } else Object.assign(base, { priority_level: s.level, overall_score: s.overall_score, dimension_scores: s.dimension_scores, review_status: s.review_status })
  return base
}
function loadAssess(c: Ctx, id: number): DAssess {
  const a = c.db.assessments.find((x) => x.id === id)
  if (!a) throw new HttpError(404, 'Assessment not found')
  authorizeBen(c, a.beneficiary_id)
  return a
}

/* ---------------------------------------------------------------- auth */
route('GET', '/auth/config', () => ({ demo_mode: true, static_demo: true }))
route('POST', '/auth/demo-login', (c) => {
  const role = c.body?.role
  if (!['beneficiary', 'caseworker', 'admin'].includes(role)) throw new HttpError(422, 'Validation failed', [{ field: 'role', message: 'Invalid role' }])
  const pick = c.db.users.find((u) => u.role === role && u.is_active && u.is_synthetic && (role === 'admin' ? u.username === 'admin' : u.username === (role === 'caseworker' ? 'caseworker1' : 'ben001')))
    ?? c.db.users.find((u) => u.role === role && u.is_active && u.is_synthetic)
  if (!pick) throw new HttpError(404, 'Demo account is not available. Use "Reset demo data".')
  pick.last_login_at = nowIso(); audit(c.db, pick, 'demo_login', 'user', pick.id)
  return { access_token: tokenFor(pick), token_type: 'bearer', user: pubUser(pick) }
})
route('POST', '/auth/login', (c) => {
  const u = c.db.users.find((x) => x.username === c.body?.username)
  if (!u || !u.is_active || u.password !== c.body?.password) { audit(c.db, null, 'login_failed', 'user', u?.id ?? null); throw new HttpError(401, 'Incorrect username or password') }
  u.last_login_at = nowIso(); audit(c.db, u, 'login', 'user', u.id)
  return { access_token: tokenFor(u), token_type: 'bearer', user: pubUser(u) }
})
route('GET', '/auth/me', (c) => pubUser(req(c)))
route('POST', '/auth/logout', (c) => { audit(c.db, req(c), 'logout'); return ok(null, 204) })
route('POST', '/auth/change-password', (c) => {
  const u = req(c)
  if (u.is_synthetic) throw new HttpError(403, 'Password changes are disabled for the shared demo accounts')
  if (u.password !== c.body.current_password) throw new HttpError(400, 'Current password is incorrect')
  const p = pwProblem(c.body.new_password); if (p) throw new HttpError(422, p)
  u.password = c.body.new_password; u.token_version++; audit(c.db, u, 'password_changed', 'user', u.id)
  return ok(null, 204)
})
route('POST', '/auth/register', (c) => {
  const b = c.body
  if (!(b.consent_privacy && b.consent_assessment)) throw new HttpError(422, 'You must accept the privacy notice and consent to assessment data processing to register')
  const p = pwProblem(b.password ?? ''); if (p) throw new HttpError(422, p)
  const inv = c.db.invites.find((i) => i.code === String(b.invite_code ?? '').trim().toUpperCase())
  if (!inv || inv.used_at || Date.parse(inv.expires_at) < Date.now()) throw new HttpError(400, 'Invitation code is invalid or has expired')
  if (c.db.users.some((u) => u.username === b.username)) throw new HttpError(409, 'Username is already taken')
  const u: DUser = { id: nextId(c.db, 'user'), username: b.username, display_name: b.display_name, role: 'beneficiary', is_active: true, is_synthetic: false, created_at: nowIso(), last_login_at: null, password: b.password, token_version: 0 }
  c.db.users.push(u)
  const ben: DBen = { id: nextId(c.db, 'ben'), user_id: u.id, code: `BEN-${String(c.db.seq.ben).padStart(5, '0')}`, org_unit: inv.org_unit, age_band: null, preferred_language: b.preferred_language ?? 'English', case_status: 'open', is_synthetic: false, deletion_requested_at: null, created_at: nowIso() }
  c.db.bens.push(ben)
  if (inv.caseworker_id) c.db.assigns.push({ id: nextId(c.db, 'assign'), beneficiary_id: ben.id, caseworker_id: inv.caseworker_id, active: true, assigned_at: nowIso() })
  inv.used_at = nowIso()
  for (const [t, g] of [['privacy_notice', true], ['assessment_data', true], ['analytics_use', !!b.consent_analytics]] as const) c.db.consents.push({ id: nextId(c.db, 'consent'), user_id: u.id, consent_type: t, granted: g, notice_version: '1.0', created_at: nowIso() })
  audit(c.db, u, 'register', 'user', u.id, 'via invitation')
  return ok({ access_token: tokenFor(u), token_type: 'bearer', user: pubUser(u) }, 201)
})

/* ---------------------------------------------------------------- beneficiary dashboard */
route('GET', '/beneficiaries/me', (c) => {
  const b = myBen(c), u = req(c), subs = submitted(c.db, b.id), last = subs[subs.length - 1], prev = subs[subs.length - 2]
  const a = activeAssignment(c.db, b.id), cw = a ? c.db.cws.find((x) => x.id === a.caseworker_id) : undefined
  const due = last ? Date.parse(last.submitted_at!) + c.db.cfg.assessment_interval_days * DAY : null
  const fus = c.db.followups.filter((f) => f.beneficiary_id === b.id && (f.status === 'requested' || f.status === 'scheduled'))
    .sort((x, y) => (x.scheduled_for ?? '').localeCompare(y.scheduled_for ?? ''))
  return {
    profile: benOut(b), display_name: u.display_name, caseworker_name: cw ? userOf(c.db, cw.user_id).display_name : null, assessments_completed: subs.length,
    latest_wellbeing: last ? wellbeing(last.score!.overall_score) : null, previous_wellbeing: prev ? wellbeing(prev.score!.overall_score) : null,
    last_submitted_at: last?.submitted_at ?? null, check_in_due: due === null || due < Date.now(), next_due_at: due ? new Date(due).toISOString() : null,
    has_draft: c.db.assessments.some((x) => x.beneficiary_id === b.id && x.status === 'draft'),
    upcoming_followups: fus.map((f) => ({ id: f.id, status: f.status, kind: f.kind, scheduled_for: f.scheduled_for })),
  }
})

/* ---------------------------------------------------------------- cases */
route('GET', '/cases', (c) => {
  const user = req(c, 'caseworker', 'admin'), q = c.query, clinical = user.role === 'caseworker'
  let bens = clinical ? myCwBens(c) : c.db.bens
  if (q.status) bens = bens.filter((b) => b.case_status === q.status)
  if (q.org_unit) bens = bens.filter((b) => b.org_unit === q.org_unit)
  let rows = bens.map((b) => caseRow(c.db, b, clinical))
  if (q.q) { const s = String(q.q).toLowerCase(); rows = rows.filter((r) => r.code.toLowerCase().includes(s) || r.display_name.toLowerCase().includes(s)) }
  if (clinical) {
    if (q.priority) rows = rows.filter((r) => r.latest?.priority_level === q.priority)
    if (q.needs_review !== undefined) rows = rows.filter((r) => r.needs_review === (String(q.needs_review) === 'true'))
    if (q.assessment_due !== undefined) rows = rows.filter((r) => r.assessment_due === (String(q.assessment_due) === 'true'))
  }
  const sort = q.sort ?? 'priority', desc = q.order === 'desc'
  if (!['priority', 'name', 'last_assessment', 'status'].includes(sort)) throw new HttpError(422, 'Validation failed', [{ field: 'sort', message: 'Invalid sort' }])
  const key: Record<string, (r: any) => any> = {
    priority: (r) => (LRANK[r.latest?.priority_level] ?? 3) * 1000 - (r.latest?.overall_score ?? 0), name: (r) => r.display_name.toLowerCase(),
    last_assessment: (r) => r.latest?.submitted_at ?? '1970', status: (r) => r.case_status,
  }
  rows.sort((a, b) => { const x = key[sort](a), y = key[sort](b); return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1) })
  audit(c.db, user, 'case_list_viewed')
  return page(rows, q, 10)
})
route('GET', '/cases/:id', (c) => {
  const user = req(c, 'caseworker'), b = authorizeBen(c, Number(c.params.id)), subs = submitted(c.db, b.id), last = subs[subs.length - 1]
  const notes = c.db.notes.filter((n) => n.beneficiary_id === b.id).sort((x, y) => y.created_at.localeCompare(x.created_at))
  audit(c.db, user, 'case_viewed', 'beneficiary', b.id)
  return {
    profile: caseRow(c.db, b), age_band: b.age_band, preferred_language: b.preferred_language, created_at: b.created_at,
    timeline: subs.map((a) => ({ assessment_id: a.id, submitted_at: a.submitted_at, priority_level: a.score!.level, overall_score: a.score!.overall_score, dimension_scores: a.score!.dimension_scores, review_status: a.score!.review_status,
      top_factors: a.score!.factors.filter((f) => f.severity === 'urgent' || f.severity === 'attention').slice(0, 3).map((f) => f.label) })),
    latest_explanation: last ? { assessment_id: last.id, factors: last.score!.factors, change_summary: last.score!.change_summary, data_quality: last.score!.data_quality, ml_advisory: null } : null,
    alerts: c.db.alerts.filter((a) => a.beneficiary_id === b.id).sort((x, y) => y.created_at.localeCompare(x.created_at)),
    follow_ups: c.db.followups.filter((f) => f.beneficiary_id === b.id).sort((x, y) => y.created_at.localeCompare(x.created_at)).map((f) => fuOut(c.db, f, user)),
    interventions: c.db.interventions.filter((i) => i.beneficiary_id === b.id).sort((x, y) => y.occurred_at.localeCompare(x.occurred_at)),
    notes: notes.map((n) => ({ ...n, author_name: n.author_id ? userOf(c.db, n.author_id).display_name : null })),
  }
})
route('PATCH', '/cases/:id/status', (c) => {
  const user = req(c, 'caseworker'), b = authorizeBen(c, Number(c.params.id)), s = c.body?.case_status
  if (!['open', 'monitoring', 'follow_up_needed', 'closed'].includes(s)) throw new HttpError(422, 'Validation failed', [{ field: 'case_status', message: 'Invalid status' }])
  audit(c.db, user, 'case_status_changed', 'beneficiary', b.id, `${b.case_status} -> ${s}`); b.case_status = s
  return { id: b.id, case_status: s }
})
route('POST', '/cases/:id/notes', (c) => {
  const user = req(c, 'caseworker'), b = authorizeBen(c, Number(c.params.id)), body = String(c.body?.body ?? '').trim()
  if (!body) throw new HttpError(422, 'Validation failed', [{ field: 'body', message: 'Note cannot be empty' }])
  const n = { id: nextId(c.db, 'note'), beneficiary_id: b.id, author_id: user.id, body: body.slice(0, 4000), created_at: nowIso(), is_synthetic: b.is_synthetic }
  c.db.notes.push(n); audit(c.db, user, 'case_note_added', 'beneficiary', b.id)
  return ok(n, 201)
})
route('POST', '/cases/:id/assign', (c) => {
  const user = req(c, 'admin'), b = c.db.bens.find((x) => x.id === Number(c.params.id))
  if (!b) throw new HttpError(404, 'Beneficiary not found')
  const cw = c.db.cws.find((x) => x.id === Number(c.body?.caseworker_id))
  if (!cw || !userOf(c.db, cw.user_id).is_active) throw new HttpError(404, 'Caseworker not found')
  const cur = activeAssignment(c.db, b.id)
  if (cur?.caseworker_id === cw.id) return { beneficiary_id: b.id, caseworker_id: cw.id, changed: false }
  if (cur) cur.active = false
  c.db.assigns.push({ id: nextId(c.db, 'assign'), beneficiary_id: b.id, caseworker_id: cw.id, active: true, assigned_at: nowIso() })
  c.db.alerts.filter((a) => a.beneficiary_id === b.id && a.status !== 'resolved').forEach((a) => { a.caseworker_id = cw.id })
  c.db.followups.filter((f) => f.beneficiary_id === b.id && (f.status === 'requested' || f.status === 'scheduled')).forEach((f) => { f.caseworker_id = cw.id })
  audit(c.db, user, 'case_assigned', 'beneficiary', b.id, `caseworker ${cw.id}`)
  return { beneficiary_id: b.id, caseworker_id: cw.id, changed: true }
})

/* ---------------------------------------------------------------- assessments */
route('GET', '/assessments/questionnaire', (c) => { req(c); return publicQuestionnaire() })
route('GET', '/assessments/draft', (c) => {
  const b = myBen(c), a = c.db.assessments.find((x) => x.beneficiary_id === b.id && x.status === 'draft')
  if (!a) return { draft: null }
  return { draft: { id: a.id, started_at: a.started_at, updated_at: a.updated_at, answers: { ...a.answers, ...(a.free_text ? { text_1: a.free_text } : {}) } } }
})
route('POST', '/assessments', (c) => {
  const b = myBen(c)
  if (!c.body?.consent_confirmed) throw new HttpError(422, 'Consent must be confirmed before starting an assessment')
  const ex = c.db.assessments.find((x) => x.beneficiary_id === b.id && x.status === 'draft')
  if (ex) return ok({ id: ex.id, status: 'draft', resumed: true }, 201)
  const a: DAssess = { id: nextId(c.db, 'assess'), beneficiary_id: b.id, status: 'draft', started_at: nowIso(), updated_at: nowIso(), submitted_at: null, is_synthetic: b.is_synthetic, answers: {}, free_text: null, score: null }
  c.db.assessments.push(a); audit(c.db, req(c), 'assessment_started', 'beneficiary', b.id)
  return ok({ id: a.id, status: 'draft', resumed: false }, 201)
})
route('PUT', '/assessments/:id/responses', (c) => {
  req(c, 'beneficiary'); const a = loadAssess(c, Number(c.params.id))
  if (a.status !== 'draft') throw new HttpError(409, 'Assessment already submitted')
  const answers = c.body?.answers ?? {}, errors: Record<string, string> = {}
  for (const [qid, val] of Object.entries(answers)) {
    const it = QINDEX[qid]
    if (!it) errors[qid] = 'Unknown question'
    else if (it.type === 'text') { if (val != null && typeof val !== 'string') errors[qid] = 'Text expected' }
    else if (val != null) { const e = validateAnswer(qid, val); if (e) errors[qid] = e }
  }
  if (Object.keys(errors).length) throw new HttpError(422, { message: 'Invalid answers', errors })
  for (const [qid, val] of Object.entries(answers)) {
    if (QINDEX[qid].type === 'text') a.free_text = val == null || val === '' ? null : String(val).trim().slice(0, 2000)
    else if (val == null) delete a.answers[qid]
    else a.answers[qid] = val as number
  }
  a.updated_at = nowIso()
  return { id: a.id, saved: true }
})
route('POST', '/assessments/:id/submit', (c) => {
  const user = req(c, 'beneficiary'); const a = loadAssess(c, Number(c.params.id))
  if (a.status !== 'draft') throw new HttpError(409, 'Assessment already submitted')
  const missing = REQUIRED_IDS.filter((q) => a.answers[q] === undefined)
  if (missing.length) throw new HttpError(422, { message: 'Please answer all required questions', missing })
  a.status = 'submitted'; a.submitted_at = nowIso()
  const s = finalizeAssessment(c.db, a); audit(c.db, user, 'assessment_submitted', 'assessment', a.id)
  const show = s.level === 'urgent' || s.factors.some((f) => f.code.startsWith('critical_'))
  const resources = show ? c.db.resources.filter((r) => r.category === 'emergency' && r.is_active).map((r) => ({ id: r.id, title: r.title, summary: r.summary, contact: r.contact, is_verified: r.is_verified })) : []
  return { id: a.id, status: a.status, submitted_at: a.submitted_at, wellbeing_index: wellbeing(s.overall_score), show_support_now: show, support_resources: resources,
    message: show ? 'Thank you for completing your check-in. Your support worker will be in touch about next steps.' : 'Thank you for completing your check-in.' }
})
route('GET', '/assessments', (c) => {
  const user = req(c, 'beneficiary', 'caseworker'); let b: DBen
  if (user.role === 'beneficiary') b = myBen(c)
  else { if (!c.query.beneficiary_id) throw new HttpError(422, 'beneficiary_id is required'); b = authorizeBen(c, Number(c.query.beneficiary_id)); audit(c.db, user, 'assessment_history_viewed', 'beneficiary', b.id) }
  const status = c.query.status === undefined ? 'submitted' : c.query.status
  return c.db.assessments.filter((a) => a.beneficiary_id === b.id && (!status || a.status === status)).sort((x, y) => x.started_at.localeCompare(y.started_at)).map((a) => assessSummary(a, user))
})
route('GET', '/assessments/:id', (c) => {
  const user = req(c, 'beneficiary', 'caseworker'), a = loadAssess(c, Number(c.params.id)), out = assessSummary(a, user)
  const rows: any[] = []
  for (const it of QUESTIONS) {
    if (it.type === 'text') { if (a.free_text) rows.push({ question_id: it.id, text: it.text, value: null, answer: null, free_text: a.free_text }) }
    else if (a.answers[it.id] !== undefined) rows.push({ question_id: it.id, text: it.text, value: a.answers[it.id], answer: it.options[a.answers[it.id]].label, free_text: null })
  }
  out.responses = rows
  if (user.role === 'caseworker') audit(c.db, user, 'assessment_viewed', 'assessment', a.id)
  return out
})
route('GET', '/assessments/:id/compare', (c) => {
  const user = req(c, 'caseworker'), a = loadAssess(c, Number(c.params.id))
  if (a.status !== 'submitted' || !a.score) throw new HttpError(409, 'Only scored assessments can be compared')
  let b: DAssess | undefined
  if (c.query.with_id) { b = loadAssess(c, Number(c.query.with_id)); if (b.beneficiary_id !== a.beneficiary_id) throw new HttpError(422, 'Assessments belong to different beneficiaries and cannot be compared') }
  else b = submitted(c.db, a.beneficiary_id).filter((x) => x.submitted_at! < a.submitted_at!).pop()
  if (!b || !b.score) return { current: assessSummary(a, user), previous: null, deltas: {}, overall_delta: null }
  const deltas: Record<string, number | null> = {}
  for (const [d, v] of Object.entries(a.score.dimension_scores)) { const pv = b.score.dimension_scores[d]; deltas[d] = v == null || pv == null ? null : Math.round((v - pv) * 10) / 10 }
  const od = a.score.overall_score == null || b.score.overall_score == null ? null : Math.round((a.score.overall_score - b.score.overall_score) * 10) / 10
  return { current: assessSummary(a, user), previous: assessSummary(b, user), deltas, overall_delta: od }
})
route('POST', '/assessments/:id/mark-reviewed', (c) => {
  const user = req(c, 'caseworker'), a = loadAssess(c, Number(c.params.id))
  if (!a.score) throw new HttpError(409, 'Assessment has not been scored')
  a.score.review_status = 'reviewed'; a.score.reviewed_at = nowIso(); audit(c.db, user, 'assessment_reviewed', 'assessment', a.id)
  return { assessment_id: a.id, review_status: 'reviewed' }
})

/* ---------------------------------------------------------------- follow-ups */
route('POST', '/followups', (c) => {
  const user = req(c, 'beneficiary', 'caseworker'), body = c.body ?? {}
  if (user.role === 'beneficiary') {
    const b = myBen(c)
    if (c.db.followups.some((f) => f.beneficiary_id === b.id && f.status === 'requested')) throw new HttpError(409, 'You already have an open request. Your support worker will contact you.')
    const f = { id: nextId(c.db, 'fu'), beneficiary_id: b.id, caseworker_id: activeAssignment(c.db, b.id)?.caseworker_id ?? null, status: 'requested' as const, kind: 'requested_contact', scheduled_for: null, requested_by_beneficiary: true, reason: body.reason ?? null, outcome_notes: null, completed_at: null, created_at: nowIso(), is_synthetic: b.is_synthetic }
    c.db.followups.push(f); audit(c.db, user, 'followup_requested', 'beneficiary', b.id)
    return ok(fuOut(c.db, f, user), 201)
  }
  if (!body.beneficiary_id || !body.scheduled_for) throw new HttpError(422, 'beneficiary_id and scheduled_for are required')
  const b = authorizeBen(c, Number(body.beneficiary_id))
  const f = { id: nextId(c.db, 'fu'), beneficiary_id: b.id, caseworker_id: cwOfUser(c.db, user)?.id ?? null, status: 'scheduled' as const, kind: body.kind ?? 'check_in', scheduled_for: body.scheduled_for, requested_by_beneficiary: false, reason: body.reason ?? null, outcome_notes: null, completed_at: null, created_at: nowIso(), is_synthetic: b.is_synthetic }
  c.db.followups.push(f); audit(c.db, user, 'followup_scheduled', 'beneficiary', b.id)
  return ok(fuOut(c.db, f, user), 201)
})
route('GET', '/followups', (c) => {
  const user = req(c, 'beneficiary', 'caseworker'), q = c.query, now = Date.now()
  let rows = user.role === 'beneficiary' ? c.db.followups.filter((f) => f.beneficiary_id === myBen(c).id) : (() => { const ids = new Set(myCwBens(c).map((b) => b.id)); return c.db.followups.filter((f) => ids.has(f.beneficiary_id)) })()
  if (user.role === 'caseworker' && q.beneficiary_id) rows = rows.filter((f) => f.beneficiary_id === Number(q.beneficiary_id))
  if (q.status) rows = rows.filter((f) => f.status === q.status)
  if (String(q.overdue) === 'true') rows = rows.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) < now)
  if (q.due_within_days !== undefined) { const lim = now + Number(q.due_within_days) * DAY; rows = rows.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) >= now && Date.parse(f.scheduled_for) <= lim) }
  rows = [...rows].sort((a, b) => (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? '') || b.created_at.localeCompare(a.created_at))
  const p = page(rows, q); return { ...p, items: p.items.map((f) => fuOut(c.db, f, user)) }
})
route('PATCH', '/followups/:id', (c) => {
  const user = req(c, 'beneficiary', 'caseworker'), f = c.db.followups.find((x) => x.id === Number(c.params.id))
  if (!f) throw new HttpError(404, 'Follow-up not found')
  authorizeBen(c, f.beneficiary_id)
  const data = { ...(c.body ?? {}) }
  if (user.role === 'beneficiary') { if (f.status !== 'requested' || Object.keys(data).some((k) => k !== 'status') || data.status !== 'cancelled') throw new HttpError(403, 'You can only cancel your own pending request') }
  if ((f.status === 'completed' || f.status === 'cancelled') && user.role === 'caseworker') throw new HttpError(409, 'Closed follow-ups cannot be modified')
  if (data.scheduled_for && f.status === 'requested' && !data.status) data.status = 'scheduled'
  if (data.status === 'completed') f.completed_at = nowIso()
  if (data.status === 'scheduled' && !f.scheduled_for && !data.scheduled_for) throw new HttpError(422, 'scheduled_for is required to schedule a follow-up')
  for (const k of ['scheduled_for', 'status', 'kind', 'reason', 'outcome_notes']) if (k in data) (f as any)[k] = data[k]
  if (user.role === 'caseworker' && f.caseworker_id == null) f.caseworker_id = cwOfUser(c.db, user)?.id ?? null
  audit(c.db, user, 'followup_updated', 'followup', f.id, f.status)
  return fuOut(c.db, f, user)
})
route('POST', '/followups/:id/complete', (c) => {
  const user = req(c, 'caseworker'), f = c.db.followups.find((x) => x.id === Number(c.params.id))
  if (!f) throw new HttpError(404, 'Follow-up not found')
  authorizeBen(c, f.beneficiary_id)
  if (f.status !== 'scheduled') throw new HttpError(409, 'Only scheduled follow-ups can be marked completed')
  f.status = 'completed'; f.completed_at = nowIso(); f.outcome_notes = c.body?.outcome_notes ?? null; audit(c.db, user, 'followup_completed', 'followup', f.id)
  return fuOut(c.db, f, user)
})

/* ---------------------------------------------------------------- interventions + alerts */
route('GET', '/interventions/types', (c) => { req(c, 'caseworker'); return INTERVENTION_TYPES })
route('GET', '/interventions', (c) => {
  req(c, 'caseworker'); const ids = new Set(myCwBens(c).map((b) => b.id))
  let rows = c.db.interventions.filter((i) => ids.has(i.beneficiary_id))
  if (c.query.beneficiary_id) rows = rows.filter((i) => i.beneficiary_id === Number(c.query.beneficiary_id))
  if (c.query.outcome) rows = rows.filter((i) => i.outcome === c.query.outcome)
  return rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 500).map((i) => ivOut(c.db, i))
})
const OUTCOMES = ['improved', 'no_change', 'worsened', 'referred', 'pending']
route('POST', '/interventions', (c) => {
  const user = req(c, 'caseworker'), b = authorizeBen(c, Number(c.body?.beneficiary_id)), body = c.body
  if (!body.type || !body.description) throw new HttpError(422, 'Validation failed', [{ field: 'description', message: 'Required' }])
  if (body.outcome && !OUTCOMES.includes(body.outcome)) throw new HttpError(422, 'Validation failed', [{ field: 'outcome', message: 'Invalid outcome' }])
  const i = { id: nextId(c.db, 'iv'), beneficiary_id: b.id, caseworker_id: cwOfUser(c.db, user)?.id ?? null, type: body.type, description: body.description, outcome: body.outcome ?? null, outcome_notes: body.outcome_notes ?? null, occurred_at: body.occurred_at ?? nowIso(), created_at: nowIso(), is_synthetic: b.is_synthetic }
  c.db.interventions.push(i); audit(c.db, user, 'intervention_recorded', 'beneficiary', b.id, body.type)
  return ok(ivOut(c.db, i), 201)
})
route('PATCH', '/interventions/:id/outcome', (c) => {
  const user = req(c, 'caseworker'), i = c.db.interventions.find((x) => x.id === Number(c.params.id))
  if (!i) throw new HttpError(404, 'Intervention not found')
  authorizeBen(c, i.beneficiary_id)
  if (!OUTCOMES.includes(c.body?.outcome)) throw new HttpError(422, 'Validation failed', [{ field: 'outcome', message: 'Invalid outcome' }])
  i.outcome = c.body.outcome; i.outcome_notes = c.body.outcome_notes ?? i.outcome_notes; audit(c.db, user, 'intervention_outcome', 'intervention', i.id, i.outcome)
  return ivOut(c.db, i)
})
route('GET', '/alerts', (c) => {
  const user = req(c, 'caseworker'), cw = cwOfUser(c.db, user), status = c.query.status ?? 'open'
  return c.db.alerts.filter((a) => cw && a.caseworker_id === cw.id && (!status || a.status === status)).sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((a) => alertOut(c.db, a)).sort((a, b) => (a.level === 'urgent' ? 0 : 1) - (b.level === 'urgent' ? 0 : 1))
})
route('PATCH', '/alerts/:id', (c) => {
  const user = req(c, 'caseworker'), a = c.db.alerts.find((x) => x.id === Number(c.params.id))
  if (!a) throw new HttpError(404, 'Alert not found')
  authorizeBen(c, a.beneficiary_id)
  if (!['acknowledged', 'resolved'].includes(c.body?.status)) throw new HttpError(422, 'Validation failed', [{ field: 'status', message: 'Invalid status' }])
  a.status = c.body.status; if (a.status === 'resolved') a.resolved_at = nowIso(); audit(c.db, user, `alert_${a.status}`, 'alert', a.id)
  return a
})

/* ---------------------------------------------------------------- analytics */
route('GET', '/analytics/caseworker-summary', (c) => {
  const user = req(c, 'caseworker'), cw = cwOfUser(c.db, user), bens = myCwBens(c), ids = new Set(bens.map((b) => b.id)), now = Date.now()
  const rows = bens.map((b) => caseRow(c.db, b))
  const subs = c.db.assessments.filter((a) => ids.has(a.beneficiary_id) && a.status === 'submitted')
  const fus = c.db.followups.filter((f) => ids.has(f.beneficiary_id))
  const dueSoon = fus.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) >= now && Date.parse(f.scheduled_for) <= now + 7 * DAY)
  const overdue = fus.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) < now)
  const alerts = c.db.alerts.filter((a) => cw && a.caseworker_id === cw.id && a.status === 'open')
  const code = (id: number) => c.db.bens.find((b) => b.id === id)!.code
  const feed: any[] = [
    ...[...subs].sort((a, b) => b.submitted_at!.localeCompare(a.submitted_at!)).slice(0, 8).map((a) => ({ at: a.submitted_at as string, type: 'assessment', beneficiary_id: a.beneficiary_id, code: code(a.beneficiary_id), text: 'Submitted a check-in', level: a.score?.level ?? null })),
    ...c.db.notes.filter((n) => ids.has(n.beneficiary_id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5).map((n) => ({ at: n.created_at, type: 'note', beneficiary_id: n.beneficiary_id, code: code(n.beneficiary_id), text: 'Case note added', level: null })),
    ...c.db.interventions.filter((i) => ids.has(i.beneficiary_id)).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 5).map((i) => ({ at: i.occurred_at, type: 'intervention', beneficiary_id: i.beneficiary_id, code: code(i.beneficiary_id), text: `Intervention recorded (${i.type.replace(/_/g, ' ')})`, level: null })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const dist: Record<string, number> = { urgent: 0, attention: 0, routine: 0, none: 0 }
  rows.forEach((r) => { dist[r.latest?.priority_level ?? 'none']++ })
  return {
    assigned_beneficiaries: bens.length, assessments_completed: subs.length, assessments_completed_30d: subs.filter((a) => Date.parse(a.submitted_at!) >= now - 30 * DAY).length,
    assessments_pending: rows.filter((r) => r.assessment_due).length, awaiting_review: rows.filter((r) => r.needs_review).length,
    urgent_notifications: alerts.filter((a) => a.level === 'urgent').length, attention_notifications: alerts.filter((a) => a.level === 'attention').length,
    followups_due_7d: dueSoon.length, followups_overdue: overdue.length, followups_requested: fus.filter((f) => f.status === 'requested').length,
    priority_distribution: dist, recent_activity: feed.slice(0, 10),
  }
})
const weekStart = (iso: string) => { const d = new Date(iso); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY; return new Date(t).toISOString().slice(0, 10) }
route('GET', '/analytics/overview', (c) => {
  req(c, 'admin'); const k = 3, q = c.query
  const toD = q.to_date ? String(q.to_date) : new Date().toISOString().slice(0, 10), fromD = q.from_date ? String(q.from_date) : new Date(Date.parse(toD) - 120 * DAY).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toD) || !/^\d{4}-\d{2}-\d{2}$/.test(fromD)) throw new HttpError(422, 'Validation failed', [{ field: 'from_date', message: 'Invalid date' }])
  const start = Date.parse(fromD + 'T00:00:00Z'), end = Date.parse(toD + 'T23:59:59Z')
  const bens = c.db.bens.filter((b) => !q.org_unit || b.org_unit === q.org_unit), ids = new Set(bens.map((b) => b.id))
  const latestConsent: Record<number, boolean> = {}
  c.db.consents.filter((x) => x.consent_type === 'analytics_use').forEach((x) => { latestConsent[x.user_id] = x.granted })
  const consenting = new Set(bens.filter((b) => latestConsent[b.user_id]).map((b) => b.id))
  const all = c.db.assessments.filter((a) => a.status === 'submitted' && ids.has(a.beneficiary_id) && Date.parse(a.submitted_at!) >= start && Date.parse(a.submitted_at!) <= end)
  const cons = all.filter((a) => consenting.has(a.beneficiary_id) && a.score)
  const latest: Record<number, DAssess> = {}; [...cons].sort((a, b) => a.submitted_at!.localeCompare(b.submitted_at!)).forEach((a) => { latest[a.beneficiary_id] = a })
  const dist: Record<string, number> = {}; Object.values(latest).forEach((a) => { dist[a.score!.level] = (dist[a.score!.level] ?? 0) + 1 })
  const sup = (n: number) => (n > 0 && n < k ? null : n)
  const weekly: Record<string, number> = {}; all.forEach((a) => { const w = weekStart(a.submitted_at!); weekly[w] = (weekly[w] ?? 0) + 1 })
  const monthly: Record<string, number[]> = {}; cons.forEach((a) => { if (a.score!.overall_score != null) (monthly[a.submitted_at!.slice(0, 7)] ??= []).push(wellbeing(a.score!.overall_score)!) })
  const fus = c.db.followups.filter((f) => ids.has(f.beneficiary_id) && Date.parse(f.created_at) >= start && Date.parse(f.created_at) <= end)
  const st = (s: string) => fus.filter((f) => f.status === s).length, now = Date.now()
  const overdue = fus.filter((f) => f.status === 'scheduled' && f.scheduled_for && Date.parse(f.scheduled_for) < now).length
  const resolvable = st('completed') + overdue + st('cancelled')
  const ivs = c.db.interventions.filter((i) => ids.has(i.beneficiary_id) && Date.parse(i.occurred_at) >= start && Date.parse(i.occurred_at) <= end)
  const tally = (key: (i: any) => string) => { const m: Record<string, number> = {}; ivs.forEach((i) => { const x = key(i); m[x] = (m[x] ?? 0) + 1 }); return Object.entries(m).sort((a, b) => b[1] - a[1]) }
  return {
    period: { from: fromD, to: toD, org_unit: q.org_unit ?? null },
    privacy: { min_cell_size: k, note: 'Counts below the minimum cell size are suppressed (null). Wellbeing and priority views include only people who consented to analytics use.' },
    total_beneficiaries: bens.length, active_cases: bens.filter((b) => b.case_status !== 'closed').length, assessments_submitted: all.length,
    assessment_completion_rate: bens.length ? Math.round((new Set(all.map((a) => a.beneficiary_id)).size / bens.length) * 1000) / 1000 : null,
    consenting_beneficiaries: sup(consenting.size),
    priority_distribution: { routine: sup(dist.routine ?? 0), attention: sup(dist.attention ?? 0), urgent: sup(dist.urgent ?? 0) },
    assessments_per_week: Object.entries(weekly).sort().map(([week, count]) => ({ week, count })),
    wellbeing_trend: Object.entries(monthly).sort().map(([month, v]) => ({ month, avg_wellbeing: v.length >= k ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null, n: sup(v.length) })),
    followups: { total: fus.length, completed: st('completed'), scheduled: st('scheduled'), requested: st('requested'), cancelled: st('cancelled'), overdue, completion_rate: resolvable ? Math.round((st('completed') / resolvable) * 1000) / 1000 : null },
    interventions: { total: ivs.length, by_type: tally((i) => i.type).map(([type, count]) => ({ type, count })), by_outcome: tally((i) => i.outcome ?? 'not_recorded').map(([outcome, count]) => ({ outcome, count })) },
    org_units: [...new Set(c.db.bens.map((b) => b.org_unit))].sort(),
  }
})

/* ---------------------------------------------------------------- resources + self-service */
route('GET', '/resources', (c) => { req(c); return c.db.resources.filter((r) => r.is_active && (!c.query.category || r.category === c.query.category)) })
route('GET', '/me/consents', (c) => {
  const user = req(c, 'beneficiary'), b = myBen(c), mine = c.db.consents.filter((x) => x.user_id === user.id)
  const cur: Record<string, boolean> = {}; mine.forEach((x) => { cur[x.consent_type] = x.granted })
  return { current: cur, history: [...mine].reverse(), notice_version: '1.0', deletion_requested_at: b.deletion_requested_at }
})
route('POST', '/me/consents', (c) => {
  const user = req(c, 'beneficiary')
  if (!['privacy_notice', 'assessment_data', 'analytics_use'].includes(c.body?.consent_type)) throw new HttpError(422, 'Validation failed', [{ field: 'consent_type', message: 'Invalid type' }])
  const x = { id: nextId(c.db, 'consent'), user_id: user.id, consent_type: c.body.consent_type, granted: !!c.body.granted, notice_version: '1.0', created_at: nowIso() }
  c.db.consents.push(x); audit(c.db, user, 'consent_changed', 'user', user.id, `${x.consent_type}=${x.granted}`)
  return ok(x, 201)
})
route('POST', '/me/deletion-request', (c) => {
  const user = req(c, 'beneficiary'), b = myBen(c)
  b.deletion_requested_at = b.deletion_requested_at ?? nowIso()
  c.db.consents.push({ id: nextId(c.db, 'consent'), user_id: user.id, consent_type: 'analytics_use', granted: false, notice_version: '1.0', created_at: nowIso() })
  audit(c.db, user, 'deletion_requested', 'beneficiary', b.id)
  return { deletion_requested_at: b.deletion_requested_at }
})
route('GET', '/me/export', (c) => {
  const user = req(c, 'beneficiary'), b = myBen(c); audit(c.db, user, 'data_exported', 'beneficiary', b.id)
  return {
    exported_at: nowIso(), profile: { code: b.code, org_unit: b.org_unit, preferred_language: b.preferred_language, display_name: user.display_name },
    consents: c.db.consents.filter((x) => x.user_id === user.id),
    assessments: c.db.assessments.filter((a) => a.beneficiary_id === b.id).map((a) => ({ id: a.id, status: a.status, submitted_at: a.submitted_at, responses: { ...a.answers, ...(a.free_text ? { text_1: a.free_text } : {}) } })),
    follow_ups: c.db.followups.filter((f) => f.beneficiary_id === b.id).map((f) => ({ id: f.id, status: f.status, scheduled_for: f.scheduled_for })),
  }
})

/* ---------------------------------------------------------------- admin */
route('GET', '/admin/users', (c) => {
  req(c, 'admin'); let rows = c.db.users
  if (c.query.role) rows = rows.filter((u) => u.role === c.query.role)
  if (c.query.q) { const s = String(c.query.q).toLowerCase(); rows = rows.filter((u) => u.username.toLowerCase().includes(s) || u.display_name.toLowerCase().includes(s)) }
  const p = page(rows, c.query); return { ...p, items: p.items.map(pubUser) }
})
route('POST', '/admin/users', (c) => {
  const admin = req(c, 'admin'), b = c.body ?? {}
  if (b.role === 'beneficiary') throw new HttpError(422, 'Create beneficiaries via POST /beneficiaries or an invitation')
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(b.username ?? '')) throw new HttpError(422, 'Validation failed', [{ field: 'username', message: 'At least 3 letters/numbers' }])
  const p = pwProblem(b.password ?? ''); if (p) throw new HttpError(422, p)
  if (c.db.users.some((u) => u.username === b.username)) throw new HttpError(409, 'Username is already taken')
  const u: DUser = { id: nextId(c.db, 'user'), username: b.username, display_name: b.display_name, role: b.role, is_active: true, is_synthetic: false, created_at: nowIso(), last_login_at: null, password: b.password, token_version: 0 }
  c.db.users.push(u)
  if (u.role === 'caseworker') c.db.cws.push({ id: nextId(c.db, 'cw'), user_id: u.id, org_unit: b.org_unit || 'Unassigned' })
  audit(c.db, admin, 'user_created', 'user', u.id, u.role)
  return ok(pubUser(u), 201)
})
route('PATCH', '/admin/users/:id', (c) => {
  const admin = req(c, 'admin'), u = c.db.users.find((x) => x.id === Number(c.params.id)), d = c.body ?? {}
  if (!u) throw new HttpError(404, 'User not found')
  if (u.id === admin.id && (d.is_active === false || (d.role && d.role !== 'admin'))) throw new HttpError(409, 'You cannot deactivate or demote your own account')
  if (d.role && d.role !== u.role) {
    if (u.role === 'beneficiary' || d.role === 'beneficiary') throw new HttpError(422, 'Beneficiary accounts cannot change role')
    u.role = d.role; u.token_version++
    if (u.role === 'caseworker' && !cwOfUser(c.db, u)) c.db.cws.push({ id: nextId(c.db, 'cw'), user_id: u.id, org_unit: 'Unassigned' })
  }
  if (d.display_name) u.display_name = d.display_name
  if ('is_active' in d) { u.is_active = !!d.is_active; u.token_version++ }
  if (d.new_password) { const p = pwProblem(d.new_password); if (p) throw new HttpError(422, p); u.password = d.new_password; u.token_version++ }
  audit(c.db, admin, 'user_updated', 'user', u.id, Object.keys(d).filter((k) => k !== 'new_password').join(','))
  return pubUser(u)
})
route('GET', '/admin/caseworkers', (c) => {
  req(c, 'admin', 'caseworker')
  return c.db.cws.filter((w) => userOf(c.db, w.user_id).is_active).map((w) => ({ id: w.id, name: userOf(c.db, w.user_id).display_name, org_unit: w.org_unit, caseload: c.db.assigns.filter((a) => a.caseworker_id === w.id && a.active).length }))
})
route('GET', '/admin/org-units', (c) => { req(c, 'admin', 'caseworker'); return [...new Set([...c.db.bens.map((b) => b.org_unit), ...c.db.cws.map((w) => w.org_unit)])].filter((x) => x && x !== 'Unassigned').sort() })
route('GET', '/admin/audit-actions', (c) => { req(c, 'admin'); return [...new Set(c.db.audit.map((a) => a.action))].sort() })
route('GET', '/admin/audit-logs', (c) => {
  req(c, 'admin'); let rows = [...c.db.audit].reverse()
  if (c.query.action) rows = rows.filter((a) => a.action === c.query.action)
  return page(rows, c.query, 25)
})
route('POST', '/admin/invitations', (c) => {
  const user = req(c, 'admin', 'caseworker'), b = c.body ?? {}, cw = user.role === 'caseworker' ? cwOfUser(c.db, user)?.id ?? null : b.caseworker_id ?? null, days = b.valid_days ?? 7
  const k = code(); c.db.invites.push({ code: k, org_unit: b.org_unit, caseworker_id: cw, expires_at: new Date(Date.now() + days * DAY).toISOString(), used_at: null })
  audit(c.db, user, 'invitation_created', 'invitation', null, b.org_unit)
  return ok({ code: k, expires_in_days: days, org_unit: b.org_unit }, 201)
})
const resBody = (b: any) => { for (const k of ['title', 'summary']) if (!b?.[k]) throw new HttpError(422, 'Validation failed', [{ field: k, message: 'Required' }]); if (!['education', 'support', 'emergency'].includes(b.category)) throw new HttpError(422, 'Validation failed', [{ field: 'category', message: 'Invalid category' }]); return { title: b.title, category: b.category, summary: b.summary, body: b.body ?? '', contact: b.contact ?? null, region: b.region ?? null, is_verified: !!b.is_verified, is_active: b.is_active ?? true } }
route('GET', '/admin/resources', (c) => { req(c, 'admin'); return [...c.db.resources].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)) })
route('POST', '/admin/resources', (c) => { const u = req(c, 'admin'); const r = { id: nextId(c.db, 'res'), ...resBody(c.body), updated_at: nowIso() }; c.db.resources.push(r); audit(c.db, u, 'resource_created', 'resource', null, r.category); return ok(r, 201) })
route('PUT', '/admin/resources/:id', (c) => {
  const u = req(c, 'admin'), r = c.db.resources.find((x) => x.id === Number(c.params.id)); if (!r) throw new HttpError(404, 'Resource not found')
  Object.assign(r, resBody(c.body), { updated_at: nowIso() }); audit(c.db, u, 'resource_updated', 'resource', r.id); return r
})
route('DELETE', '/admin/resources/:id', (c) => {
  const u = req(c, 'admin'), i = c.db.resources.findIndex((x) => x.id === Number(c.params.id)); if (i < 0) throw new HttpError(404, 'Resource not found')
  c.db.resources.splice(i, 1); audit(c.db, u, 'resource_deleted', 'resource', Number(c.params.id)); return ok(null, 204)
})
route('GET', '/admin/engine-config', (c) => { req(c, 'admin', 'caseworker'); return { config: c.db.cfg, defaults: DEFAULT_CFG, ml: { available: false, note: 'The experimental ML advisory runs only with the real backend.' } } })
route('PUT', '/admin/engine-config', (c) => {
  const u = req(c, 'admin'), errors = validateCfg(c.body ?? {})
  if (errors.length) throw new HttpError(422, { message: 'Invalid configuration', errors })
  c.db.cfg = { ...DEFAULT_CFG, ...c.body, use_ml_advisory: false }; audit(c.db, u, 'engine_config_updated', 'system_setting')
  return { config: c.db.cfg }
})
route('GET', '/admin/deletion-requests', (c) => { req(c, 'admin'); return c.db.bens.filter((b) => b.deletion_requested_at).map((b) => ({ beneficiary_id: b.id, code: b.code, requested_at: b.deletion_requested_at })) })
route('DELETE', '/admin/beneficiaries/:id', (c) => {
  const admin = req(c, 'admin'), b = c.db.bens.find((x) => x.id === Number(c.params.id)); if (!b) throw new HttpError(404, 'Beneficiary not found')
  const db = c.db, id = b.id, uid = b.user_id
  db.bens = db.bens.filter((x) => x.id !== id); db.users = db.users.filter((u) => u.id !== uid); db.assigns = db.assigns.filter((a) => a.beneficiary_id !== id)
  db.assessments = db.assessments.filter((a) => a.beneficiary_id !== id); db.alerts = db.alerts.filter((a) => a.beneficiary_id !== id); db.notes = db.notes.filter((n) => n.beneficiary_id !== id)
  db.followups = db.followups.filter((f) => f.beneficiary_id !== id); db.interventions = db.interventions.filter((i) => i.beneficiary_id !== id); db.consents = db.consents.filter((x) => x.user_id !== uid)
  audit(db, admin, 'beneficiary_erased', 'beneficiary', id, `code ${b.code}`); return ok(null, 204)
})
route('POST', '/admin/retention/run', (c) => {
  const u = req(c, 'admin'), cutoff = Date.now() - 365 * DAY
  const old = c.db.assessments.filter((a) => a.free_text && a.submitted_at && Date.parse(a.submitted_at) < cutoff); old.forEach((a) => { a.free_text = null })
  audit(c.db, u, 'retention_run', null, null, `purged ${old.length} free-text answers older than 365 days`)
  return { purged_free_text_answers: old.length, older_than_days: 365 }
})

/* ---------------------------------------------------------------- dispatcher */
export function resetDemo() { resetDb() }
export function handle(method: string, path: string, opts: { query?: Record<string, any>; body?: any; token?: string | null }): Res {
  const db = loadDb(), m = method.toUpperCase()
  let user: DUser | null = null
  const t = /^demo\.(\d+)\.(\d+)$/.exec(opts.token ?? '')
  if (t) { const u = db.users.find((x) => x.id === Number(t[1])); if (u && u.is_active && u.token_version === Number(t[2])) user = u }
  for (const r of routes) {
    if (r.method !== m) continue
    const mt = r.re.exec(path.split('?')[0]); if (!mt) continue
    const params: Record<string, string> = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(mt[i + 1]) })
    try {
      const out = r.fn({ db, user, params, query: opts.query ?? {}, body: opts.body }) as Res | unknown
      const res: Res = out && typeof out === 'object' && 'status' in (out as object) && 'data' in (out as object) ? (out as Res) : { status: 200, data: out }
      if (m !== 'GET') saveDb()
      return res
    } catch (e) { if (e instanceof HttpError) { if (m !== 'GET') saveDb(); throw e } throw e }
  }
  throw new HttpError(404, 'Not found')
}
export const _unused = { ORG_UNITS, LEVEL_LABEL }
export type { Level }
