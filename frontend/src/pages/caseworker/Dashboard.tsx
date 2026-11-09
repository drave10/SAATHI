import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertOctagon, CalendarClock, CalendarX, ClipboardCheck, ClipboardList, Eye, Search, Users } from 'lucide-react'
import { api } from '../../api/client'
import { Async, Badge, Card, EmptyState, ErrorState, Pagination, PageHeader, PriorityBadge, Spinner, Stat, fmtDate, prettify, useFetch, useToast } from '../../components/ui'
import type { Alert, CaseRow, Level, Page } from '../../types'

interface Summary {
  assigned_beneficiaries: number; assessments_completed: number; assessments_completed_30d: number; assessments_pending: number
  awaiting_review: number; urgent_notifications: number; attention_notifications: number
  followups_due_7d: number; followups_overdue: number; followups_requested: number
  priority_distribution: Record<string, number>
  recent_activity: { at: string; type: string; beneficiary_id: number; code: string; text: string; level: Level | null }[]
}

export function CaseTable() {
  const nav = useNavigate()
  const [f, setF] = useState({ q: '', priority: '', status: '', needs_review: '', assessment_due: '', sort: 'priority', order: 'asc', page: 1 })
  const set = (k: string, v: string | number) => setF((p) => ({ ...p, [k]: v, page: k === 'page' ? (v as number) : 1 }))
  const state = useFetch(() => {
    const params: Record<string, string | number | boolean> = { sort: f.sort, order: f.order, page: f.page, page_size: 8 }
    if (f.q) params.q = f.q
    if (f.priority) params.priority = f.priority
    if (f.status) params.status = f.status
    if (f.needs_review) params.needs_review = f.needs_review === 'yes'
    if (f.assessment_due) params.assessment_due = f.assessment_due === 'yes'
    return api.get<Page<CaseRow>>('/cases', { params }).then((r) => r.data)
  }, [f.q, f.priority, f.status, f.needs_review, f.assessment_due, f.sort, f.order, f.page])

  return (
    <Card title="Assigned cases" pad={false}>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative lg:col-span-2"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
          <input className="input pl-9" placeholder="Search by name or case code" aria-label="Search cases" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
        <select className="input" aria-label="Filter by review priority" value={f.priority} onChange={(e) => set('priority', e.target.value)}><option value="">All priorities</option><option value="urgent">Urgent review</option><option value="attention">Attention</option><option value="routine">Routine</option></select>
        <select className="input" aria-label="Filter by case status" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option><option value="open">Open</option><option value="monitoring">Monitoring</option><option value="follow_up_needed">Follow-up needed</option><option value="closed">Closed</option></select>
        <select className="input" aria-label="Filter by review needed" value={f.needs_review} onChange={(e) => set('needs_review', e.target.value)}><option value="">Review: any</option><option value="yes">Awaiting review</option><option value="no">Reviewed</option></select>
        <select className="input" aria-label="Sort cases" value={`${f.sort}:${f.order}`} onChange={(e) => { const [s, o] = e.target.value.split(':'); setF((p) => ({ ...p, sort: s, order: o, page: 1 })) }}>
          <option value="priority:asc">Sort: highest priority</option><option value="name:asc">Sort: name A–Z</option><option value="last_assessment:desc">Sort: latest check-in</option><option value="last_assessment:asc">Sort: oldest check-in</option><option value="status:asc">Sort: status</option>
        </select>
      </div>
      <Async state={state}>
        {(p) => p.items.length === 0 ? <EmptyState title="No cases match your filters" hint="Try clearing the search or filters." /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Beneficiary</th><th className="th">Review priority</th><th className="th">Last check-in</th><th className="th">Trend</th><th className="th">Status</th><th className="th">Next follow-up</th><th className="th"><span className="sr-only">Open</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {p.items.map((c) => (
                    <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/app/cases/${c.id}`)}>
                      <td className="td"><div className="font-medium text-navy-800">{c.display_name.replace(' (synthetic)', '')}</div><div className="text-xs text-slate-500">{c.code}</div></td>
                      <td className="td"><div className="flex flex-wrap items-center gap-1.5"><PriorityBadge level={c.latest?.priority_level} />{c.needs_review && <Badge tone="amber">Needs review</Badge>}</div></td>
                      <td className="td">{c.latest ? fmtDate(c.latest.submitted_at) : '—'}{c.assessment_due && <div className="text-xs text-amber-700">Check-in due</div>}</td>
                      <td className="td">{c.latest?.delta == null ? <span className="text-slate-400">—</span> : <span className={c.latest.delta > 5 ? 'font-medium text-red-700' : c.latest.delta < -5 ? 'font-medium text-teal-700' : 'text-slate-600'}>{c.latest.delta > 0 ? '+' : ''}{c.latest.delta}</span>}</td>
                      <td className="td"><Badge tone="navy">{prettify(c.case_status)}</Badge></td>
                      <td className="td">{c.overdue_followups ? <span className="font-medium text-red-700">{c.overdue_followups} overdue</span> : c.requested_followups ? <Badge tone="amber">Requested</Badge> : fmtDate(c.next_followup)}</td>
                      <td className="td text-right"><Link to={`/app/cases/${c.id}`} className="btn-secondary py-1" onClick={(e) => e.stopPropagation()} aria-label={`Open case ${c.code}`}><Eye className="h-4 w-4" aria-hidden />Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={p.page} pageSize={p.page_size} total={p.total} onChange={(n) => set('page', n)} />
          </>
        )}
      </Async>
    </Card>
  )
}

export default function CaseworkerDashboard({ casesOnly = false }: { casesOnly?: boolean }) {
  const summary = useFetch(() => (casesOnly ? Promise.resolve(null as unknown as Summary) : api.get<Summary>('/analytics/caseworker-summary').then((r) => r.data)), [casesOnly])
  const alerts = useFetch(() => (casesOnly ? Promise.resolve([] as Alert[]) : api.get<Alert[]>('/alerts', { params: { status: 'open' } }).then((r) => r.data)), [casesOnly])
  const toast = useToast()

  async function ack(a: Alert, status: 'acknowledged' | 'resolved') {
    try { await api.patch(`/alerts/${a.id}`, { status }); toast.ok(status === 'resolved' ? 'Notification resolved.' : 'Notification acknowledged.'); alerts.reload(); summary.reload() } catch (e) { toast.fail(e) }
  }

  if (casesOnly) return (<><PageHeader title="Cases" subtitle="Search and filter the beneficiaries assigned to you." /><CaseTable /></>)

  return (
    <>
      <PageHeader title="Caseworker dashboard" subtitle="Overview of your caseload. Review priorities are prompts for human follow-up — not diagnoses." />
      {toast.node}
      {summary.loading && !summary.data ? <Spinner /> : summary.error && !summary.data ? <ErrorState message={summary.error} onRetry={summary.reload} /> : summary.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Assigned beneficiaries" value={summary.data.assigned_beneficiaries} icon={<Users className="h-4 w-4" />} />
            <Stat label="Check-ins completed" value={summary.data.assessments_completed} hint={`${summary.data.assessments_completed_30d} in the last 30 days`} icon={<ClipboardCheck className="h-4 w-4" />} />
            <Stat label="Check-ins due" value={summary.data.assessments_pending} hint="No check-in within the configured interval" icon={<ClipboardList className="h-4 w-4" />} tone={summary.data.assessments_pending ? 'attention' : 'default'} />
            <Stat label="Awaiting review" value={summary.data.awaiting_review} tone={summary.data.awaiting_review ? 'attention' : 'good'} />
            <Stat label="Urgent notifications" value={summary.data.urgent_notifications} tone={summary.data.urgent_notifications ? 'urgent' : 'good'} icon={<AlertOctagon className="h-4 w-4" />} hint={`${summary.data.attention_notifications} attention`} />
            <Stat label="Follow-ups due (7 days)" value={summary.data.followups_due_7d} icon={<CalendarClock className="h-4 w-4" />} hint={`${summary.data.followups_requested} requested by beneficiaries`} />
            <Stat label="Overdue follow-ups" value={summary.data.followups_overdue} tone={summary.data.followups_overdue ? 'urgent' : 'good'} icon={<CalendarX className="h-4 w-4" />} />
            <Stat label="Routine / Attention / Urgent" value={<span className="text-2xl">{summary.data.priority_distribution.routine} / {summary.data.priority_distribution.attention} / {summary.data.priority_distribution.urgent}</span>} hint="Latest check-in per case" />
          </div>
          <div className="grid gap-6 lg:grid-cols-5">
            <Card title="Review notifications" className="lg:col-span-3" pad={false}>
              <Async state={alerts}>
                {(list) => list.length === 0 ? <EmptyState title="No open notifications" hint="New review notifications appear here after a beneficiary submits a check-in." /> : (
                  <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                        <div className="min-w-0"><div className="flex items-center gap-2"><PriorityBadge level={a.level} /><Link className="font-medium text-navy-800 hover:underline" to={`/app/cases/${a.beneficiary_id}`}>{a.beneficiary_name?.replace(' (synthetic)', '')}</Link><span className="text-xs text-slate-500">{a.beneficiary_code}</span></div>
                          <p className="mt-1 truncate text-sm text-slate-600" title={a.reason}>{a.reason}</p><p className="text-xs text-slate-400">{fmtDate(a.created_at, true)}</p></div>
                        <div className="flex gap-2">
                          {a.status === 'open' && <button className="btn-secondary py-1" onClick={() => ack(a, 'acknowledged')}>Acknowledge</button>}
                          <button className="btn-secondary py-1" onClick={() => ack(a, 'resolved')}>Resolve</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Async>
            </Card>
            <Card title="Recent case activity" className="lg:col-span-2" pad={false}>
              {summary.data.recent_activity.length === 0 ? <EmptyState title="No recent activity" /> : (
                <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                  {summary.data.recent_activity.map((r, i) => (
                    <li key={i} className="px-5 py-3 text-sm"><div className="flex items-center justify-between"><Link className="font-medium text-navy-800 hover:underline" to={`/app/cases/${r.beneficiary_id}`}>{r.code}</Link><span className="text-xs text-slate-400">{fmtDate(r.at)}</span></div>
                      <div className="mt-0.5 flex items-center gap-2 text-slate-600">{r.text} {r.level && <PriorityBadge level={r.level} />}</div></li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}
      <div className="mt-6"><CaseTable /></div>
    </>
  )
}
