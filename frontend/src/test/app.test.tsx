import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { AuthProvider } from '../auth/AuthContext'
import { api, errorMessage } from '../api/client'
import { Pagination, PriorityBadge, EmptyState } from '../components/ui'
import Login from '../pages/Login'

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

describe('login page', () => {
  it('shows a server error message on failed sign-in (no fake success)', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce({ response: { status: 401, data: { detail: 'Incorrect username or password' } } })
    wrap(<Login />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect username or password'))
  })

  it('requires both mandatory consents before registration is enabled', () => {
    wrap(<Login />)
    fireEvent.click(screen.getByText('I have an invitation code'))
    const submit = screen.getByRole('button', { name: 'Create account' })
    expect(submit).toBeDisabled()
    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[0]); fireEvent.click(boxes[1])
    expect(submit).toBeEnabled()
  })

  it('states that the tool is not diagnostic', () => {
    wrap(<Login />)
    expect(screen.getByText(/does not diagnose any condition/)).toBeInTheDocument()
  })
})

describe('demo mode', () => {
  it('shows one-click role buttons only when the backend says demo mode is on, and uses the demo-login endpoint', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { demo_mode: true } } as any)
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Demo account is not available' } } })
    wrap(<Login />)
    const btn = await screen.findByRole('button', { name: 'Caseworker' })
    fireEvent.click(btn)
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/demo-login', { role: 'caseworker' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Demo account is not available'))
  })

  it('hides the buttons when demo mode is off', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ data: { demo_mode: false } } as any)
    wrap(<Login />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Caseworker' })).not.toBeInTheDocument()
  })
})
