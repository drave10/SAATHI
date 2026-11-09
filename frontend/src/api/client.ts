import axios, { AxiosError } from 'axios'

const TOKEN_KEY = 'saathi.token'

export const tokenStore = {
  get(): string | null { try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null } },
  set(t: string) { try { sessionStorage.setItem(TOKEN_KEY, t) } catch { /* ignore */ } },
  clear() { try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } },
}

export const api = axios.create({ baseURL: '/api', timeout: 20000 })

api.interceptors.request.use((cfg) => {
  const t = tokenStore.get()
  if (t) cfg.headers.Authorization = `Bearer ${t}`
  return cfg
})

let onUnauthorized: (() => void) | null = null
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    const isLogin = err.config?.url?.includes('/auth/login')
    if (err.response?.status === 401 && !isLogin) onUnauthorized?.()
    return Promise.reject(err)
  },
)

/** Turn any API error into a short human-readable message. */
export function errorMessage(e: unknown): string {
  const err = e as AxiosError<any>
  if (!err.response) return 'Cannot reach the server. Please check your connection and try again.'
  const d = err.response.data?.detail
  if (typeof d === 'string') {
    const first = err.response.data?.errors?.[0]
    return first ? `${first.field ? first.field + ': ' : ''}${first.message}` : d
  }
  if (d?.message) return d.message + (d.errors ? ': ' + Object.values(d.errors).join('; ') : '')
  if (Array.isArray(d)) return d.map((x) => x.msg).join('; ')
  return `Request failed (${err.response.status})`
}
