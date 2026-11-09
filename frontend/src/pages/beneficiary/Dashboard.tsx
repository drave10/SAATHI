import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, CalendarClock, ClipboardCheck, HandHeart, Minus } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, Banner, Card, Field, Modal, PageHeader, Stat, fmtDate, prettify, useFetch, useToast } from '../../components/ui'

interface Me {
  display_name: string; caseworker_name: string | null; assessments_completed: number
  latest_wellbeing: number | null; previous_wellbeing: number | null; last_submitted_at: string | null
  check_in_due: boolean; next_due_at: string | null; has_draft: boolean
  upcoming_followups: { id: number; status: string; kind: string; scheduled_for: string | null }[]
}

export default function BeneficiaryDashboard() {
  const { user } = useAuth()
  const state = useFetch(() => api.get<Me>('/beneficiaries/me').then((r) => r.data))
  const [reqOpen, setReqOpen] = useState(false)
  const [reason, setReason] = useState('')
  const toast = useToast()

  async function requestFollowUp() {
    try {
      await api.post('/followups', { reason: reason || null })
      toast.ok('Your request has been sent. Your support worker will contact you.')
      setReqOpen(false); setReason(''); state.reload()
    } catch (e) { toast.fail(e); setReqOpen(false) }
  }

  return (
    <>
      <PageHeader title={`Hello, ${user?.display_name.replace(' (synthetic)', '')}`} subtitle="Your private space to check in on how you are doing." />
      {toast.node}
      <Async state={state}>
        {(d) => {
          const delta = d.latest_wellbeing != null && d.previous_wellbeing != null ? Math.round((d.latest_wellbeing - d.previous_wellbeing) * 10) / 10 : null
          return (
            <div className="space-y-6">
              <div className={`card flex flex-wrap items-center justify-between gap-4 p-6 ${d.check_in_due ? 'border-teal-300 bg-teal-50' : ''}`}>
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-600 text-white"><ClipboardCheck className="h-5 w-5" aria-hidden /></span>
                  <div>
                    <h2 className="text-lg font-semibold">{d.has_draft ? 'You have a check-in in progress' : d.check_in_due ? 'Time for your next check-in' : 'Your check-in is up to date'}</h2>
                    <p className="mt-1 text-sm text-slate-600">{d.last_submitted_at ? `Last check-in: ${fmtDate(d.last_submitted_at)}.` : 'You have not completed a check-in yet.'} It takes about 5 minutes and you can pause at any time.</p>
                  </div>
                </div>
                <Link to="/app/assessment" className="btn-teal">{d.has_draft ? 'Resume check-in' : 'Start check-in'}</Link>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Check-ins completed" value={d.assessments_completed} />
                <Stat label="Latest well-being score" value={d.latest_wellbeing ?? '—'} hint="Higher means you reported feeling better (0–100)"
                  icon={delta == null ? undefined : delta > 0 ? <ArrowUpRight className="h-4 w-4 text-teal-600" aria-label="improved" /> : delta < 0 ? <ArrowDownRight className="h-4 w-4 text-amber-600" aria-label="lower" /> : <Minus className="h-4 w-4 text-slate-400" aria-label="unchanged" />} />
                <Stat label="Your support worker" value={<span className="text-xl">{d.caseworker_name?.replace(' (synthetic)', '') ?? 'Not assigned yet'}</span>} />
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Upcoming follow-ups" actions={<CalendarClock className="h-4 w-4 text-slate-400" aria-hidden />}>
                  {d.upcoming_followups.length === 0 ? <p className="text-sm text-slate-500">No upcoming follow-ups.</p> : (
                    <ul className="divide-y divide-slate-100">
                      {d.upcoming_followups.map((f) => (
                        <li key={f.id} className="flex items-center justify-between py-2.5 text-sm">
                          <span>{prettify(f.kind)}</span>
                          {f.status === 'requested' ? <Badge tone="amber">Awaiting scheduling</Badge> : <span className="text-slate-600">{fmtDate(f.scheduled_for, true)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Would you like to talk to someone?" actions={<HandHeart className="h-4 w-4 text-slate-400" aria-hidden />}>
                  <p className="text-sm text-slate-600">You can ask your support worker to get in touch at any time — you do not need to wait for your next check-in.</p>
                  <button className="btn-primary mt-4" onClick={() => setReqOpen(true)}>Request a follow-up</button>
                  <p className="mt-3 text-xs text-slate-500">In an emergency, contact your local emergency services (112 in India). SAATHI is not an emergency service.</p>
                </Card>
              </div>
              <Banner>Your answers are visible only to your authorised support worker. You can review or change your consent choices in <Link className="font-medium underline" to="/app/settings">Settings &amp; privacy</Link>.</Banner>
            </div>
          )
        }}
      </Async>
      {reqOpen && (
        <Modal title="Request a follow-up" onClose={() => setReqOpen(false)}>
          <Field label="Anything you would like to share? (optional)" htmlFor="reason"><textarea id="reason" className="input" rows={3} maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="mt-4 flex justify-end gap-2"><button className="btn-secondary" onClick={() => setReqOpen(false)}>Cancel</button><button className="btn-teal" onClick={requestFollowUp}>Send request</button></div>
        </Modal>
      )}
    </>
  )
}
