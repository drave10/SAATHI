import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, HeartHandshake, LineChart, Loader2, LockKeyhole, Settings2, ShieldCheck, TriangleAlert, Users, type LucideIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { loginMode } from '../auth/loginMode'
import { STATIC_DEMO, api, errorMessage } from '../api/client'
import { Banner, Field } from '../components/ui'
import { Logo } from '../components/Layout'
import type { Role } from '../types'

function Hero() {
  return (
    <section className="relative hidden flex-col justify-between overflow-hidden bg-navy-800 p-12 text-navy-100 lg:flex">
      <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-teal-500/10" aria-hidden />
      <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-navy-600/40" aria-hidden />
      <Logo light />
      <div className="relative max-w-lg">
        <p className="text-sm font-medium uppercase tracking-widest text-teal-300">Smart AI-Assisted Trauma and Holistic Intervention</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight text-white">Early, explainable support for people who need to be heard.</h1>
        <p className="mt-4 text-navy-200">SAATHI helps authorised support workers notice changes in self-reported well-being and prioritise human follow-up — with transparent reasoning and privacy built in.</p>
        <ul className="mt-8 space-y-4 text-sm">
          {([[HeartHandshake, 'Gentle, non-stigmatising check-ins for beneficiaries'], [LineChart, 'Longitudinal monitoring with explainable review priorities'], [Users, 'Case management: follow-ups, interventions and notes'], [LockKeyhole, 'Role-based access, consent controls and audit logging']] as [LucideIcon, string][]).map(([Icon, t], i) => (
            <li key={i} className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-700"><Icon className="h-4 w-4 text-teal-300" aria-hidden /></span>{t}</li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs text-navy-300">SIH26094 · Ministry of Social Justice and Empowerment · Prototype with synthetic data</p>
    </section>
  )
}

const SAFETY_NOTE = 'SAATHI is a decision-support prototype and does not diagnose any condition. If you are in immediate danger, contact your local emergency number (112 in India).'

const ROLES: { role: Role; title: string; icon: LucideIcon; text: string }[] = [
  { role: 'beneficiary', title: 'Beneficiary', icon: ClipboardList, text: 'Complete a well-being check-in, see your trends and request a follow-up.' },
  { role: 'caseworker', title: 'Caseworker', icon: Users, text: 'Review a caseload, see why a review priority was suggested, add notes, follow-ups and interventions.' },
  { role: 'admin', title: 'Admin', icon: Settings2, text: 'See aggregated analytics; manage users, resources, engine settings and the audit log.' },
]

/** Errors that mean "the server is not ready yet" (asleep, or the host proxy timed out) rather than "you are not allowed". */
const isWakingUp = (e: any) => !e?.response || [502, 503, 504].includes(e.response.status)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Demo-only sign-in: three role buttons, no username or password. Retries while a sleeping free-tier server wakes up. */
export function DemoLogin({ retryDelayMs = 3000, maxAttempts = 6 }: { retryDelayMs?: number; maxAttempts?: number } = {}) {
  const { demoLogin } = useAuth()
  const nav = useNavigate()
  const [busy, setBusy] = useState<Role | null>(null)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Wake a sleeping demo server in the background while the visitor reads the page.
  useEffect(() => { api.get('/auth/config', { timeout: 90000 }).catch(() => undefined) }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function enter(role: Role) {
    if (busy) return
    setBusy(role); setError(null); setSlow(false)
    timer.current = setTimeout(() => setSlow(true), 4000)
    try {
      for (let attempt = 1; ; attempt++) {
        try { await demoLogin(role); break }
        catch (e) { if (attempt >= maxAttempts || !isWakingUp(e)) throw e; await sleep(retryDelayMs) }
      }
      nav('/app')
    }
    catch (err) { setError(errorMessage(err)) }
    finally { if (timer.current) clearTimeout(timer.current); setBusy(null); setSlow(false) }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <Hero />
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-2xl font-semibold">Try the SAATHI demo</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a role to explore the prototype. No username or password is needed.</p>

          <div role="note" className="mt-5 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p><strong>Demo prototype.</strong> Everything here is synthetic sample data. Please do not enter real personal information.</p>
          </div>

          {error && <div className="mt-5"><Banner kind="error">{error}</Banner></div>}

          <div className="mt-5 space-y-3" role="group" aria-label="Choose a role">
            {ROLES.map(({ role, title, icon: Icon, text }) => (
              <button key={role} type="button" aria-label={title} aria-describedby={`desc-${role}`} disabled={busy !== null} onClick={() => enter(role)}
                className="group flex w-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-card transition hover:border-teal-400 hover:bg-teal-50/40 focus-visible:border-teal-500 disabled:cursor-not-allowed disabled:opacity-60">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-navy-700 text-white group-hover:bg-teal-600">
                  {busy === role ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
                </span>
                <span>
                  <span className="block text-base font-semibold text-navy-800" aria-hidden>{title}</span>
                  <span id={`desc-${role}`} className="mt-0.5 block text-sm text-slate-600">{text}</span>
                </span>
              </button>
            ))}
          </div>

          {busy && (
            <p role="status" className="mt-4 text-sm text-slate-600">
              Opening the {ROLES.find((r) => r.role === busy)!.title.toLowerCase()} view…{slow && ' The demo server may be waking up, so the first visit can take up to a minute. Thank you for waiting.'}
            </p>
          )}
          {STATIC_DEMO && !busy && <p className="mt-4 text-xs text-slate-500">This build runs entirely in your browser. Nothing you do leaves your device.</p>}

          <div className="mt-8 flex gap-3 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" aria-hidden />
            <p>{SAFETY_NOTE}</p>
          </div>
        </div>
      </section>
    </div>
  )
}

/** Normal sign-in (username + password) and invitation-code registration, for real deployments. */
function FullLogin() {
  const { login, register, demoLogin } = useAuth()
  const [demo, setDemo] = useState(false)
  useEffect(() => { api.get('/auth/config').then((r) => setDemo(!!r.data.demo_mode)).catch(() => setDemo(false)) }, [])
  async function enterDemo(role: 'beneficiary' | 'caseworker' | 'admin') {
    setBusy(true); setError(null)
    try { await demoLogin(role); nav('/app') } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  const nav = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [f, setF] = useState({ username: '', password: '', invite_code: '', display_name: '', consent_privacy: false, consent_assessment: false, consent_analytics: false })
  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      if (mode === 'login') await login(f.username.trim(), f.password)
      else await register({ ...f, username: f.username.trim(), invite_code: f.invite_code.trim() })
      nav('/app')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <Hero />
      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h2 className="text-2xl font-semibold">{mode === 'login' ? 'Sign in to SAATHI' : 'Create your account'}</h2>
          <p className="mt-1 text-sm text-slate-500">{mode === 'login' ? 'Use the account provided by your support organisation.' : 'You need an invitation code from your support worker.'}</p>
          {demo && (
            <section aria-label="Demo access" className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-4">
              <h3 className="text-sm font-semibold text-teal-900">Demo mode: no password needed</h3>
              <p className="mt-1 text-xs text-teal-800">Explore SAATHI with synthetic sample data. Pick a role:</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <button type="button" className="btn-secondary flex-col gap-1 py-3" disabled={busy} onClick={() => enterDemo('beneficiary')}><ClipboardList className="h-4 w-4" aria-hidden />Beneficiary</button>
                <button type="button" className="btn-secondary flex-col gap-1 py-3" disabled={busy} onClick={() => enterDemo('caseworker')}><Users className="h-4 w-4" aria-hidden />Caseworker</button>
                <button type="button" className="btn-secondary flex-col gap-1 py-3" disabled={busy} onClick={() => enterDemo('admin')}><Settings2 className="h-4 w-4" aria-hidden />Admin</button>
              </div>
            </section>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4" aria-label={mode === 'login' ? 'Sign in form' : 'Registration form'}>
            {error && <Banner kind="error">{error}</Banner>}
            {mode === 'register' && (
              <>
                <Field label="Invitation code" htmlFor="invite"><input id="invite" className="input" required value={f.invite_code} onChange={(e) => set('invite_code', e.target.value)} autoComplete="off" /></Field>
                <Field label="Name to display" htmlFor="dname" hint="A first name or nickname is enough — you don't need to use your real name."><input id="dname" className="input" required maxLength={120} value={f.display_name} onChange={(e) => set('display_name', e.target.value)} /></Field>
              </>
            )}
            <Field label="Username" htmlFor="username"><input id="username" className="input" required value={f.username} onChange={(e) => set('username', e.target.value)} autoComplete="username" /></Field>
            <Field label="Password" htmlFor="password" hint={mode === 'register' ? 'At least 8 characters, mixing letters with numbers or symbols.' : undefined}>
              <input id="password" type="password" className="input" required value={f.password} onChange={(e) => set('password', e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </Field>
            {mode === 'register' && (
              <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Consent</legend>
                <label className="flex gap-2"><input type="checkbox" className="mt-1" checked={f.consent_privacy} onChange={(e) => set('consent_privacy', e.target.checked)} /> I have read the privacy notice (in Settings &amp; privacy after sign-in) and understand who can see my information. <span className="text-red-600">*</span></label>
                <label className="flex gap-2"><input type="checkbox" className="mt-1" checked={f.consent_assessment} onChange={(e) => set('consent_assessment', e.target.checked)} /> I agree to my check-in answers being stored and reviewed by my authorised support worker. <span className="text-red-600">*</span></label>
                <label className="flex gap-2"><input type="checkbox" className="mt-1" checked={f.consent_analytics} onChange={(e) => set('consent_analytics', e.target.checked)} /> Optional: include my anonymised results in aggregate statistics.</label>
              </fieldset>
            )}
            <button className="btn-primary w-full" disabled={busy || (mode === 'register' && !(f.consent_privacy && f.consent_assessment))}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          </form>
          <button className="mt-4 text-sm font-medium text-teal-700 hover:underline" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null) }}>
            {mode === 'login' ? 'I have an invitation code' : 'Back to sign in'}
          </button>
          <div className="mt-8 flex gap-3 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" aria-hidden />
            <p>{SAFETY_NOTE}</p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default function Login() {
  return loginMode() === 'full' ? <FullLogin /> : <DemoLogin />
}
