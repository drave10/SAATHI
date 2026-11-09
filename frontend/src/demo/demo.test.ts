import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LIKERT_IDS, QINDEX, evaluate, validateCfg, DEFAULT_CFG } from './engine'
import { HttpError, handle } from './server'
import { _setDbForTests, loadDb, resetDb } from './store'

function call(method: string, path: string, o: { token?: string | null; body?: any; query?: any } = {}) {
  try { const r = handle(method, path, { token: o.token ?? null, body: o.body, query: o.query }); return { status: r.status, data: r.data as any } }
  catch (e) { if (e instanceof HttpError) return { status: e.status, data: e.detail as any }; throw e }
}
const demo = (role: string) => call('POST', '/auth/demo-login', { body: { role } }).data.access_token as string
const answers = (level: number, over: Record<string, number> = {}) => {
  const out: Record<string, number> = {}
  for (const id of LIKERT_IDS) { const c = QINDEX[id].concern; out[id] = c.reduce((best, v, i) => (Math.abs(v - level) < Math.abs(c[best] - level) ? i : best), 0) }
  return { ...out, ...over }
}

// Node 26 ships its own (file-backed) localStorage global that shadows jsdom's, so use a plain in-memory Storage here.
const store = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() })

beforeEach(() => { _setDbForTests(null); store.clear(); resetDb() })

describe('engine port (parity with the Python rules)', () => {
  it('routine for low concern; urgent for any self-harm item answer, even with sparse data', () => {
    expect(evaluate(answers(0)).level).toBe('routine')
    expect(evaluate(answers(0, { safe_self: 1 })).level).toBe('urgent')
    const sparse = evaluate({ safe_self: 3 }); expect(sparse.level).toBe('urgent'); expect(sparse.data_quality.reliable_for_thresholds).toBe(false)
  })
  it('missing items are excluded not zeroed; threshold rules are skipped when data is too thin', () => {
    const a = answers(4); delete a.slp_1; delete a.slp_2
    const r = evaluate(a); expect(r.dimension_scores.sleep).toBeNull(); expect(r.overall_score).toBe(100)
    expect(evaluate({ emo_1: 4, emo_2: 0 }).level).toBe('routine')
  })
  it('rise versus previous raises attention/urgent; config is validated', () => {
    const prev = evaluate(answers(0)), prior = [{ overall: prev.overall_score, dimensions: prev.dimension_scores }]
    const r = evaluate(answers(1, { chg_1: 2, safe_self: 0 }), prior)
    expect(r.change_summary.overall_delta).toBeGreaterThanOrEqual(15); expect(r.level).toBe('attention')
    expect(evaluate(answers(2, { chg_1: 2, help_1: 0, safe_self: 0 }), prior).level).toBe('urgent')
    expect(validateCfg({ attention_overall: 80, urgent_overall: 50 }).length).toBeGreaterThan(0)
    expect(validateCfg({})).toEqual([]); expect(DEFAULT_CFG.attention_overall).toBe(40)
  })
})

