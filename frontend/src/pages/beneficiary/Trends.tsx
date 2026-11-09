import { CartesianGrid, Legend, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../../api/client'
import { Async, Card, EmptyState, PageHeader, fmtDate, useFetch } from '../../components/ui'
import { DIMENSION_LABELS } from '../../types'

interface Summary { id: number; submitted_at: string; wellbeing_index: number | null; dimension_wellbeing: Record<string, number | null> }
const COLORS = ['#259d93', '#2d4f84', '#d97706', '#7c3aed', '#db2777', '#0891b2', '#65a30d']

export default function Trends() {
  const state = useFetch(() => api.get<Summary[]>('/assessments').then((r) => r.data))
  return (
    <>
      <PageHeader title="Well-being trends" subtitle="How your own answers have changed over time. Higher scores mean you reported feeling better." />
      <Async state={state}>
        {(rows) => {
          if (rows.length === 0) return <Card><EmptyState title="Not enough data yet" hint="Complete a check-in to start seeing your trends." /></Card>
          const data = rows.map((r) => ({ date: fmtDate(r.submitted_at), overall: r.wellbeing_index, ...Object.fromEntries(Object.entries(r.dimension_wellbeing ?? {}).map(([k, v]) => [k, v])) }))
          const last = rows[rows.length - 1], prev = rows[rows.length - 2]
          const radar = Object.keys(DIMENSION_LABELS).map((k) => ({ area: DIMENSION_LABELS[k], Latest: last.dimension_wellbeing?.[k] ?? 0, Previous: prev?.dimension_wellbeing?.[k] ?? undefined }))
          return (
            <div className="space-y-6">
              <Card title="Overall well-being score">
                <div className="h-72" role="img" aria-label="Line chart of overall well-being score across check-ins">
                  <ResponsiveContainer><LineChart data={data} margin={{ left: -10, right: 10, top: 5 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Line type="monotone" dataKey="overall" name="Well-being" stroke="#259d93" strokeWidth={3} dot={{ r: 4 }} connectNulls /></LineChart></ResponsiveContainer>
                </div>
                {rows.length < 2 && <p className="mt-2 text-sm text-slate-500">Complete another check-in to see how things change over time.</p>}
              </Card>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="By area">
                  <div className="h-80" role="img" aria-label="Line chart of each well-being area over time">
                    <ResponsiveContainer><LineChart data={data} margin={{ left: -10, right: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="date" fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                      {Object.keys(DIMENSION_LABELS).map((k, i) => <Line key={k} type="monotone" dataKey={k} name={DIMENSION_LABELS[k]} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls />)}
                    </LineChart></ResponsiveContainer>
                  </div>
                </Card>
                <Card title="Latest check-in profile">
                  <div className="h-80" role="img" aria-label="Radar chart of latest well-being by area">
                    <ResponsiveContainer><RadarChart data={radar}><PolarGrid /><PolarAngleAxis dataKey="area" fontSize={11} /><PolarRadiusAxis domain={[0, 100]} fontSize={10} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                      {prev && <Radar name="Previous" dataKey="Previous" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.15} />}
                      <Radar name="Latest" dataKey="Latest" stroke="#259d93" fill="#259d93" fillOpacity={0.3} />
                    </RadarChart></ResponsiveContainer>
                  </div>
                </Card>
              </div>
              <p className="text-xs text-slate-500">These scores reflect your own answers only. They are not a medical assessment. If you notice things getting harder, you can request a follow-up from your dashboard.</p>
            </div>
          )
        }}
      </Async>
    </>
  )
}
