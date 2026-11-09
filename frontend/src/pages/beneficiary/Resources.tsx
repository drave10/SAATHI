import { useState } from 'react'
import { BookOpen, ChevronDown, LifeBuoy, Phone, Users } from 'lucide-react'
import { api } from '../../api/client'
import { Async, Badge, Banner, Card, PageHeader, useFetch } from '../../components/ui'
import type { Resource } from '../../types'

const TABS = [{ k: 'emergency', label: 'Urgent help', icon: LifeBuoy }, { k: 'support', label: 'Support services', icon: Users }, { k: 'education', label: 'Learn & cope', icon: BookOpen }] as const

export default function Resources() {
  const state = useFetch(() => api.get<Resource[]>('/resources').then((r) => r.data))
  const [tab, setTab] = useState<(typeof TABS)[number]['k']>('emergency')
  const [openId, setOpenId] = useState<number | null>(null)
  return (
    <>
      <PageHeader title="Support resources" subtitle="Information and contacts curated by your support organisation." />
      <Banner kind="warn">If you or someone else is in immediate danger, contact your local emergency number (112 in India) or go to the nearest safe place. This app cannot send help by itself.</Banner>
      <div role="tablist" aria-label="Resource categories" className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(({ k, label, icon: I }) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium ${tab === k ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}><I className="h-4 w-4" aria-hidden />{label}</button>
        ))}
      </div>
      <div className="mt-6">
        <Async state={state}>
          {(all) => {
            const rows = all.filter((r) => r.category === tab)
            if (!rows.length) return <Card><p className="text-sm text-slate-500">No resources in this category yet.</p></Card>
            return (
              <div className="grid gap-4 md:grid-cols-2">
                {rows.map((r) => (
                  <article key={r.id} className="card p-5">
                    <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{r.title}</h3>{tab !== 'education' && (r.is_verified ? <Badge tone="teal">Verified</Badge> : <Badge tone="amber">Pending verification</Badge>)}</div>
                    <p className="mt-1 text-sm text-slate-600">{r.summary}</p>
                    {r.contact && <p className="mt-3 flex items-center gap-2 text-sm font-medium text-navy-800"><Phone className="h-4 w-4 text-teal-600" aria-hidden /> {r.contact}</p>}
                    {r.body && (
                      <>
                        <button className="mt-3 flex items-center gap-1 text-sm font-medium text-teal-700" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)}>{openId === r.id ? 'Hide' : 'Read more'} <ChevronDown className={`h-4 w-4 transition-transform ${openId === r.id ? 'rotate-180' : ''}`} aria-hidden /></button>
                        {openId === r.id && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{r.body}</p>}
                      </>
                    )}
                  </article>
                ))}
              </div>
            )
          }}
        </Async>
      </div>
    </>
  )
}
