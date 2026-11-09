import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { Async, Badge, Banner, Card, EmptyState, Field, Modal, Pagination, PageHeader, Spinner, Stat, fmtDate, prettify, useFetch, useToast } from '../../components/ui'
import type { CaseRow, Page, Resource } from '../../types'

const TABS = [['overview', 'Overview & assignments'], ['engine', 'Assessment engine'], ['resources', 'Resources & emergency contacts'], ['onboarding', 'Onboarding & data deletion'], ['audit', 'Audit log']] as const
type Tab = (typeof TABS)[number][0]

export default function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <>
      <PageHeader title="Administration" subtitle="System configuration and oversight. Administrators cannot see individual assessment answers." />
      <div role="tablist" aria-label="Admin sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === k ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview />}{tab === 'engine' && <Engine />}{tab === 'resources' && <Resources />}{tab === 'onboarding' && <Onboarding />}{tab === 'audit' && <Audit />}
    </>
  )
}

/* ---------------- overview + assignments ---------------- */
interface CW { id: number; name: string; org_unit: string; caseload: number }
function Overview() {
  const [page, setPage] = useState(1)
  const cws = useFetch(() => api.get<CW[]>('/admin/caseworkers').then((r) => r.data))
  const roster = useFetch(() => api.get<Page<CaseRow>>('/cases', { params: { page, page_size: 10, sort: 'name' } }).then((r) => r.data), [page])
  const overview = useFetch(() => api.get('/analytics/overview').then((r) => r.data))
  const toast = useToast()
  async function assign(c: CaseRow, cwId: number) {
    try { await api.post(`/cases/${c.id}/assign`, { caseworker_id: cwId }); toast.ok(`Case ${c.code} reassigned.`); roster.reload(); cws.reload() } catch (e) { toast.fail(e) }
  }
  return (
    <div className="space-y-6">
      {toast.node}
      <Async state={overview}>{(o: any) => (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Beneficiaries" value={o.total_beneficiaries} hint={`${o.active_cases} active cases`} />
          <Stat label="Check-ins (period)" value={o.assessments_submitted} hint={`${o.period.from} → ${o.period.to}`} />
          <Stat label="Completion rate" value={o.assessment_completion_rate == null ? '—' : `${Math.round(o.assessment_completion_rate * 100)}%`} hint="Beneficiaries with ≥1 check-in" />
          <Stat label="Follow-up completion" value={o.followups.completion_rate == null ? '—' : `${Math.round(o.followups.completion_rate * 100)}%`} hint={`${o.followups.overdue} overdue`} tone={o.followups.overdue ? 'attention' : 'good'} />
        </div>)}</Async>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Caseworker caseloads" pad={false} className="lg:col-span-1">
          <Async state={cws}>{(list) => <ul className="divide-y divide-slate-100">{list.map((c) => <li key={c.id} className="flex items-center justify-between px-5 py-3 text-sm"><div><div className="font-medium">{c.name.replace(' (synthetic)', '')}</div><div className="text-xs text-slate-500">{c.org_unit}</div></div><Badge tone="navy">{c.caseload} cases</Badge></li>)}</ul>}</Async>
        </Card>
        <Card title="Case assignment" className="lg:col-span-2" pad={false}>
          <Async state={roster}>{(p) => (
            <>
              <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Case</th><th className="th">Unit</th><th className="th">Status</th><th className="th">Caseworker</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{p.items.map((c) => (
                  <tr key={c.id}><td className="td font-medium">{c.code}{c.deletion_requested && <Badge tone="red"> deletion requested</Badge>}</td><td className="td">{c.org_unit}</td><td className="td"><Badge>{prettify(c.case_status)}</Badge></td>
                    <td className="td"><select className="input py-1" aria-label={`Caseworker for ${c.code}`} value={c.caseworker_id ?? ''} onChange={(e) => e.target.value && assign(c, Number(e.target.value))}><option value="">Unassigned</option>{(cws.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name.replace(' (synthetic)', '')}</option>)}</select></td></tr>))}</tbody></table></div>
              <Pagination page={p.page} pageSize={p.page_size} total={p.total} onChange={setPage} />
            </>)}</Async>
        </Card>
      </div>
    </div>
  )
}

