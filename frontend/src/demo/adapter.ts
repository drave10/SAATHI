import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { HttpError, handle } from './server'

/** Axios adapter that answers every /api request from the in-browser demo server instead of the network. */
export const demoAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  await new Promise((r) => setTimeout(r, 120))   // small latency so loading states are visible and realistic
  const auth = (config.headers as any)?.get?.('Authorization') ?? (config.headers as any)?.Authorization ?? ''
  const token = String(auth).replace(/^Bearer\s+/i, '') || null
  let body: any = config.data
  if (typeof body === 'string' && body) { try { body = JSON.parse(body) } catch { /* leave as string */ } }
  const make = (status: number, data: unknown): AxiosResponse => ({ data, status, statusText: String(status), headers: {}, config, request: {} })
  try {
    const out = handle(config.method ?? 'get', config.url ?? '', { query: config.params ?? {}, body, token })
    return make(out.status, out.data)
  } catch (e) {
    if (e instanceof HttpError) {
      const data = typeof e.detail === 'string' ? { detail: e.detail, ...(e.errors ? { errors: e.errors } : {}) } : { detail: e.detail }
      throw new AxiosError(String(e.message), 'ERR_BAD_REQUEST', config, {}, make(e.status, data))
    }
    throw new AxiosError('Demo server error: ' + (e as Error).message, 'ERR_BAD_RESPONSE', config, {}, make(500, { detail: 'Internal server error' }))
  }
}
