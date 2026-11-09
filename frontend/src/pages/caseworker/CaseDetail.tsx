import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarPlus, ClipboardPlus, Cpu, Info } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api/client'
import { Async, Badge, Banner, Card, EmptyState, Field, Modal, PageHeader, PriorityBadge, Spinner, fmtDate, prettify, toLocalInput, useFetch, useToast } from '../../components/ui'
import { DIMENSION_LABELS, type CaseProfile, type Level } from '../../types'

const OUTCOMES = ['improved', 'no_change', 'worsened', 'referred', 'pending']

export default function CaseDetail() {
  const { id } = useParams()
  const state = useFetch(() => api.get<CaseProfile>(`/cases/${id}`).then((r) => r.data), [id])
  const types = useFetch(() => api.get<string[]>('/interventions/types').then((r) => r.data))
  const toast = useToast()
  const [modal, setModal] = useState<null | 'followup' | 'intervention' | 'answers'>(null)
  const [note, setNote] = useState('')
  const [fu, setFu] = useState({ scheduled_for: toLocalInput(new Date(Date.now() + 3 * 864e5)), kind: 'check_in', reason: '' })
  const [iv, setIv] = useState({ type: 'counselling_session', description: '', outcome: '' })
  const [answers, setAnswers] = useState<any>(null)

  const act = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    try { await fn(); toast.ok(ok); after?.(); state.reload() } catch (e) { toast.fail(e) }
  }

  async function openAnswers(aid: number) {
    setModal('answers'); setAnswers(null)
    const [d, c] = await Promise.all([api.get(`/assessments/${aid}`), api.get(`/assessments/${aid}/compare`)])
    setAnswers({ ...d.data, compare: c.data })
  }

  return (
    <Async state={state}>
      {(d) => {
        const p = d.profile
        const tl = d.timeline.map((t) => ({ date: fmtDate(t.submitted_at), overall: t.overall_score, level: t.priority_level, ...t.dimension_scores }))
        const last = d.timeline[d.timeline.length - 1], prev = d.timeline[d.timeline.length - 2]
        const radar = Object.keys(DIMENSION_LABELS).map((k) => ({ area: DIMENSION_LABELS[k], Latest: last?.dimension_scores?.[k] ?? 0, Previous: prev?.dimension_scores?.[k] ?? undefined }))
        const ex = d.latest_explanation
        const ml = ex?.ml_advisory
        return (
          <>
            <Link to="/app/cases" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-navy-700"><ArrowLeft className="h-4 w-4" aria-hidden /> All cases</Link>
            <PageHeader title={p.display_name.replace(' (synthetic)', '')} subtitle={`${p.code} · ${p.org_unit} · ${d.preferred_language}${d.age_band ? ' · age ' + d.age_band : ''}${p.is_synthetic ? ' · SYNTHETIC RECORD' : ''}`}
              actions={<><button className="btn-secondary" onClick={() => setModal('followup')}><CalendarPlus className="h-4 w-4" aria-hidden />Schedule follow-up</button><button className="btn-primary" onClick={() => setModal('intervention')}><ClipboardPlus className="h-4 w-4" aria-hidden />Record intervention</button></>} />
            {toast.node}
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <PriorityBadge level={p.latest?.priority_level} />
              {p.needs_review && <Badge tone="amber">Awaiting your review</Badge>}
              {p.assessment_due && <Badge tone="slate">Check-in due</Badge>}
              <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">Case status
                <select className="input w-auto py-1.5" value={p.case_status} onChange={(e) => act(() => api.patch(`/cases/${p.id}/status`, { case_status: e.target.value }), 'Case status updated.')}>
                  <option value="open">Open</option><option value="monitoring">Monitoring</option><option value="follow_up_needed">Follow-up needed</option><option value="closed">Closed</option>
                </select></label>
            </div>

            {d.alerts.some((a) => a.status === 'open' && a.level === 'urgent') && <div className="mb-6"><Banner kind="error"><strong>Urgent review notification open.</strong> Please contact this person through your organisation's protocol. This tool does not contact anyone automatically.</Banner></div>}

            <div className="grid gap-6 xl:grid-cols-3">
              <div className="min-w-0 space-y-6 xl:col-span-2">
                <Card title="Assessment timeline">
                  {d.timeline.length === 0 ? <EmptyState title="No check-ins yet" /> : (
                    <div className="h-72" role="img" aria-label="Line chart of overall concern index over time">
                      <ResponsiveContainer><LineChart data={tl} margin={{ left: -10, right: 10, top: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} />
                        <ReferenceLine y={40} stroke="#d97706" strokeDasharray="4 4" label={{ value: 'Attention', fontSize: 10, fill: '#d97706', position: 'insideTopRight' }} /><ReferenceLine y={70} stroke="#dc2626" strokeDasharray="4 4" label={{ value: 'Urgent', fontSize: 10, fill: '#dc2626', position: 'insideTopRight' }} />
                        <Tooltip /><Line type="monotone" dataKey="overall" name="Concern index" stroke="#1c3a68" strokeWidth={3} connectNulls
                          dot={(pr: any) => { const c = ({ urgent: '#dc2626', attention: '#d97706', routine: '#259d93' } as Record<string, string>)[pr.payload.level as Level] ?? '#64748b'; return <circle key={pr.key} cx={pr.cx} cy={pr.cy} r={6} fill={c} stroke="#fff" strokeWidth={2} /> }} /></LineChart></ResponsiveContainer>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">Concern index: 0–100 summary of self-reported answers (higher = more concern reported). Dot colour shows the review priority at that check-in.</p>
                </Card>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card title="Dimensions: latest vs previous">
                    {last ? <div className="h-72" role="img" aria-label="Radar chart of latest and previous dimension scores"><ResponsiveContainer><RadarChart data={radar}><PolarGrid /><PolarAngleAxis dataKey="area" fontSize={10} /><PolarRadiusAxis domain={[0, 100]} fontSize={10} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                      {prev && <Radar name="Previous" dataKey="Previous" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.15} />}<Radar name="Latest" dataKey="Latest" stroke="#1c3a68" fill="#1c3a68" fillOpacity={0.3} /></RadarChart></ResponsiveContainer></div> : <EmptyState title="No data" />}
                  </Card>
                  <Card title="Why this review priority?" actions={<Info className="h-4 w-4 text-slate-400" aria-hidden />}>
                    {!ex ? <EmptyState title="No explanation yet" /> : (
                      <div className="space-y-3 text-sm">
                        <ul className="space-y-2">
                          {ex.factors.map((f) => (
                            <li key={f.code} className="rounded-lg border border-slate-100 p-2.5"><div className="flex items-center justify-between gap-2"><span className="font-medium">{f.label}</span><Badge tone={f.severity === 'urgent' ? 'red' : f.severity === 'attention' ? 'amber' : 'slate'}>{f.severity}</Badge></div><p className="mt-0.5 text-slate-600">{f.detail}</p></li>
                          ))}
                        </ul>
                        {ex.change_summary?.overall_delta != null && <p className="text-slate-600">Change since previous check-in: <strong>{ex.change_summary.overall_delta > 0 ? '+' : ''}{ex.change_summary.overall_delta}</strong> points.</p>}
                        {ex.data_quality?.note && <Banner kind="warn">{ex.data_quality.note}</Banner>}
                        <p className="text-xs text-slate-500">Rule-based recommendation to prioritise human review. Not a diagnosis or a prediction of harm.</p>
                        {ml && (
                          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-700"><Cpu className="h-3.5 w-3.5" aria-hidden />Experimental ML advisory (synthetic-trained)</div>
                            Model-estimated class: <strong>{ml.estimated_class}</strong>. Influences: {ml.top_influences.map((t: any) => t.feature).join(', ')}. {ml.label}</div>
                        )}
                        {last && p.needs_review && <button className="btn-teal w-full" onClick={() => act(() => api.post(`/assessments/${last.assessment_id}/mark-reviewed`), 'Marked as reviewed.')}>Mark latest check-in as reviewed</button>}
                      </div>
                    )}
                  </Card>
                </div>

                <Card title="Check-in history" pad={false}>
                  {d.timeline.length === 0 ? <EmptyState title="No check-ins yet" /> : (
                    <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Date</th><th className="th">Priority</th><th className="th">Index</th><th className="th">Key factors</th><th className="th"><span className="sr-only">Details</span></th></tr></thead>
                      <tbody className="divide-y divide-slate-100">{[...d.timeline].reverse().map((t) => (
                        <tr key={t.assessment_id}><td className="td whitespace-nowrap">{fmtDate(t.submitted_at)}</td><td className="td"><PriorityBadge level={t.priority_level} /></td><td className="td">{t.overall_score ?? '—'}</td>
                          <td className="td text-slate-600">{t.top_factors.join('; ') || '—'}</td><td className="td text-right"><button className="btn-secondary py-1" onClick={() => openAnswers(t.assessment_id)}>Answers</button></td></tr>
                      ))}</tbody></table></div>
                  )}
                </Card>
              </div>

              <div className="min-w-0 space-y-6">
                <Card title="Case notes">
                  <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) act(() => api.post(`/cases/${p.id}/notes`, { body: note }), 'Note saved.', () => setNote('')) }}>
                    <label htmlFor="note" className="sr-only">New case note</label>
                    <textarea id="note" className="input" rows={3} placeholder="Add a case note…" maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn-primary" disabled={!note.trim()}>Save note</button>
                  </form>
                  <ul className="mt-4 max-h-72 space-y-3 overflow-y-auto">
                    {d.notes.length === 0 && <li className="text-sm text-slate-500">No notes yet.</li>}
                    {d.notes.map((n) => <li key={n.id} className="rounded-lg bg-slate-50 p-3 text-sm"><p className="whitespace-pre-line">{n.body}</p><p className="mt-1 text-xs text-slate-400">{n.author_name?.replace(' (synthetic)', '') ?? 'Unknown'} · {fmtDate(n.created_at, true)}</p></li>)}
                  </ul>
                </Card>

                <Card title="Follow-ups" pad={false}>
                  {d.follow_ups.length === 0 ? <EmptyState title="No follow-ups" /> : (
                    <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {d.follow_ups.map((f) => (
                        <li key={f.id} className="px-5 py-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{prettify(f.kind)}</span>
                          <Badge tone={f.status === 'completed' ? 'teal' : f.is_overdue ? 'red' : f.status === 'requested' ? 'amber' : 'navy'}>{f.is_overdue ? 'Overdue' : prettify(f.status)}</Badge></div>
                          <p className="text-slate-500">{f.status === 'requested' ? 'Requested by beneficiary' : fmtDate(f.scheduled_for, true)}</p>
                          {f.status === 'scheduled' && <button className="mt-1 text-xs font-medium text-teal-700 hover:underline" onClick={() => act(() => api.post(`/followups/${f.id}/complete`, {}), 'Follow-up marked completed.')}>Mark completed</button>}
                          {f.status === 'requested' && <button className="mt-1 text-xs font-medium text-teal-700 hover:underline" onClick={() => setModal('followup')}>Schedule…</button>}</li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card title="Interventions" pad={false}>
                  {d.interventions.length === 0 ? <EmptyState title="No interventions recorded" /> : (
                    <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {d.interventions.map((i) => (
                        <li key={i.id} className="px-5 py-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{prettify(i.type)}</span><span className="text-xs text-slate-400">{fmtDate(i.occurred_at)}</span></div>
                          <p className="text-slate-600">{i.description}</p>
                          <select className="input mt-1 w-auto py-1 text-xs" aria-label="Intervention outcome" value={i.outcome ?? ''} onChange={(e) => e.target.value && act(() => api.patch(`/interventions/${i.id}/outcome`, { outcome: e.target.value }), 'Outcome saved.')}>
                            <option value="">Outcome: not recorded</option>{OUTCOMES.map((o) => <option key={o} value={o}>{prettify(o)}</option>)}</select></li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>

            {modal === 'followup' && (
              <Modal title="Schedule follow-up" onClose={() => setModal(null)}>
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); act(() => api.post('/followups', { beneficiary_id: p.id, scheduled_for: new Date(fu.scheduled_for).toISOString(), kind: fu.kind, reason: fu.reason || null }), 'Follow-up scheduled.', () => setModal(null)) }}>
                  <Field label="Date and time" htmlFor="fu_dt"><input id="fu_dt" type="datetime-local" required className="input" value={fu.scheduled_for} onChange={(e) => setFu({ ...fu, scheduled_for: e.target.value })} /></Field>
                  <Field label="Type" htmlFor="fu_kind"><select id="fu_kind" className="input" value={fu.kind} onChange={(e) => setFu({ ...fu, kind: e.target.value })}><option value="check_in">Check-in call</option><option value="home_visit">Home visit</option><option value="counselling">Counselling session</option><option value="review_meeting">Review meeting</option></select></Field>
                  <Field label="Reason / agenda (optional)" htmlFor="fu_r"><input id="fu_r" className="input" maxLength={400} value={fu.reason} onChange={(e) => setFu({ ...fu, reason: e.target.value })} /></Field>
                  <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary">Schedule</button></div>
                </form>
              </Modal>
            )}
            {modal === 'intervention' && (
              <Modal title="Record intervention" onClose={() => setModal(null)}>
                <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); act(() => api.post('/interventions', { beneficiary_id: p.id, type: iv.type, description: iv.description, outcome: iv.outcome || null }), 'Intervention recorded.', () => { setModal(null); setIv({ type: 'counselling_session', description: '', outcome: '' }) }) }}>
                  <Field label="Type" htmlFor="iv_t"><select id="iv_t" className="input" value={iv.type} onChange={(e) => setIv({ ...iv, type: e.target.value })}>{(types.data ?? ['counselling_session']).map((t) => <option key={t} value={t}>{prettify(t)}</option>)}</select></Field>
                  <Field label="Description" htmlFor="iv_d"><textarea id="iv_d" required rows={3} className="input" maxLength={4000} value={iv.description} onChange={(e) => setIv({ ...iv, description: e.target.value })} /></Field>
                  <Field label="Outcome (can be added later)" htmlFor="iv_o"><select id="iv_o" className="input" value={iv.outcome} onChange={(e) => setIv({ ...iv, outcome: e.target.value })}><option value="">Not yet recorded</option>{OUTCOMES.map((o) => <option key={o} value={o}>{prettify(o)}</option>)}</select></Field>
                  <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn-primary">Save</button></div>
                </form>
              </Modal>
            )}
            {modal === 'answers' && (
              <Modal title="Check-in answers" onClose={() => setModal(null)}>
                {!answers ? <Spinner /> : (
                  <div className="space-y-3 text-sm">
                    <p className="text-slate-500">{fmtDate(answers.submitted_at, true)}{answers.compare?.overall_delta != null && <> · change vs previous: <strong>{answers.compare.overall_delta > 0 ? '+' : ''}{answers.compare.overall_delta}</strong></>}</p>
                    {answers.responses.map((r: any) => <div key={r.question_id} className="border-b border-slate-100 pb-2"><div className="text-slate-500">{r.text}</div><div className="font-medium text-navy-800">{r.answer ?? r.free_text ?? '—'}</div></div>)}
                  </div>
                )}
              </Modal>
            )}
          </>
        )
      }}
    </Async>
  )
}
