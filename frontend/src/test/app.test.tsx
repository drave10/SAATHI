import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { api, errorMessage } from '../api/client'
import { Pagination, PriorityBadge, EmptyState } from '../components/ui'
import Login, { DemoLogin } from '../pages/Login'

const wrap = (ui: JSX.Element) => render(<MemoryRouter><AuthProvider>{ui}</AuthProvider></MemoryRouter>)

describe('review priority badge', () => {
  it('uses non-diagnostic wording', () => {
    const { rerender } = render(<PriorityBadge level="urgent" />)
    expect(screen.getByText('Urgent review')).toBeInTheDocument()
    rerender(<PriorityBadge level="attention" />)
    expect(screen.getByText('Attention')).toBeInTheDocument()
    rerender(<PriorityBadge level="routine" />)
    expect(screen.getByText('Routine')).toBeInTheDocument()
    rerender(<PriorityBadge level={null} />)
    expect(screen.getByText('No check-in yet')).toBeInTheDocument()
  })
})

describe('pagination', () => {
  it('shows range and disables boundaries', () => {
    const onChange = vi.fn()
    render(<Pagination page={1} pageSize={10} total={25} onChange={onChange} />)
    expect(screen.getByText('1–10 of 25')).toBeInTheDocument()
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(onChange).toHaveBeenCalledWith(2)
  })
})

describe('empty state', () => {
  it('renders title and hint', () => {
    render(<EmptyState title="Nothing here" hint="Try again later" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})

describe('errorMessage', () => {
  it('handles network errors and API details', () => {
    expect(errorMessage({ response: undefined })).toMatch(/Cannot reach the server/)
    expect(errorMessage({ response: { status: 401, data: { detail: 'Incorrect username or password' } } })).toBe('Incorrect username or password')
    expect(errorMessage({ response: { status: 422, data: { detail: { message: 'Please answer all required questions' } } } })).toMatch(/required questions/)
  })
})

describe('demo-only login page (the default)', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(api, 'get').mockResolvedValue({ data: { demo_mode: true } } as any) })

  it('offers exactly the three roles: no username, no password, no registration', () => {
    wrap(<Login />)
    for (const n of ['Beneficiary', 'Caseworker', 'Admin']) expect(screen.getByRole('button', { name: n })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByText(/invitation code/i)).not.toBeInTheDocument()
    expect(screen.getByText(/No username or password is needed/)).toBeInTheDocument()
  })

  it('says clearly that it is a demo prototype with synthetic data, and is not diagnostic', () => {
    wrap(<Login />)
    expect(screen.getByRole('note')).toHaveTextContent(/Demo prototype/)
    expect(screen.getByRole('note')).toHaveTextContent(/synthetic sample data/)
    expect(screen.getByText(/does not diagnose any condition/)).toBeInTheDocument()
  })

  it('signs in through the demo-login endpoint and opens the app', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({ data: { access_token: 't', token_type: 'bearer', user: { id: 1, username: 'admin', display_name: 'Demo Administrator', role: 'admin', is_active: true, is_synthetic: true, created_at: '', last_login_at: null } } } as any)
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><Routes><Route path="/" element={<Login />} /><Route path="/app" element={<div>APP HOME</div>} /></Routes></AuthProvider></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeInTheDocument())
    expect(post).toHaveBeenCalledWith('/auth/demo-login', { role: 'admin' }, { timeout: 90000 })
  })

  it('shows progress while signing in, then a readable error (and re-enables the buttons) if the server fails', async () => {
    let fail!: (e: unknown) => void
    vi.spyOn(api, 'post').mockReturnValueOnce(new Promise((_r, rej) => { fail = rej }) as any)
    wrap(<Login />)
    fireEvent.click(screen.getByRole('button', { name: 'Caseworker' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Opening the caseworker view/)
    expect(screen.getByRole('button', { name: 'Admin' })).toBeDisabled()
    fail({ response: { status: 404, data: { detail: 'Demo account is not available' } } })
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Demo account is not available'))
    expect(screen.getByRole('button', { name: 'Admin' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps retrying while the server wakes up, then signs in', async () => {
    const user = { id: 1, username: 'ben001', display_name: 'Debashish', role: 'beneficiary', is_active: true, is_synthetic: true, created_at: '', last_login_at: null }
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce({ response: { status: 504, data: {} } })
      .mockRejectedValueOnce({ response: undefined })
      .mockResolvedValueOnce({ data: { access_token: 't', token_type: 'bearer', user } } as any)
    render(<MemoryRouter initialEntries={['/']}><AuthProvider><Routes><Route path="/" element={<DemoLogin retryDelayMs={5} />} /><Route path="/app" element={<div>APP HOME</div>} /></Routes></AuthProvider></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Beneficiary' }))
    await waitFor(() => expect(screen.getByText('APP HOME')).toBeInTheDocument())
    expect(post).toHaveBeenCalledTimes(3)
  })

  it('does not retry real refusals (for example demo access switched off)', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 404, data: { detail: 'Not found' } } })
    wrap(<DemoLogin retryDelayMs={5} />)
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not found'))
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('reports an unreachable server after the retries instead of failing silently', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue({ response: undefined })
    wrap(<DemoLogin retryDelayMs={5} maxAttempts={3} />)
    fireEvent.click(screen.getByRole('button', { name: 'Beneficiary' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Cannot reach the server/))
    expect(post).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: 'Admin' })).toBeEnabled()
  })
})
describe('full login page (VITE_LOGIN_MODE=full, used for real deployments)', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.stubEnv('VITE_LOGIN_MODE', 'full') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('shows a server error message on failed sign-in (no fake success)', async () => {
    vi.spyOn(api, 'get').mockRejectedValue({ response: undefined })
    vi.spyOn(api, 'post').mockRejectedValueOnce({ response: { status: 401, data: { detail: 'Incorrect username or password' } } })
    wrap(<Login />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect username or password'))
  })

  it('requires both mandatory consents before registration is enabled', () => {
    vi.spyOn(api, 'get').mockRejectedValue({ response: undefined })
    wrap(<Login />)
    fireEvent.click(screen.getByText('I have an invitation code'))
    const submit = screen.getByRole('button', { name: 'Create account' })
    expect(submit).toBeDisabled()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0]); fireEvent.click(boxes[1])
    expect(submit).toBeEnabled()
  })

  it('shows one-click role buttons when the backend says demo mode is on', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { demo_mode: true } } as any)
    wrap(<Login />)
    expect(await screen.findByRole('button', { name: 'Caseworker' })).toBeInTheDocument()
  })

  it('hides the one-click buttons when demo mode is off', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ data: { demo_mode: false } } as any)
    wrap(<Login />)
    await waitFor(() => expect(get).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Caseworker' })).not.toBeInTheDocument()
  })})