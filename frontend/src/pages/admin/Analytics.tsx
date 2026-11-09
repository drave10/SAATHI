import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api/client'
import { Async, Banner, Card, EmptyState, PageHeader, Stat, prettify, useFetch } from '../../components/ui'

const LEVEL_COLORS: Record<string, string> = { routine: '#259d93', attention: '#d97706', urgent: '#dc2626' }
const PIE = ['#1c3a68', '#259d93', '#d97706', '#7c3aed', '#64748b', '#db2777']
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function Analytics() {
  const [f, setF] = useState({ from: iso(new Date(Date.now() - 120 * 864e5)), to: iso(new Date()), unit: '' })
  const state = useFetch(() => api.get('/analytics/overview', { params: { from_date: f.from, to_date: f.to, ...(f.unit ? { org_unit: f.unit } : {}) } }).then((r) => r.data), [f.from, f.to, f.unit])
  const units: string[] = state.data?.org_units ?? []
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
  return (
    <>
      <PageHeader title="Analytics" subtitle="Aggregated, anonymised statistics. No individual records are shown here." />
      <Card className="mb-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><label className="label" htmlFor="a_f">From</label><input id="a_f" type="date" className="input" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
          <div><label className="label" htmlFor="a_t">To</label><input id="a_t" type="date" className="input" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
          <div><label className="label" htmlFor="a_u">Organisational unit</label><select id="a_u" className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="">All units</option>{units.map((u) => <option key={u}>{u}</option>)}</select></div>
        </div>
      </Card>
      <Async state={state}>{(o: any) => {
        const dist = ['routine', 'attention', 'urgent'].map((k) => ({ name: prettify(k), key: k, value: o.priority_distribution[k] }))
        const suppressed = dist.some((d) => d.value == null)
        return (
          <div className="space-y-6">
            <Banner>{o.privacy.note} Minimum cell size: {o.privacy.min_cell_size}. Suppressed values appear as "—".</Banner>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Beneficiaries" value={o.total_beneficiaries} hint={`${o.active_cases} active`} />
              <Stat label="Check-ins in period" value={o.assessments_submitted} />
              <Stat label="Assessment completion" value={pct(o.assessment_completion_rate)} hint="Share with ≥1 check-in in period" />
              <Stat label="Follow-up completion" value={pct(o.followups.completion_rate)} hint={`${o.followups.completed} done · ${o.followups.overdue} overdue`} />
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Check-ins per week">
                {o.assessments_per_week.length === 0 ? <EmptyState title="No check-ins in this period" /> : <div className="h-72" role="img" aria-label="Bar chart of check-ins per week"><ResponsiveContainer><BarChart data={o.assessments_per_week} margin={{ left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="week" fontSize={11} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="count" name="Check-ins" fill="#1c3a68" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
              </Card>
              <Card title="Review-priority distribution (latest check-in per consenting person)">
                <div className="h-72" role="img" aria-label="Bar chart of review priority distribution"><ResponsiveContainer><BarChart data={dist.map((d) => ({ ...d, value: d.value ?? 0 }))} margin={{ left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="value" name="People" radius={[4, 4, 0, 0]}>{dist.map((d) => <Cell key={d.key} fill={LEVEL_COLORS[d.key]} />)}</Bar></BarChart></ResponsiveContainer></div>
                {suppressed && <p className="mt-2 text-xs text-amber-700">Some groups are below the minimum cell size and are hidden.</p>}
              </Card>
              <Card title="Aggregated well-being trend (monthly average, higher is better)">
                {o.wellbeing_trend.length === 0 ? <EmptyState title="No data" /> : <div className="h-72" role="img" aria-label="Line chart of monthly average well-being"><ResponsiveContainer><LineChart data={o.wellbeing_trend} margin={{ left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="month" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Line dataKey="avg_wellbeing" name="Average well-being" stroke="#259d93" strokeWidth={3} connectNulls /></LineChart></ResponsiveContainer></div>}
              </Card>
              <Card title="Follow-ups by status">
                <div className="h-72" role="img" aria-label="Bar chart of follow-up statuses"><ResponsiveContainer><BarChart data={['requested', 'scheduled', 'completed', 'cancelled', 'overdue'].map((k) => ({ name: prettify(k), value: o.followups[k] }))} margin={{ left: -15 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Bar dataKey="value" name="Follow-ups" fill="#259d93" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              </Card>
              <Card title={`Interventions by type (${o.interventions.total})`}>
                {o.interventions.by_type.length === 0 ? <EmptyState title="No interventions in this period" /> : <div className="h-72" role="img" aria-label="Bar chart of interventions by type"><ResponsiveContainer><BarChart layout="vertical" data={o.interventions.by_type.map((t: any) => ({ ...t, type: prettify(t.type) }))} margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="type" width={140} fontSize={11} /><Tooltip /><Bar dataKey="count" name="Interventions" fill="#1c3a68" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div>}
              </Card>
              <Card title="Intervention outcomes">
                {o.interventions.by_outcome.length === 0 ? <EmptyState title="No data" /> : <div className="h-72" role="img" aria-label="Pie chart of intervention outcomes"><ResponsiveContainer><PieChart><Pie data={o.interventions.by_outcome.map((t: any) => ({ name: prettify(t.outcome), value: t.count }))} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>{o.interventions.by_outcome.map((_: any, i: number) => <Cell key={i} fill={PIE[i % PIE.length]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div>}
              </Card>
            </div>
          </div>)
      }}</Async>
    </>
  )
}
