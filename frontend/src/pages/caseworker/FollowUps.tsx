import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { Async, Badge, Card, EmptyState, Field, Modal, Pagination, PageHeader, fmtDate, prettify, toLocalInput, useFetch, useToast } from '../../components/ui'
import type { FollowUp, Page } from '../../types'

const FILTERS = [
  { k: 'all', label: 'All', params: {} }, { k: 'requested', label: 'Requested', params: { status: 'requested' } },
  { k: 'due', label: 'Due in 7 days', params: { due_within_days: 7 } }, { k: 'overdue', label: 'Overdue', params: { overdue: true } },
  { k: 'completed', label: 'Completed', params: { status: 'completed' } },
] as const

export default function FollowUps() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['k']>('requested')
  const [page, setPage] = useState(1)
  const state = useFetch(() => api.get<Page<FollowUp>>('/followups', { params: { ...FILTERS.find((f) => f.k === filter)!.params, page, page_size: 10 } }).then((r) => r.data), [filter, page])
  const toast = useToast()
  const [sched, setSched] = useState<FollowUp | null>(null)
  const [when, setWhen] = useState(toLocalInput(new Date(Date.now() + 2 * 864e5)))
  const [done, setDone] = useState<FollowUp | null>(null)
  const [notes, setNotes] = useState('')

  async function run(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast.ok(ok); setSched(null); setDone(null); setNotes(''); state.reload() } catch (e) { toast.fail(e) } }

  return (
    <>
      <PageHeader title="Follow-up management" subtitle="Requests from beneficiaries, upcoming appointments and overdue contacts." />
      {toast.node}
      <div role="tablist" aria-label="Follow-up filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => <button key={f.k} role="tab" aria-selected={filter === f.k} onClick={() => { setFilter(f.k); setPage(1) }} className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${filter === f.k ? 'bg-navy-700 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{f.label}</button>)}
      </div>
      <Card pad={false}>
        <Async state={state}>
          {(p) => p.items.length === 0 ? <EmptyState title="Nothing here" hint="No follow-ups match this filter." /> : (
            <>
              <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Beneficiary</th><th className="th">Type</th><th className="th">When</th><th className="th">Status</th><th className="th">Note</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">{p.items.map((f) => (
                  <tr key={f.id}>
                    <td className="td"><Link className="font-medium text-navy-800 hover:underline" to={`/app/cases/${f.beneficiary_id}`}>{f.beneficiary_name?.replace(' (synthetic)', '')}</Link><div className="text-xs text-slate-500">{f.beneficiary_code}</div></td>
                    <td className="td">{prettify(f.kind)}</td><td className="td whitespace-nowrap">{f.scheduled_for ? fmtDate(f.scheduled_for, true) : '—'}</td>
                    <td className="td"><Badge tone={f.status === 'completed' ? 'teal' : f.is_overdue ? 'red' : f.status === 'requested' ? 'amber' : f.status === 'cancelled' ? 'slate' : 'navy'}>{f.is_overdue ? 'Overdue' : prettify(f.status)}</Badge></td>
                    <td className="td max-w-xs truncate text-slate-600" title={f.reason ?? f.outcome_notes ?? ''}>{f.reason ?? f.outcome_notes ?? '—'}</td>
                    <td className="td text-right whitespace-nowrap">
                      {(f.status === 'requested' || f.status === 'scheduled') && <button className="btn-secondary mr-2 py-1" onClick={() => { setSched(f); if (f.scheduled_for) setWhen(toLocalInput(new Date(f.scheduled_for))) }}>{f.status === 'requested' ? 'Schedule' : 'Reschedule'}</button>}
                      {f.status === 'scheduled' && <button className="btn-teal py-1" onClick={() => setDone(f)}>Complete</button>}
                    </td></tr>))}</tbody></table></div>
              <Pagination page={p.page} pageSize={p.page_size} total={p.total} onChange={setPage} />
            </>
          )}
        </Async>
      </Card>
      {sched && <Modal title={sched.status === 'requested' ? 'Schedule requested follow-up' : 'Reschedule follow-up'} onClose={() => setSched(null)}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => api.patch(`/followups/${sched.id}`, { scheduled_for: new Date(when).toISOString(), status: 'scheduled' }), 'Follow-up scheduled.') }}>
          <Field label="Date and time" htmlFor="when"><input id="when" type="datetime-local" required className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setSched(null)}>Cancel</button><button className="btn-primary">Save</button></div></form></Modal>}
      {done && <Modal title="Mark follow-up completed" onClose={() => setDone(null)}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => api.post(`/followups/${done.id}/complete`, { outcome_notes: notes || null }), 'Follow-up completed.') }}>
          <Field label="Outcome notes (optional)" htmlFor="on"><textarea id="on" rows={3} className="input" maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setDone(null)}>Cancel</button><button className="btn-teal">Mark completed</button></div></form></Modal>}
    </>
  )
}
