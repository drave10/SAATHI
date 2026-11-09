import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { api } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { Async, Badge, Card, EmptyState, Field, Modal, Pagination, PageHeader, fmtDate, useFetch, useToast } from '../../components/ui'
import type { Page, User } from '../../types'

export default function UserManagement() {
  const { user: me } = useAuth()
  const [f, setF] = useState({ q: '', role: '', page: 1 })
  const state = useFetch(() => api.get<Page<User>>('/admin/users', { params: { page: f.page, page_size: 12, ...(f.q ? { q: f.q } : {}), ...(f.role ? { role: f.role } : {}) } }).then((r) => r.data), [f.q, f.role, f.page])
  const units = useFetch(() => api.get<string[]>('/admin/org-units').then((r) => r.data))
  const toast = useToast()
  const [create, setCreate] = useState(false)
  const [nu, setNu] = useState({ username: '', display_name: '', password: '', role: 'caseworker', org_unit: '' })
  const [edit, setEdit] = useState<User | null>(null)
  const [pw, setPw] = useState('')

  async function run(fn: () => Promise<unknown>, ok: string) { try { await fn(); toast.ok(ok); setCreate(false); setEdit(null); setPw(''); state.reload() } catch (e) { toast.fail(e) } }

  return (
    <>
      <PageHeader title="User management" subtitle="Create staff accounts, change roles, deactivate access. Beneficiaries onboard via invitation codes." actions={<button className="btn-primary" onClick={() => setCreate(true)}><Plus className="h-4 w-4" aria-hidden />New staff user</button>} />
      {toast.node}
      <Card pad={false}>
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-3">
          <div className="relative sm:col-span-2"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden /><input className="input pl-9" aria-label="Search users" placeholder="Search username or name" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })} /></div>
          <select className="input" aria-label="Filter by role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, page: 1 })}><option value="">All roles</option><option value="admin">Admin</option><option value="caseworker">Caseworker</option><option value="beneficiary">Beneficiary</option></select>
        </div>
        <Async state={state}>{(p) => p.items.length === 0 ? <EmptyState title="No users found" /> : (
          <>
            <div className="overflow-x-auto"><table className="w-full"><thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Username</th><th className="th">Name</th><th className="th">Role</th><th className="th">Status</th><th className="th">Last sign-in</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody className="divide-y divide-slate-100">{p.items.map((u) => (
                <tr key={u.id}><td className="td font-mono text-xs">{u.username}</td><td className="td">{u.display_name}</td><td className="td"><Badge tone={u.role === 'admin' ? 'navy' : u.role === 'caseworker' ? 'teal' : 'slate'}>{u.role}</Badge></td>
                  <td className="td">{u.is_active ? <Badge tone="teal">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</td><td className="td">{fmtDate(u.last_login_at)}</td>
                  <td className="td text-right"><button className="btn-secondary py-1" onClick={() => setEdit(u)}>Manage</button></td></tr>))}</tbody></table></div>
            <Pagination page={p.page} pageSize={p.page_size} total={p.total} onChange={(n) => setF({ ...f, page: n })} />
          </>)}</Async>
      </Card>

      {create && <Modal title="New staff user" onClose={() => setCreate(false)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api.post('/admin/users', nu), 'User created.') }}>
          <Field label="Username" htmlFor="n_u"><input id="n_u" required minLength={3} className="input" value={nu.username} onChange={(e) => setNu({ ...nu, username: e.target.value })} /></Field>
          <Field label="Display name" htmlFor="n_d"><input id="n_d" required className="input" value={nu.display_name} onChange={(e) => setNu({ ...nu, display_name: e.target.value })} /></Field>
          <Field label="Temporary password" htmlFor="n_p" hint="At least 8 characters, mixing letters and numbers/symbols."><input id="n_p" type="password" required minLength={8} className="input" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} autoComplete="new-password" /></Field>
          <Field label="Role" htmlFor="n_r"><select id="n_r" className="input" value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}><option value="caseworker">Caseworker</option><option value="admin">Administrator</option></select></Field>
          {nu.role === 'caseworker' && <Field label="Organisational unit" htmlFor="n_o" hint="Pick an existing unit or type a new one."><input id="n_o" list="org-units-u" className="input" value={nu.org_unit} onChange={(e) => setNu({ ...nu, org_unit: e.target.value })} /><datalist id="org-units-u">{(units.data ?? []).map((x) => <option key={x} value={x} />)}</datalist></Field>}
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCreate(false)}>Cancel</button><button className="btn-primary">Create user</button></div>
        </form></Modal>}

      {edit && <Modal title={`Manage ${edit.username}`} onClose={() => setEdit(null)}>
        <div className="space-y-4">
          {edit.role !== 'beneficiary' && <Field label="Role" htmlFor="e_r"><select id="e_r" className="input" disabled={edit.id === me?.id} value={edit.role} onChange={(e) => run(() => api.patch(`/admin/users/${edit.id}`, { role: e.target.value }), 'Role updated.')}><option value="caseworker">Caseworker</option><option value="admin">Administrator</option></select></Field>}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm"><span>Account is <strong>{edit.is_active ? 'active' : 'deactivated'}</strong></span>
            <button className={edit.is_active ? 'btn-danger py-1' : 'btn-teal py-1'} disabled={edit.id === me?.id} onClick={() => run(() => api.patch(`/admin/users/${edit.id}`, { is_active: !edit.is_active }), edit.is_active ? 'User deactivated and signed out.' : 'User reactivated.')}>{edit.is_active ? 'Deactivate' : 'Reactivate'}</button></div>
          <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api.patch(`/admin/users/${edit.id}`, { new_password: pw }), 'Password reset; the user was signed out.') }}>
            <div className="flex-1"><Field label="Reset password" htmlFor="e_p"><input id="e_p" type="password" minLength={8} className="input" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field></div><button className="btn-secondary" disabled={pw.length < 8}>Reset</button></form>
          {edit.id === me?.id && <p className="text-xs text-slate-500">You cannot deactivate or demote your own account.</p>}
        </div></Modal>}
    </>
  )
}
