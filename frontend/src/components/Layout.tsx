import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, BookOpen, ClipboardCheck, ClipboardList, HeartPulse, History, LayoutDashboard, LogOut, Menu,
  Settings, ShieldCheck, Stethoscope, TrendingUp, Users, CalendarClock, X, type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { STATIC_DEMO } from '../api/client'
import { loginMode } from '../auth/loginMode'
import { resetDemo } from '../demo/server'
import type { Role } from '../types'

interface NavItem { to: string; label: string; icon: LucideIcon }

const NAV: Record<Role, NavItem[]> = {
  beneficiary: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/assessment', label: 'Check-in', icon: ClipboardCheck },
    { to: '/app/history', label: 'History', icon: History },
    { to: '/app/trends', label: 'Well-being trends', icon: TrendingUp },
    { to: '/app/resources', label: 'Support resources', icon: BookOpen },
    { to: '/app/settings', label: 'Settings & privacy', icon: Settings },
  ],
  caseworker: [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/cases', label: 'Cases', icon: Users },
    { to: '/app/followups', label: 'Follow-ups', icon: CalendarClock },
    { to: '/app/interventions', label: 'Interventions', icon: Stethoscope },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ],
  admin: [
    { to: '/app', label: 'Overview', icon: LayoutDashboard },
    { to: '/app/users', label: 'User management', icon: Users },
    { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ],
}
const ROLE_LABEL: Record<Role, string> = { beneficiary: 'Beneficiary portal', caseworker: 'Caseworker workspace', admin: 'Administration' }

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-md shadow-teal-500/30"><HeartPulse className="h-4.5 w-4.5" aria-hidden /></span>
      <span className={`text-lg font-semibold tracking-tight ${light ? 'text-white' : 'text-navy-800'}`}>SAATHI</span>
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  if (!user) return null
  const items = NAV[user.role]

  const sidebar = (
    <div className="relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-navy-800 via-navy-800 to-navy-900 text-navy-100">
      <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-teal-500/10 blur-3xl" aria-hidden />
      <div className="relative flex h-16 items-center justify-between px-5"><Logo light />
        <button className="rounded p-1 text-navy-200 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>
      <p className="relative px-5 pb-2 text-xs font-medium uppercase tracking-wider text-navy-300">{ROLE_LABEL[user.role]}</p>
      <nav aria-label="Main" className="relative flex-1 space-y-1 px-3">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/app'} onClick={() => setOpen(false)}
            className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ${isActive ? 'bg-white/10 text-white ring-1 ring-white/10' : 'text-navy-200 hover:bg-white/5 hover:pl-4 hover:text-white'}`}>
            {({ isActive }) => (<>
              <span className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-teal-400 transition-all duration-300 ${isActive ? 'opacity-100 shadow-[0_0_12px_rgba(67,184,172,0.9)]' : 'scale-y-0 opacity-0'}`} aria-hidden />
              <Icon className={`h-4 w-4 transition-colors ${isActive ? 'text-teal-300' : 'group-hover:text-teal-300'}`} aria-hidden /> {label}
            </>)}
          </NavLink>
        ))}
      </nav>
      <div className="relative space-y-3 border-t border-white/10 p-4">
        <div className="flex items-start gap-2 rounded-lg bg-navy-700/60 p-3 text-xs text-navy-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" aria-hidden />
          Decision-support prototype. Not a diagnostic tool. Demo data is synthetic.
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-400 to-navy-500 text-xs font-semibold text-white" aria-hidden>{user.display_name.trim().charAt(0).toUpperCase()}</span><div className="min-w-0"><div className="truncate text-sm font-medium text-white">{user.display_name}</div><div className="text-xs capitalize text-navy-300">{user.role}</div></div></div>
          <button className="rounded-lg p-2 text-navy-200 transition hover:bg-white/10 hover:text-white active:scale-90" aria-label="Log out" onClick={async () => { await logout(); nav('/') }}><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <aside className="hidden w-64 shrink-0 lg:block"><div className="fixed inset-y-0 w-64">{sidebar}</div></aside>
      {open && <div className="fixed inset-0 z-40 lg:hidden"><div className="animate-fade absolute inset-0 bg-navy-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} /><div className="animate-slide-in relative h-full w-72 shadow-2xl">{sidebar}</div></div>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button className="btn-ghost p-2" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button><Logo />
        </header>
        {!STATIC_DEMO && loginMode() === 'demo' && (
          <div role="note" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6">
            <strong>Demo prototype.</strong> All data is synthetic sample data shared by every visitor and may be reset at any time. Please do not enter real personal information.
          </div>
        )}
        {STATIC_DEMO && (
          <div role="note" className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-200 bg-teal-50 px-4 py-2 text-xs text-teal-900 sm:px-6">
            <span><strong>Demo prototype.</strong> Everything runs in your browser with synthetic sample data; changes are saved on this device only.</span>
            <button className="font-semibold underline" onClick={async () => { resetDemo(); await logout(); nav('/') ; location.reload() }}>Reset demo data</button>
          </div>
        )}
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><div key={pathname} className="animate-rise"><Outlet /></div></main>
      </div>
    </div>
  )
}

export const _icons = { Activity, ClipboardList }