describe('in-browser API: data, auth and role rules', () => {
  it('seeds 25 beneficiaries, 5 caseworkers and 50+ assessments, all synthetic', () => {
    const db = loadDb()
    expect(db.bens.length).toBe(25); expect(db.cws.length).toBe(5); expect(db.assessments.filter((a) => a.status === 'submitted').length).toBeGreaterThanOrEqual(50)
    expect(db.users.every((u) => u.is_synthetic)).toBe(true)
    expect(db.users.find((u) => u.username === 'ben001')!.display_name).toContain('Debashish')
  })
  it('requires authentication and enforces roles on the server side', () => {
    expect(call('GET', '/auth/me').status).toBe(401)
    expect(call('GET', '/cases', { token: demo('beneficiary') }).status).toBe(403)
    expect(call('GET', '/admin/users', { token: demo('caseworker') }).status).toBe(403)
    expect(call('GET', '/cases/1', { token: demo('admin') }).status).toBe(403)
    expect(call('GET', '/analytics/overview', { token: demo('caseworker') }).status).toBe(403)
    expect(call('GET', '/auth/me', { token: demo('admin') }).data.role).toBe('admin')
  })
  it('caseworkers only see their assigned cases (others are 404)', () => {
    const t = demo('caseworker')   // caseworker1
    const mine = call('GET', '/cases', { token: t, query: { page_size: 100 } }).data
    expect(mine.total).toBe(5)
    const ben2 = loadDb().bens.find((b) => b.code === 'BEN-00002')!   // belongs to caseworker2
    expect(call('GET', `/cases/${ben2.id}`, { token: t }).status).toBe(404)
    expect(call('POST', `/cases/${ben2.id}/notes`, { token: t, body: { body: 'x' } }).status).toBe(404)
    expect(call('GET', `/cases/${mine.items[0].id}`, { token: t }).status).toBe(200)
  })
  it('typed login uses the sample password and rejects wrong ones', () => {
    expect(call('POST', '/auth/login', { body: { username: 'admin', password: 'nope' } }).status).toBe(401)
    expect(call('POST', '/auth/login', { body: { username: 'admin', password: 'Demo-pass-1' } }).status).toBe(200)
  })
  it('beneficiary check-in: validation, urgent triage, alert for the assigned caseworker, no review label for the beneficiary', () => {
    const b = demo('beneficiary')
    expect(call('POST', '/assessments', { token: b, body: { consent_confirmed: false } }).status).toBe(422)
    const id = call('POST', '/assessments', { token: b, body: { consent_confirmed: true } }).data.id
    expect(call('PUT', `/assessments/${id}/responses`, { token: b, body: { answers: { emo_1: 99 } } }).status).toBe(422)
    expect(call('POST', `/assessments/${id}/submit`, { token: b }).status).toBe(422)
    call('PUT', `/assessments/${id}/responses`, { token: b, body: { answers: { ...answers(0, { safe_self: 1, help_1: 2 }), text_1: 'hello' } } })
    const sub = call('POST', `/assessments/${id}/submit`, { token: b })
    expect(sub.status).toBe(200); expect(sub.data.show_support_now).toBe(true); expect(sub.data.priority_level).toBeUndefined()
    expect(sub.data.support_resources.length).toBeGreaterThan(0)
    expect(call('POST', `/assessments/${id}/submit`, { token: b }).status).toBe(409)
    const hist = call('GET', '/assessments', { token: b }).data
    expect(hist.every((h: any) => h.priority_level === undefined && 'wellbeing_index' in h)).toBe(true)
    const cw = demo('caseworker')
    const alerts = call('GET', '/alerts', { token: cw, query: { status: 'open' } }).data
    expect(alerts.some((a: any) => a.assessment_id === id && a.level === 'urgent')).toBe(true)
    const ben = loadDb().bens.find((x) => x.code === 'BEN-00001')!
    const prof = call('GET', `/cases/${ben.id}`, { token: cw }).data
    expect(prof.latest_explanation.factors.some((f: any) => f.code === 'critical_self_harm_item')).toBe(true)
    expect(call('GET', `/assessments/${id}/compare`, { token: cw }).data.previous).not.toBeNull()
  })
  it('case management writes persist: notes, follow-ups, interventions, status', () => {
    const cw = demo('caseworker'), ben = loadDb().bens.find((x) => x.code === 'BEN-00001')!
    expect(call('POST', `/cases/${ben.id}/notes`, { token: cw, body: { body: 'Spoke today' } }).status).toBe(201)
    expect(call('POST', '/followups', { token: cw, body: { beneficiary_id: ben.id } }).status).toBe(422)
    const fu = call('POST', '/followups', { token: cw, body: { beneficiary_id: ben.id, scheduled_for: new Date(Date.now() - 864e5).toISOString() } }).data
    expect(call('GET', '/followups', { token: cw, query: { overdue: true } }).data.items.some((f: any) => f.id === fu.id && f.is_overdue)).toBe(true)
    expect(call('POST', `/followups/${fu.id}/complete`, { token: cw, body: {} }).data.status).toBe('completed')
    expect(call('POST', `/followups/${fu.id}/complete`, { token: cw, body: {} }).status).toBe(409)
    const iv = call('POST', '/interventions', { token: cw, body: { beneficiary_id: ben.id, type: 'home_visit', description: 'Visit' } }).data
    expect(call('PATCH', `/interventions/${iv.id}/outcome`, { token: cw, body: { outcome: 'improved' } }).data.outcome).toBe('improved')
    expect(call('PATCH', `/cases/${ben.id}/status`, { token: cw, body: { case_status: 'monitoring' } }).status).toBe(200)
    expect(call('PATCH', `/cases/${ben.id}/status`, { token: cw, body: { case_status: 'bogus' } }).status).toBe(422)
    // survives a "page reload": drop the in-memory copy and read localStorage again
    _setDbForTests(null)
    const prof = call('GET', `/cases/${ben.id}`, { token: cw }).data
    expect(prof.notes.some((n: any) => n.body === 'Spoke today')).toBe(true)
    expect(prof.interventions.some((i: any) => i.id === iv.id && i.outcome === 'improved')).toBe(true)
    expect(prof.profile.case_status).toBe('monitoring')
  })
  it('admin analytics are aggregate-only with small-cell suppression', () => {
    const a = demo('admin'), o = call('GET', '/analytics/overview', { token: a }).data
    expect(o.total_beneficiaries).toBe(25)
    expect(JSON.stringify(o)).not.toMatch(/BEN-\d{5}|Participant|Debashish/)
    const n = call('GET', '/analytics/overview', { token: a, query: { org_unit: 'Demo Unit North' } }).data
    for (const v of Object.values(n.priority_distribution)) expect(v === null || v === 0 || (v as number) >= 3).toBe(true)
  })
  it('admin: user management, assignment, engine config validation, erasure; invitations allow registration', () => {
    const a = demo('admin')
    expect(call('POST', '/admin/users', { token: a, body: { username: 'new_cw', display_name: 'N', password: 'weak', role: 'caseworker' } }).status).toBe(422)
    const u = call('POST', '/admin/users', { token: a, body: { username: 'new_cw', display_name: 'N', password: 'Strong-pass-1', role: 'caseworker' } })
    expect(u.status).toBe(201)
    expect(call('POST', '/admin/users', { token: a, body: { username: 'new_cw', display_name: 'N', password: 'Strong-pass-1', role: 'caseworker' } }).status).toBe(409)
    expect(call('PATCH', `/admin/users/${u.data.id}`, { token: a, body: { is_active: false } }).data.is_active).toBe(false)
    expect(call('POST', '/auth/login', { body: { username: 'new_cw', password: 'Strong-pass-1' } }).status).toBe(401)
    expect(call('PUT', '/admin/engine-config', { token: a, body: { attention_overall: 90, urgent_overall: 50 } }).status).toBe(422)
    expect(call('PUT', '/admin/engine-config', { token: a, body: { attention_overall: 42 } }).data.config.attention_overall).toBe(42)
    const inv = call('POST', '/admin/invitations', { token: a, body: { org_unit: 'Demo Unit North', valid_days: 2 } }).data.code
    const reg = { invite_code: inv, username: 'newbie', password: 'Strong-pass-1', display_name: 'Newbie', consent_privacy: true, consent_assessment: true }
    expect(call('POST', '/auth/register', { body: { ...reg, consent_assessment: false } }).status).toBe(422)
    expect(call('POST', '/auth/register', { body: reg }).status).toBe(201)
    expect(call('POST', '/auth/register', { body: { ...reg, username: 'newbie2' } }).status).toBe(400)   // single use
    const nb = loadDb().bens.find((b) => userDisplay(b.user_id) === 'Newbie')!
    const bt = call('POST', '/auth/login', { body: { username: 'newbie', password: 'Strong-pass-1' } }).data.access_token
    expect(call('POST', '/me/deletion-request', { token: bt }).status).toBe(200)
    expect(call('GET', '/admin/deletion-requests', { token: a }).data.some((d: any) => d.beneficiary_id === nb.id)).toBe(true)
    expect(call('DELETE', `/admin/beneficiaries/${nb.id}`, { token: a }).status).toBe(204)
    expect(call('POST', '/auth/login', { body: { username: 'newbie', password: 'Strong-pass-1' } }).status).toBe(401)
    const cws = call('GET', '/admin/caseworkers', { token: a }).data
    const ben = loadDb().bens[1]
    expect(call('POST', `/cases/${ben.id}/assign`, { token: a, body: { caseworker_id: cws[0].id } }).data.changed).toBe(true)
  })
})

function userDisplay(uid: number) { return loadDb().users.find((u) => u.id === uid)!.display_name }
