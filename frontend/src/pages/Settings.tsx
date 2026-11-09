import { useState } from 'react'
import { Download, ShieldCheck, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Async, Badge, Banner, Card, Field, PageHeader, fmtDate, useFetch, useToast } from '../components/ui'

const CONSENTS = [
  { k: 'assessment_data', label: 'Store and review my check-in answers', hint: 'Needed to use check-ins. Withdrawing means you should stop doing new check-ins; ask your support worker about erasing existing data.', locked: true },
  { k: 'analytics_use', label: 'Include my anonymised results in aggregate statistics', hint: 'Used for organisation-level reporting only. Small groups are hidden so you cannot be identified.' },
] as const

export default function Settings() {
  const { user, logout } = useAuth()
  const isBen = user?.role === 'beneficiary'
  const toast = useToast()
  const consent = useFetch(() => (isBen ? api.get('/me/consents').then((r) => r.data) : Promise.resolve(null)), [isBen])
  const [pw, setPw] = useState({ current_password: '', new_password: '' })

  async function toggle(type: string, granted: boolean) { try { await api.post('/me/consents', { consent_type: type, granted }); toast.ok('Preference saved.'); consent.reload() } catch (e) { toast.fail(e) } }
  async function changePw() {
    try { await api.post('/auth/change-password', pw); toast.ok('Password changed. Please sign in again.'); setTimeout(() => logout(), 1200) } catch (e) { toast.fail(e) }
  }
  async function exportData() {
    try {
      const r = await api.get('/me/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = 'my-saathi-data.json'; a.click(); URL.revokeObjectURL(url); toast.ok('Your data export has been downloaded.')
    } catch (e) { toast.fail(e) }
  }
  async function requestDelete() {
    if (!confirm('Ask for all of your data to be permanently erased? An administrator will review and carry this out.')) return
    try { await api.post('/me/deletion-request'); toast.ok('Deletion request sent.'); consent.reload() } catch (e) { toast.fail(e) }
  }

  return (
    <>
      <PageHeader title={isBen ? 'Settings & privacy' : 'Settings'} subtitle="Your account, password and privacy choices." />
      {toast.node}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-3 gap-y-2 text-sm"><dt className="text-slate-500">Name</dt><dd className="col-span-2">{user?.display_name}</dd><dt className="text-slate-500">Username</dt><dd className="col-span-2 font-mono text-xs">{user?.username}</dd><dt className="text-slate-500">Role</dt><dd className="col-span-2 capitalize">{user?.role}</dd></dl>
          <form className="mt-6 space-y-3 border-t border-slate-100 pt-4" onSubmit={(e) => { e.preventDefault(); changePw() }}>
            <h3 className="text-sm font-semibold">Change password</h3>
            <Field label="Current password" htmlFor="cp"><input id="cp" type="password" required className="input" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password" htmlFor="np" hint="At least 8 characters, mixing letters with numbers or symbols."><input id="np" type="password" required minLength={8} className="input" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <button className="btn-primary">Update password</button>
          </form>
        </Card>

        <Card title="Privacy notice (v1.0)" actions={<ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />}>
          <div className="space-y-3 text-sm text-slate-700">
            <p><strong>What we collect:</strong> a pseudonymous case code, your check-in answers, follow-up and support records, and your consent choices. We do not collect names, addresses or phone numbers in this prototype.</p>
            <p><strong>Who can see it:</strong> your authorised support worker sees your answers. Administrators see only anonymised, aggregate statistics and cannot open individual answers. Access to your record is written to an audit log.</p>
            <p><strong>How it is used:</strong> to help your support worker notice changes and follow up with you. A person always reviews any concern the system flags. The system does not diagnose conditions and does not contact anyone outside your support team automatically.</p>
            <p><strong>Your rights:</strong> you can change optional consents, download your data, or ask for it to be erased.</p>
            <p className="text-xs text-slate-500">Prototype notice for demonstration; replace with your organisation's legally reviewed notice before real-world use.</p>
          </div>
        </Card>

        {isBen && (
          <Card title="Consent preferences" className="lg:col-span-2">
            <Async state={consent}>{(c: any) => (
              <div className="space-y-4">
                {c.deletion_requested_at && <Banner kind="warn">You asked for your data to be erased on {fmtDate(c.deletion_requested_at)}. An administrator will complete this.</Banner>}
                {CONSENTS.map((x) => (
                  <label key={x.k} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 p-4"><span><span className="font-medium">{x.label}</span><span className="mt-0.5 block text-sm text-slate-500">{x.hint}</span></span>
                    <input type="checkbox" role="switch" className="mt-1 h-5 w-5 accent-teal-600" checked={!!c.current[x.k]} disabled={'locked' in x && x.locked} onChange={(e) => toggle(x.k, e.target.checked)} aria-label={x.label} /></label>
                ))}
                <div className="flex flex-wrap gap-3 pt-2"><button className="btn-secondary" onClick={exportData}><Download className="h-4 w-4" aria-hidden />Download my data</button><button className="btn-danger" onClick={requestDelete} disabled={!!c.deletion_requested_at}><Trash2 className="h-4 w-4" aria-hidden />Request data deletion</button></div>
                <details className="text-sm"><summary className="cursor-pointer font-medium text-slate-700">Consent history</summary>
                  <ul className="mt-2 space-y-1 text-slate-600">{c.history.map((h: any) => <li key={h.id}>{fmtDate(h.created_at, true)} — {h.consent_type.replace(/_/g, ' ')}: <Badge tone={h.granted ? 'teal' : 'slate'}>{h.granted ? 'granted' : 'withdrawn'}</Badge></li>)}</ul></details>
              </div>)}</Async>
          </Card>
        )}
      </div>
    </>
  )
}
