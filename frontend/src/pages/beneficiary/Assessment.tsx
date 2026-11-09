import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, LifeBuoy, Phone } from 'lucide-react'
import { api, errorMessage } from '../../api/client'
import { Banner, Card, PageHeader, Spinner, ErrorState } from '../../components/ui'
import { DIMENSION_LABELS, type Question, type Questionnaire } from '../../types'

type Answers = Record<string, number | string>
interface Result { wellbeing_index: number | null; show_support_now: boolean; message: string; support_resources: { id: number; title: string; summary: string; contact: string | null; is_verified: boolean }[] }

export default function Assessment() {
  const [q, setQ] = useState<Questionnaire | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [id, setId] = useState<number | null>(null)
  const [answers, setAnswers] = useState<Answers>({})
  const [consent, setConsent] = useState(false)
  const [step, setStep] = useState(-1)  // -1 = consent screen
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [resumed, setResumed] = useState(false)

  useEffect(() => {
    Promise.all([api.get<Questionnaire>('/assessments/questionnaire'), api.get('/assessments/draft')])
      .then(([qr, dr]) => {
        setQ(qr.data)
        const d = dr.data.draft
        if (d) { setId(d.id); setAnswers(d.answers); setConsent(true); setResumed(true); setStep(0) }
      }).catch((e) => setLoadErr(errorMessage(e)))
  }, [])

  const sections = useMemo(() => {
    if (!q) return []
    const order: string[] = []
    const groups: Record<string, Question[]> = {}
    q.items.forEach((it) => {
      const key = ['change', 'support_request', 'free_text'].includes(it.dimension) ? 'final' : it.dimension
      if (!groups[key]) { groups[key] = []; order.push(key) }
      groups[key].push(it)
    })
    return order.map((k) => ({ key: k, title: k === 'final' ? 'A few last questions' : DIMENSION_LABELS[k] ?? k, items: groups[k] }))
  }, [q])

  const set = (qid: string, v: number | string) => setAnswers((a) => ({ ...a, [qid]: v }))

  async function ensureDraft(): Promise<number> {
    if (id) return id
    const r = await api.post('/assessments', { consent_confirmed: true })
    setId(r.data.id); return r.data.id
  }
  async function save(aid: number) { await api.put(`/assessments/${aid}/responses`, { answers }) }

  async function begin() {
    setBusy(true); setError(null)
    try { await ensureDraft(); setStep(0) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function next() {
    setBusy(true); setError(null)
    try { const aid = await ensureDraft(); await save(aid); setStep((s) => s + 1); window.scrollTo({ top: 0 }) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function saveExit() {
    setBusy(true); setError(null)
    try { const aid = await ensureDraft(); await save(aid); setSavedMsg('Progress saved. You can resume this check-in any time from your dashboard.') } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  async function submit() {
    setBusy(true); setError(null)
    try { const aid = await ensureDraft(); await save(aid); const r = await api.post<Result>(`/assessments/${aid}/submit`); setResult(r.data) }
    catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }

  if (loadErr) return <ErrorState message={loadErr} />
  if (!q) return <Spinner />

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-teal-600" aria-hidden />
          <h1 className="mt-4 text-2xl font-semibold">Thank you for checking in</h1>
          <p className="mt-2 text-slate-600">{result.message}</p>
          {result.wellbeing_index != null && <p className="mt-4 text-sm text-slate-500">Your well-being score for this check-in: <strong className="text-navy-800">{result.wellbeing_index}</strong> / 100 (higher is better)</p>}
        </div>
        {result.show_support_now && (
          <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-6">
            <div className="flex items-center gap-2 text-red-800"><LifeBuoy className="h-5 w-5" aria-hidden /><h2 className="text-lg font-semibold !text-red-800">Support is available right now</h2></div>
            <p className="mt-2 text-sm text-red-900">Some of your answers suggest you may be going through a very hard time. Please consider speaking to someone today — your support worker has been notified to follow up, but you do not have to wait. If you are in danger, contact emergency services immediately.</p>
            <ul className="mt-4 space-y-2">
              {result.support_resources.map((r) => (
                <li key={r.id} className="flex items-start gap-3 rounded-lg bg-white p-3 text-sm">
                  <Phone className="mt-0.5 h-4 w-4 text-red-600" aria-hidden />
                  <div><div className="font-medium">{r.title} {r.contact && <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 font-mono text-red-800">{r.contact}</span>}</div><div className="text-slate-600">{r.summary}</div>{!r.is_verified && <div className="mt-1 text-xs text-amber-700">Contact details pending verification by your administrator.</div>}</div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-red-900">This message is shown by the application; it is not an automated crisis service.</p>
          </div>
        )}
        <div className="flex justify-center gap-3"><Link className="btn-primary" to="/app">Back to dashboard</Link><Link className="btn-secondary" to="/app/resources">Support resources</Link></div>
      </div>
    )
  }

  if (savedMsg) return <div className="mx-auto max-w-xl"><Card><Banner kind="success">{savedMsg}</Banner><Link className="btn-primary mt-4" to="/app">Back to dashboard</Link></Card></div>

  if (step === -1) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title={q.title} subtitle={`Prototype questionnaire ${q.version} — not a clinically validated instrument`} />
        <Card>
          <p className="text-slate-700">{q.disclaimer}</p>
          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>There are no right or wrong answers. Answer based on the last two weeks.</li>
            <li>You can skip the optional text box and pause at any time — your progress is saved.</li>
            <li>Your answers are seen only by your authorised support worker.</li>
          </ul>
          <label className="mt-6 flex gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>I understand what this check-in is for, and I agree to my answers being stored and reviewed by my support worker. <strong>(required)</strong></span>
          </label>
          {error && <div className="mt-4"><Banner kind="error">{error}</Banner></div>}
          <button className="btn-teal mt-6" disabled={!consent || busy} onClick={begin}>{busy ? 'Starting…' : 'Begin check-in'}</button>
        </Card>
      </div>
    )
  }

  const sec = sections[step]
  const last = step === sections.length - 1
  const sectionDone = sec.items.every((it) => !it.required || answers[it.id] !== undefined)
  const answered = q.items.filter((i) => i.required && answers[i.id] !== undefined).length
  const total = q.items.filter((i) => i.required).length

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={q.title} subtitle={`Section ${step + 1} of ${sections.length}`} />
      {resumed && step === 0 && <div className="mb-4"><Banner kind="success">Welcome back — your saved answers have been restored.</Banner></div>}
      <div className="mb-6" aria-label="Progress"><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full bg-teal-500 transition-all" style={{ width: `${(answered / total) * 100}%` }} /></div><p className="mt-1 text-xs text-slate-500">{answered} of {total} questions answered</p></div>
      <Card title={sec.title}>
        <div className="space-y-8">
          {sec.items.map((it) => (
            <fieldset key={it.id}>
              <legend className="text-sm font-medium text-slate-800">{it.text}{!it.required && <span className="ml-1 text-slate-400">(optional)</span>}</legend>
              {it.help && <p className="mt-1 text-xs text-slate-500">{it.help}</p>}
              {it.type === 'likert' ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {it.options.map((o) => {
                    const sel = answers[it.id] === o.value
                    return (
                      <label key={o.value} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${sel ? 'border-teal-500 bg-teal-50 text-teal-900' : 'border-slate-200 hover:bg-slate-50'}`}>
                        <input type="radio" name={it.id} className="accent-teal-600" checked={sel} onChange={() => set(it.id, o.value)} /> {o.label}
                      </label>
                    )
                  })}
                </div>
              ) : (
                <textarea className="input mt-3" rows={4} maxLength={2000} aria-label={it.text} value={(answers[it.id] as string) ?? ''} onChange={(e) => set(it.id, e.target.value)} />
              )}
            </fieldset>
          ))}
        </div>
        {error && <div className="mt-6"><Banner kind="error">{error}</Banner></div>}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</button>
            <button className="btn-ghost" disabled={busy} onClick={saveExit}>Save &amp; finish later</button>
          </div>
          {last ? <button className="btn-teal" disabled={busy || !sectionDone} onClick={submit}>{busy ? 'Submitting…' : 'Submit check-in'}</button>
            : <button className="btn-teal" disabled={busy || !sectionDone} onClick={next}>Next</button>}
        </div>
      </Card>
    </div>
  )
}