/* ---------------- engine config ---------------- */
const FIELDS: [string, string, string][] = [
  ['attention_overall', 'Attention: overall index ≥', 'Overall concern index (0–100) at or above which review priority becomes Attention.'],
  ['urgent_overall', 'Urgent review: overall index ≥', 'Overall index at or above which review priority becomes Urgent review.'],
  ['attention_dimension', 'Attention: any dimension ≥', 'Any single dimension at/above this value triggers Attention.'],
  ['urgent_dimension_safety', 'Urgent: safety dimension ≥', 'Safety dimension at/above this triggers Urgent review.'],
  ['rise_attention', 'Attention: rise since previous ≥', 'Increase in overall index vs the previous check-in.'],
  ['rise_urgent', 'Urgent: rise since previous ≥', 'Sharp increase in overall index vs the previous check-in.'],
  ['dimension_rise_attention', 'Attention: sleep/daily-activity rise ≥', 'Increase in sleep or daily-functioning dimension.'],
  ['persistence_dimension', 'Persistence: elevated level', 'Dimension level counted as elevated for the persistence rule.'],
  ['persistence_window', 'Persistence: window (check-ins)', 'Number of recent check-ins considered.'],
  ['persistence_min_count', 'Persistence: minimum elevated', 'How many of the window must be elevated.'],
  ['min_completion', 'Minimum completion (0–1)', 'Below this, threshold rules are not applied (critical items still are).'],
  ['assessment_interval_days', 'Check-in interval (days)', 'A new check-in is shown as due after this many days.'],
]
function Engine() {
  const state = useFetch(() => api.get('/admin/engine-config').then((r) => r.data))
  const [draft, setDraft] = useState<Record<string, number> | null>(null)
  const toast = useToast()
  async function save(cfg: Record<string, number>) { try { await api.put('/admin/engine-config', cfg); toast.ok('Configuration saved. It applies to new check-ins and recalculations.'); setDraft(null); state.reload() } catch (e) { toast.fail(e) } }
  return (
    <Async state={state}>{(d: any) => {
      const cfg = draft ?? d.config
      const m = d.ml?.metrics
      return (
        <div className="space-y-6">
          {toast.node}
          <Banner>Review priorities are transparent rules, documented in <code>docs/assessment_methodology.md</code>. Critical safety items (self-harm item, feeling unsafe, urgent contact request) always trigger Urgent review regardless of these thresholds.</Banner>
          <Card title="Rule thresholds" actions={<div className="flex gap-2"><button className="btn-secondary py-1" onClick={() => save(d.defaults)}>Reset to defaults</button><button className="btn-primary py-1" disabled={!draft} onClick={() => save(draft!)}>Save changes</button></div>}>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map(([k, label, hint]) => <Field key={k} label={label} htmlFor={k} hint={hint}><input id={k} type="number" step="any" className="input" value={cfg[k]} onChange={(e) => setDraft({ ...cfg, [k]: Number(e.target.value) })} /></Field>)}
            </div>
          </Card>
          <Card title="Experimental ML advisory">
            {!d.ml?.available ? <p className="text-sm text-slate-600">No trained model file found. The application works fully without it (rule-based engine only). Train one with <code>python -m scripts.train_model</code>.</p> : (
              <div className="text-sm text-slate-700"><p>A logistic-regression model trained on <strong>synthetic</strong> data is attached to caseworker views as an advisory. It never changes the review priority.</p>
                {m && <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Accuracy (synthetic test)</dt><dd className="text-lg font-semibold">{m.accuracy}</dd></div><div><dt className="text-xs text-slate-500">Macro F1</dt><dd className="text-lg font-semibold">{m.macro_f1}</dd></div><div><dt className="text-xs text-slate-500">ROC AUC (OvR)</dt><dd className="text-lg font-semibold">{m.roc_auc_ovr_macro}</dd></div><div><dt className="text-xs text-slate-500">Majority baseline</dt><dd className="text-lg font-semibold">{m.majority_baseline_accuracy}</dd></div></dl>}
                <p className="mt-3 text-xs text-amber-800">{m?.disclaimer}</p></div>)}
          </Card>
        </div>)
    }}</Async>
  )
}

