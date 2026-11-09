import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, X } from 'lucide-react'
import { errorMessage } from '../api/client'
import type { Level } from '../types'

/* ---------- data fetching hook with loading / error state ---------- */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const run = useCallback(() => {
    setLoading(true); setError(null)
    return fnRef.current().then(setData).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false))
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, deps)
  return { data, loading, error, reload: run, setData }
}

/* ---------- status blocks ---------- */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center">
      <AlertTriangle className="h-6 w-6 text-red-600" aria-hidden />
      <p className="text-sm text-red-800">{message}</p>
      {onRetry && <button className="btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-slate-300" aria-hidden />
      <p className="font-medium text-slate-700">{title}</p>
      {hint && <p className="max-w-md text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  )
}

export function Async<T>({ state, children }: { state: ReturnType<typeof useFetch<T>>; children: (d: T) => ReactNode }) {
  if (state.loading && !state.data) return <Spinner />
  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.reload} />
  if (!state.data) return null
  return <>{children(state.data)}</>
}

export function Banner({ kind = 'info', children }: { kind?: 'info' | 'success' | 'error' | 'warn'; children: ReactNode }) {
  const styles = {
    info: 'border-navy-100 bg-navy-50 text-navy-800', success: 'border-teal-200 bg-teal-50 text-teal-900',
    error: 'border-red-200 bg-red-50 text-red-800', warn: 'border-amber-200 bg-amber-50 text-amber-900',
  }[kind]
  const Icon = kind === 'success' ? CheckCircle2 : AlertTriangle
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border p-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <div>{children}</div>
    </div>
  )
}

/* ---------- layout primitives ---------- */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, actions, children, className = '', pad = true }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-navy-800">{title}</h2>{actions}
        </header>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, tone = 'default', icon }: { label: string; value: ReactNode; hint?: string; tone?: 'default' | 'urgent' | 'attention' | 'good'; icon?: ReactNode }) {
  const ring = { default: '', urgent: 'ring-1 ring-red-200', attention: 'ring-1 ring-amber-200', good: 'ring-1 ring-teal-200' }[tone]
  const val = { default: 'text-navy-800', urgent: 'text-red-700', attention: 'text-amber-700', good: 'text-teal-700' }[tone]
  return (
    <div className={`card p-4 ${ring}`}>
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">{label}{icon}</div>
      <div className={`mt-2 text-3xl font-semibold ${val}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

/* ---------- badges ---------- */
export const LEVEL_TEXT: Record<Level, string> = { routine: 'Routine', attention: 'Attention', urgent: 'Urgent review' }

export function PriorityBadge({ level }: { level: Level | null | undefined }) {
  if (!level) return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">No check-in yet</span>
  const s = {
    routine: 'bg-teal-50 text-teal-800 ring-teal-200', attention: 'bg-amber-50 text-amber-800 ring-amber-200', urgent: 'bg-red-50 text-red-800 ring-red-200',
  }[level]
  const dot = { routine: 'bg-teal-500', attention: 'bg-amber-500', urgent: 'bg-red-500' }[level]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden /> {LEVEL_TEXT[level]}
    </span>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'teal' | 'navy' | 'amber' | 'red' }) {
  const t = { slate: 'bg-slate-100 text-slate-700', teal: 'bg-teal-50 text-teal-800', navy: 'bg-navy-50 text-navy-700', amber: 'bg-amber-50 text-amber-800', red: 'bg-red-50 text-red-800' }[tone]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>
}

export const prettify = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/* ---------- forms ---------- */
export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-900/50 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="card max-h-[90vh] w-full max-w-lg overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="font-semibold text-navy-800">{title}</h2>
          <button className="btn-ghost p-1" onClick={onClose} aria-label="Close dialog"><X className="h-4 w-4" /></button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
      <span>{total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost p-1.5" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2">Page {page} / {pages}</span>
        <button className="btn-ghost p-1.5" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </nav>
  )
}

export function fmtDate(s?: string | null, withTime = false) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('en-IN', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

export function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function useToast() {
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 5000); return () => clearTimeout(t) } }, [msg])
  const node = msg ? <div className="mb-4"><Banner kind={msg.kind}>{msg.text}</Banner></div> : null
  return { node, ok: (text: string) => setMsg({ kind: 'success', text }), fail: (e: unknown) => setMsg({ kind: 'error', text: errorMessage(e) }) }
}
