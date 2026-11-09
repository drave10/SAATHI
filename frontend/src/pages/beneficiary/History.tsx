import { useState } from 'react'
import { api } from '../../api/client'
import { Async, Badge, Card, EmptyState, Modal, PageHeader, Spinner, fmtDate, useFetch } from '../../components/ui'
import { DIMENSION_LABELS } from '../../types'

interface Summary { id: number; submitted_at: string; wellbeing_index: number | null; dimension_wellbeing: Record<string, number | null> }
interface Detail extends Summary { responses: { question_id: string; text: string; answer: string | null; free_text: string | null }[] }

export default function AssessmentHistory() {
  const state = useFetch(() => api.get<Summary[]>('/assessments').then((r) => r.data))
  const [open, setOpen] = useState<number | null>(null)
  const detail = useFetch(() => (open ? api.get<Detail>(`/assessments/${open}`).then((r) => r.data) : Promise.resolve(null as unknown as Detail)), [open])

  return (
    <>
      <PageHeader title="Check-in history" subtitle="All of your completed check-ins. Only you and your authorised support worker can see these." />
      <Async state={state}>
        {(rows) => rows.length === 0 ? <Card><EmptyState title="No check-ins yet" hint="Your completed check-ins will appear here." /></Card> : (
          <Card pad={false}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50"><tr><th className="th">Date</th><th className="th">Well-being score</th><th className="th">Lowest area</th><th className="th"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {[...rows].reverse().map((a) => {
                    const dims = Object.entries(a.dimension_wellbeing ?? {}).filter(([, v]) => v != null) as [string, number][]
                    const low = dims.sort((x, y) => x[1] - y[1])[0]
                    return (
                      <tr key={a.id}>
                        <td className="td">{fmtDate(a.submitted_at, true)}</td>
                        <td className="td font-medium">{a.wellbeing_index ?? '—'}</td>
                        <td className="td">{low ? <Badge tone="navy">{DIMENSION_LABELS[low[0]]} ({low[1]})</Badge> : '—'}</td>
                        <td className="td text-right"><button className="btn-secondary py-1" onClick={() => setOpen(a.id)}>View answers</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Async>
      {open && (
        <Modal title="Your answers" onClose={() => setOpen(null)}>
          {detail.loading ? <Spinner /> : detail.data ? (
            <div className="space-y-3 text-sm">
              <p className="text-slate-500">{fmtDate(detail.data.submitted_at, true)}</p>
              {detail.data.responses.map((r) => (
                <div key={r.question_id} className="border-b border-slate-100 pb-2"><div className="text-slate-600">{r.text}</div><div className="font-medium text-navy-800">{r.answer ?? r.free_text ?? '—'}</div></div>
              ))}
            </div>
          ) : null}
        </Modal>
      )}
    </>
  )
}