/* ---------------- resources ---------------- */
function Resources() {
  const state = useFetch(() => api.get<Resource[]>('/admin/resources').then((r) => r.data))
  const [edit, setEdit] = useState<Partial<Resource> | null>(null)
  const toast = useToast()
  async function save() {
    const e = edit!
    const body = { title: e.title, category: e.category ?? 'support', summary: e.summary, body: e.body ?? '', contact: e.contact || null, region: e.region || null, is_verified: !!e.is_verified, is_active: e.is_active ?? true }
    try { e.id ? await api.put(`/admin/resources/${e.id}`, body) : await api.post('/admin/resources', body); toast.ok('Resource saved.'); setEdit(null); state.reload() } catch (err) { toast.fail(err) }
  }
  async function del(r: Resource) { if (!confirm(`Delete "${r.title}"?`)) return; try { await api.delete(`/admin/resources/${r.id}`); toast.ok('Resource deleted.'); state.reload() } catch (e) { toast.fail(e) } }
  return (
    <>
      {toast.node}
      <Banner kind="warn">Emergency and support contacts shown to beneficiaries must be verified by your organisation. Mark an entry "Verified" only after confirming the number and hours locally.</Banner>
      <Card className="mt-4" title="All resources" pad={false} actions={<button className="btn-primary py-1" onClick={() => setEdit({ category: 'support', is_active: true })}>Add resource</button>}>
        <Async state={state}>{(rows) => (
          <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Title</th><th className="th">Category</th><th className="th">Contact</th><th className="th">Verified</th><th className="th">Active</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.id}><td className="td font-medium">{r.title}</td><td className="td"><Badge tone={r.category === 'emergency' ? 'red' : r.category === 'support' ? 'navy' : 'slate'}>{r.category}</Badge></td><td className="td">{r.contact ?? '—'}</td><td className="td">{r.is_verified ? <Badge tone="teal">Verified</Badge> : <Badge tone="amber">Unverified</Badge>}</td><td className="td">{r.is_active ? 'Yes' : 'No'}</td>
              <td className="td text-right whitespace-nowrap"><button className="btn-secondary mr-2 py-1" onClick={() => setEdit(r)}>Edit</button><button className="btn-ghost py-1 text-red-700" onClick={() => del(r)}>Delete</button></td></tr>)}</tbody></table></div>)}</Async>
      </Card>
      {edit && <Modal title={edit.id ? 'Edit resource' : 'Add resource'} onClose={() => setEdit(null)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save() }}>
          <Field label="Title" htmlFor="r_t"><input id="r_t" required className="input" maxLength={160} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Category" htmlFor="r_c"><select id="r_c" className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as Resource['category'] })}><option value="education">Education</option><option value="support">Support service</option><option value="emergency">Emergency contact</option></select></Field>
          <Field label="Summary" htmlFor="r_s"><input id="r_s" required className="input" maxLength={400} value={edit.summary ?? ''} onChange={(e) => setEdit({ ...edit, summary: e.target.value })} /></Field>
          <Field label="Details" htmlFor="r_b"><textarea id="r_b" rows={3} className="input" value={edit.body ?? ''} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Contact (phone / address)" htmlFor="r_k"><input id="r_k" className="input" value={edit.contact ?? ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></Field><Field label="Region" htmlFor="r_g"><input id="r_g" className="input" value={edit.region ?? ''} onChange={(e) => setEdit({ ...edit, region: e.target.value })} /></Field></div>
          <div className="flex gap-6 text-sm"><label className="flex gap-2"><input type="checkbox" checked={!!edit.is_verified} onChange={(e) => setEdit({ ...edit, is_verified: e.target.checked })} />Verified</label><label className="flex gap-2"><input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />Active</label></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary">Save</button></div>
        </form></Modal>}
    </>
  )
}

