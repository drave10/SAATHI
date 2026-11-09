import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { Async, Badge, Card, EmptyState, PageHeader, fmtDate, prettify, useFetch, useToast } from '../../components/ui'
import type { Intervention } from '../../types'

const OUTCOMES = ['improved', 'no_change', 'worsened', 'referred', 'pending']
const TONE: Record<string, 'teal' | 'slate' | 'red' | 'navy' | 'amber'> = { improved: 'teal', no_change: 'slate', worsened: 'red', referred: 'navy', pending: 'amber' }

export default function Interventions() {
  const [outcome, setOutcome] = useState('')
  const state = useFetch(() => api.get<Intervention[]>('/interventions', { params: outcome ? { outcome } : {} }).then((r) => r.data), [outcome])
  const toast = useToast()
  async function save(i: Intervention, value: string) {
    try { await api.patch(`/interventions/${i.id}/outcome`, { outcome: value }); toast.ok('Outcome saved.'); state.reload() } catch (e) { toast.fail(e) }
  }
  return (
    <>
      <PageHeader title="Intervention records" subtitle="Everything recorded for your assigned cases. Add new interventions from a case profile."
        actions={<select className="input w-auto" aria-label="Filter by outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}><option value="">All outcomes</option>{OUTCOMES.map((o) => <option key={o} value={o}>{prettify(o)}</option>)}</select>} />
      {toast.node}
      <Card pad={false}>
        <Async state={state}>
          {(rows) => rows.length === 0 ? <EmptyState title="No interventions found" hint="Record interventions from a beneficiary's case profile." /> : (
            <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Date</th><th className="th">Beneficiary</th><th className="th">Type</th><th className="th">Description</th><th className="th">Outcome</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{rows.map((i) => (
                <tr key={i.id}><td className="td whitespace-nowrap">{fmtDate(i.occurred_at)}</td>
                  <td className="td"><Link className="font-medium text-navy-800 hover:underline" to={`/app/cases/${i.beneficiary_id}`}>{i.beneficiary_name?.replace(' (synthetic)', '')}</Link><div className="text-xs text-slate-500">{i.beneficiary_code}</div></td>
                  <td className="td">{prettify(i.type)}</td><td className="td max-w-sm truncate text-slate-600" title={i.description}>{i.description}</td>
                  <td className="td">{i.outcome ? <Badge tone={TONE[i.outcome]}>{prettify(i.outcome)}</Badge> : null}
                    <select className="input ml-1 inline-block w-auto py-1 text-xs" aria-label={`Set outcome for intervention ${i.id}`} value={i.outcome ?? ''} onChange={(e) => e.target.value && save(i, e.target.value)}><option value="">{i.outcome ? 'Change…' : 'Record outcome…'}</option>{OUTCOMES.map((o) => <option key={o} value={o}>{prettify(o)}</option>)}</select></td></tr>))}</tbody></table></div>
          )}
        </Async>
      </Card>
    </>
  )
}
