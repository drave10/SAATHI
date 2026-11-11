import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '../api/client'
import type { Role, User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<User>
  register: (body: Record<string, unknown>) => Promise<User>
  demoLogin: (role: Role) => Promise<User>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!tokenStore.get())

  useEffect(() => {
    setUnauthorizedHandler(() => { tokenStore.clear(); setUser(null) })
    if (!tokenStore.get()) return
    api.get<User>('/auth/me').then((r) => setUser(r.data)).catch(() => tokenStore.clear()).finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const r = await api.post('/auth/login', { username, password })
    tokenStore.set(r.data.access_token); setUser(r.data.user)
    return r.data.user as User
  }, [])

  const register = useCallback(async (body: Record<string, unknown>) => {
    const r = await api.post('/auth/register', body)
    tokenStore.set(r.data.access_token); setUser(r.data.user)
    return r.data.user as User
  }, [])

  const demoLogin = useCallback(async (role: Role) => {
    const r = await api.post('/auth/demo-login', { role }, { timeout: 90000 })   // a sleeping free-tier server can take up to a minute
    tokenStore.set(r.data.access_token); setUser(r.data.user)
    return r.data.user as User
  }, [])

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout') } catch { /* token may already be invalid */ }
    tokenStore.clear(); setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, register, demoLogin, logout }), [user, loading, login, register, demoLogin, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used inside AuthProvider')
  return c
}