/* ---------------- onboarding + deletion ---------------- */
function Onboarding() {
  const cws = useFetch(() => api.get<CW[]>('/admin/caseworkers').then((r) => r.data))
  const dels = useFetch(() => api.get<{ beneficiary_id: number; code: string; requested_at: string }[]>('/admin/deletion-requests').then((r) => r.data))
  const units = useFetch(() => api.get<string[]>('/admin/org-units').then((r) => r.data))
  const [inv, setInv] = useState({ org_unit: '', caseworker_id: '', valid_days: 7 })
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => { if (units.data?.length && !inv.org_unit) setInv((p) => ({ ...p, org_unit: units.data![0] })) }, [units.data, inv.org_unit])
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  async function createInv() {
    setBusy(true)
    try { const r = await api.post('/admin/invitations', { org_unit: inv.org_unit, caseworker_id: inv.caseworker_id ? Number(inv.caseworker_id) : null, valid_days: inv.valid_days }); setCode(r.data.code) } catch (e) { toast.fail(e) } finally { setBusy(false) }
  }
  async function erase(id: number, c: string) {
    if (!confirm(`Permanently erase ALL data for ${c}? This cannot be undone.`)) return
    try { await api.delete(`/admin/beneficiaries/${id}`); toast.ok(`${c} erased.`); dels.reload() } catch (e) { toast.fail(e) }
  }
  async function retention() { try { const r = await api.post('/admin/retention/run'); toast.ok(`Retention job complete: ${r.data.purged_free_text_answers} free-text answers purged (older than ${r.data.older_than_days} days).`) } catch (e) { toast.fail(e) } }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="lg:col-span-2">{toast.node}</div>
      <Card title="Create onboarding invitation">
        <p className="mb-4 text-sm text-slate-600">Beneficiaries register themselves using a single-use code. Only a hash of the code is stored; it is shown once.</p>
        <div className="space-y-3">
          <Field label="Organisational unit" htmlFor="i_u" hint="Pick an existing unit or type a new one."><input id="i_u" list="org-units" className="input" value={inv.org_unit} onChange={(e) => setInv({ ...inv, org_unit: e.target.value })} /><datalist id="org-units">{(units.data ?? []).map((u) => <option key={u} value={u} />)}</datalist></Field>
          <Field label="Assign to caseworker" htmlFor="i_c"><select id="i_c" className="input" value={inv.caseworker_id} onChange={(e) => setInv({ ...inv, caseworker_id: e.target.value })}><option value="">Unassigned</option>{(cws.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name.replace(' (synthetic)', '')}</option>)}</select></Field>
          <Field label="Valid for (days)" htmlFor="i_d"><input id="i_d" type="number" min={1} max={60} className="input" value={inv.valid_days} onChange={(e) => setInv({ ...inv, valid_days: Number(e.target.value) })} /></Field>
          <button className="btn-primary" disabled={busy || !inv.org_unit} onClick={createInv}>Generate code</button>
          {code && <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-center"><div className="text-xs text-teal-800">Share securely with the beneficiary (shown once)</div><div className="mt-1 font-mono text-2xl font-semibold tracking-widest text-teal-900" data-testid="invite-code">{code}</div></div>}
        </div>
      </Card>
      <div className="space-y-6">
        <Card title="Data deletion requests" pad={false}>
          <Async state={dels}>{(rows) => rows.length === 0 ? <EmptyState title="No pending requests" /> : <ul className="divide-y divide-slate-100">{rows.map((r) => <li key={r.beneficiary_id} className="flex items-center justify-between px-5 py-3 text-sm"><div><div className="font-medium">{r.code}</div><div className="text-xs text-slate-500">Requested {fmtDate(r.requested_at)}</div></div><button className="btn-danger py-1" onClick={() => erase(r.beneficiary_id, r.code)}>Erase permanently</button></li>)}</ul>}</Async>
        </Card>
        <Card title="Retention"><p className="mb-3 text-sm text-slate-600">Free-text answers are purged after the configured retention period. Scored data is kept for monitoring.</p><button className="btn-secondary" onClick={retention}>Run retention job now</button></Card>
      </div>
    </div>
  )
}

/* ---------------- audit ---------------- */
function Audit() {
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const actions = useFetch(() => api.get<string[]>('/admin/audit-actions').then((r) => r.data))
  const state = useFetch(() => api.get<Page<any>>('/admin/audit-logs', { params: { page, page_size: 15, ...(action ? { action } : {}) } }).then((r) => r.data), [page, action])
  return (
    <Card title="Audit log" pad={false} actions={<select className="input w-auto py-1" aria-label="Filter by action" value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }}><option value="">All actions</option>{(actions.data ?? []).map((a) => <option key={a} value={a}>{a}</option>)}</select>}>
      <Async state={state}>{(p) => (
        <>
          <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Time</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Detail</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{p.items.map((l: any) => <tr key={l.id}><td className="td whitespace-nowrap">{fmtDate(l.created_at, true)}</td><td className="td">{l.actor_role ?? 'anonymous'}{l.actor_user_id ? ` #${l.actor_user_id}` : ''}</td><td className="td font-mono text-xs">{l.action}</td><td className="td">{l.entity_type ? `${l.entity_type}${l.entity_id ? ' #' + l.entity_id : ''}` : '—'}</td><td className="td text-slate-600">{l.detail ?? ''}</td></tr>)}</tbody></table></div>
          <Pagination page={p.page} pageSize={p.page_size} total={p.total} onChange={setPage} />
        </>)}</Async>
    </Card>
  )
}

export const _x = Spinner
