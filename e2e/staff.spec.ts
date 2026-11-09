import { expect, test } from '@playwright/test'
import { PW, apiToken, auth, login } from './helpers'

test.describe('caseworker workflows (real backend)', () => {
  test('dashboard numbers equal the API; acknowledging a notification updates both', async ({ page, request }) => {
    const t = await apiToken(request, 'caseworker2', PW.cw())
    const s = await (await request.get('/api/analytics/caseworker-summary', { headers: auth(t) })).json()
    await login(page, 'caseworker2', PW.cw())
    const stat = (label: string) => page.locator('div.card', { has: page.getByText(label, { exact: true }) }).first()
    await expect(stat('Assigned beneficiaries')).toContainText(String(s.assigned_beneficiaries))
    await expect(stat('Check-ins completed')).toContainText(String(s.assessments_completed))
    await expect(stat('Awaiting review')).toContainText(String(s.awaiting_review))
    await expect(stat('Overdue follow-ups')).toContainText(String(s.followups_overdue))
    const open = await (await request.get('/api/alerts?status=open', { headers: auth(t) })).json()
    if (open.length) {
      await page.getByRole('button', { name: 'Resolve' }).first().click()
      await expect(page.getByText('Notification resolved.')).toBeVisible()
      const after = await (await request.get('/api/alerts?status=open', { headers: auth(t) })).json()
      expect(after.length).toBe(open.length - 1)
    }
  })

  test('case list: search, filters, sort, pagination all query the backend', async ({ page, request }) => {
    await login(page, 'caseworker1', PW.cw())
    await page.getByRole('link', { name: 'Cases' }).click()
    await expect(page.getByRole('heading', { name: 'Cases', level: 1 })).toBeVisible()
    await expect(page.getByText(/1–\d+ of 5/)).toBeVisible()   // caseworker1 has 5 assigned cases (seed); never sees others
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await page.getByLabel('Search cases').fill('BEN-00001')
    await expect(page.getByRole('row')).toHaveCount(2)  // header + 1
    await expect(page.getByText('BEN-00001').first()).toBeVisible()
    await page.getByLabel('Search cases').fill('zzzzzz')
    await expect(page.getByText('No cases match your filters')).toBeVisible()
    await page.getByLabel('Search cases').fill('')
    await page.getByLabel('Filter by review priority').selectOption('urgent')
    const rows = page.getByRole('row').filter({ hasText: 'BEN-' })
    for (const r of await rows.all()) await expect(r).toContainText('Urgent review')
    await page.getByLabel('Filter by review priority').selectOption('')
    await page.getByLabel('Sort cases').selectOption('name:asc')
    await expect.poll(async () => {
      const names = await page.locator('tbody tr td:first-child .font-medium').allInnerTexts()
      return names.length > 1 && JSON.stringify([...names].sort()) === JSON.stringify(names)
    }).toBe(true)
  })

  test('case profile: note, follow-up, intervention, outcome, status and review persist after reload', async ({ page, request }) => {
    const t = await apiToken(request, 'caseworker1', PW.cw())
    await login(page, 'caseworker1', PW.cw())
    await page.goto('/app/cases')
    await page.getByLabel('Search cases').fill('BEN-00006')
    await page.getByRole('link', { name: 'Open case BEN-00006' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Participant 006')
    await expect(page.getByText('Assessment timeline')).toBeVisible()
    await expect(page.getByText('Why this review priority?')).toBeVisible()
    await expect(page.getByText(/Not a diagnosis|not a diagnosis/).first()).toBeVisible()

    const note = `e2e note ${Date.now()}`
    await page.getByLabel('New case note').fill(note)
    await page.getByRole('button', { name: 'Save note' }).click()
    await expect(page.getByText('Note saved.')).toBeVisible()

    await page.getByRole('button', { name: 'Schedule follow-up' }).first().click()
    await page.getByLabel('Type').selectOption('home_visit')
    await page.getByLabel(/Reason/).fill('e2e agenda')
    await page.getByRole('dialog').getByRole('button', { name: 'Schedule' }).click()
    await expect(page.getByText('Follow-up scheduled.')).toBeVisible()

    await page.getByRole('button', { name: 'Record intervention' }).click()
    await page.getByLabel('Type').selectOption('phone_check_in')
    await page.getByLabel('Description').fill('e2e intervention')
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Intervention recorded.')).toBeVisible()
    await page.getByLabel('Intervention outcome').first().selectOption('improved')
    await expect(page.getByText('Outcome saved.')).toBeVisible()

    await page.getByLabel('Case status').selectOption('monitoring')
    await expect(page.getByText('Case status updated.')).toBeVisible()

    await page.getByRole('button', { name: 'Answers' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Check-in answers' })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.reload()   // everything must come back from the database
    await expect(page.getByText(note)).toBeVisible()
    await expect(page.getByText('Home visit').first()).toBeVisible()
    await expect(page.getByText('Phone check in')).toBeVisible()
    await expect(page.getByLabel('Case status')).toHaveValue('monitoring')

    const cases = await (await request.get('/api/cases?q=BEN-00006', { headers: auth(t) })).json()
    const prof = await (await request.get(`/api/cases/${cases.items[0].id}`, { headers: auth(t) })).json()
    expect(prof.notes.some((n: any) => n.body === note)).toBeTruthy()
    expect(prof.interventions.some((i: any) => i.outcome === 'improved' && i.type === 'phone_check_in')).toBeTruthy()
  })

  test('follow-up management and intervention records pages', async ({ page }) => {
    await login(page, 'caseworker1', PW.cw())
    await page.getByRole('link', { name: 'Follow-ups' }).click()
    await expect(page.getByRole('heading', { name: 'Follow-up management' })).toBeVisible()
    for (const f of ['All', 'Due in 7 days', 'Overdue', 'Completed', 'Requested']) {
      await page.getByRole('tab', { name: f }).click()
      await expect(page.locator('table, :text("Nothing here")').first()).toBeVisible()
    }
    await page.getByRole('tab', { name: 'Overdue' }).click()
    const complete = page.getByRole('button', { name: 'Complete' }).first()
    if (await complete.isVisible()) {
      await complete.click()
      await page.getByLabel(/Outcome notes/).fill('e2e done')
      await page.getByRole('dialog').getByRole('button', { name: 'Mark completed' }).click()
      await expect(page.getByText('Follow-up completed.')).toBeVisible()
    }
    await page.getByRole('link', { name: 'Interventions' }).click()
    await expect(page.getByRole('heading', { name: 'Intervention records' })).toBeVisible()
    await expect(page.locator('tbody tr').first()).toBeVisible()
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0)
    await page.getByLabel('Filter by outcome').selectOption('improved')
    await expect.poll(async () => {
      const rows = await page.locator('tbody tr').allInnerTexts()
      return rows.length > 0 && rows.every((t) => t.includes('Improved'))
    }).toBe(true)
  })

  test("a caseworker opening someone else's case sees a clean error, not data", async ({ page, request }) => {
    const t2 = await apiToken(request, 'caseworker2', PW.cw())
    const other = (await (await request.get('/api/cases', { headers: auth(t2) })).json()).items[0].id
    await login(page, 'caseworker1', PW.cw())
    await page.goto(`/app/cases/${other}`)
    await expect(page.getByRole('alert')).toContainText('Beneficiary not found')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})

test.describe('admin workflows (real backend)', () => {
  test('users: create, search, deactivate, reactivate; cannot demote self', async ({ page }) => {
    const uname = `e2e_staff_${Date.now() % 100000}`
    await login(page, 'admin', PW.admin())
    await page.getByRole('link', { name: 'User management' }).click()
    await page.getByRole('button', { name: 'New staff user' }).click()
    await page.getByLabel('Username').fill(uname)
    await page.getByLabel('Display name').fill('E2E Staff')
    await page.getByLabel('Temporary password').fill('short')
    await page.getByRole('dialog').getByRole('button', { name: 'Create user' }).click()   // blocked by browser validation
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByLabel('Temporary password').fill('E2E-pass-12345')
    await page.getByRole('dialog').getByRole('button', { name: 'Create user' }).click()
    await expect(page.getByText('User created.')).toBeVisible()
    await expect(page.getByText(/Page 1 \/ [2-9]/)).toBeVisible()   // 30+ users -> real pagination
    await page.getByRole('button', { name: 'Next page' }).click()
    await expect(page.getByText(/Page 2 \/ /)).toBeVisible()
    await page.getByLabel('Search users').fill(uname)
    await expect(page.getByRole('row').filter({ hasText: uname })).toHaveCount(1)
    await page.getByRole('row').filter({ hasText: uname }).getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('button', { name: 'Deactivate' }).click()
    await expect(page.getByText(/deactivated and signed out/)).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: uname })).toContainText('Deactivated')
    await page.getByRole('row').filter({ hasText: uname }).getByRole('button', { name: 'Manage' }).click()
    await page.getByRole('button', { name: 'Reactivate' }).click()
    await expect(page.getByText('User reactivated.')).toBeVisible()
    await page.getByLabel('Search users').fill('admin')
    await page.getByRole('row').filter({ hasText: /^admin/ }).getByRole('button', { name: 'Manage' }).click()
    await expect(page.getByRole('button', { name: 'Deactivate' })).toBeDisabled()
  })

  test('admin dashboard: assignment, engine config, resources, audit log', async ({ page, request }) => {
    const t = await apiToken(request, 'admin', PW.admin())
    await login(page, 'admin', PW.admin())
    // assignment dropdown changes the case's caseworker in the backend
    await expect(page.getByLabel(/^Caseworker for BEN-/).first()).toBeVisible()
    let sel = page.getByLabel(/^Caseworker for BEN-/).first()
    for (const s of await page.getByLabel(/^Caseworker for BEN-/).all()) if ((await s.inputValue()) !== '') { sel = s; break }   // a case that currently has a caseworker (unassigning is not offered)
    const code = ((await sel.getAttribute('aria-label')) ?? '').replace('Caseworker for ', '')
    const current = await sel.inputValue()
    const options = await sel.locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value).filter(Boolean))
    const target = options.find((v) => v !== current)!
    await sel.selectOption(target)
    await expect(page.getByText(`Case ${code} reassigned.`)).toBeVisible()
    await page.reload()
    await expect(page.getByLabel(`Caseworker for ${code}`)).toHaveValue(target)
    await page.getByLabel(`Caseworker for ${code}`).selectOption(current)   // restore
    await expect(page.getByText(`Case ${code} reassigned.`)).toBeVisible()

    await page.getByRole('tab', { name: 'Assessment engine' }).click()
    await page.getByLabel('Attention: overall index ≥').fill('90')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toContainText(/Invalid configuration|urgent_overall/)   // 90 >= urgent(70) rejected by backend
    await page.getByLabel('Attention: overall index ≥').fill('42')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/Configuration saved/)).toBeVisible()
    expect((await (await request.get('/api/admin/engine-config', { headers: auth(t) })).json()).config.attention_overall).toBe(42)
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    await expect(page.getByLabel('Attention: overall index ≥')).toHaveValue('40')
    await expect(page.getByText('Experimental ML advisory')).toBeVisible()

    await page.getByRole('tab', { name: 'Resources & emergency contacts' }).click()
    await page.getByRole('button', { name: 'Add resource' }).click()
    await page.getByLabel('Title').fill('E2E desk')
    await page.getByLabel('Category').selectOption('emergency')
    await page.getByLabel('Summary').fill('e2e summary')
    await page.getByLabel(/Contact/).fill('999')
    await page.getByLabel('Verified').check()
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Resource saved.')).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'E2E desk' })
    await expect(row).toContainText('Verified')
    page.once('dialog', (d) => d.accept())
    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Resource deleted.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'E2E desk' })).toHaveCount(0)

    await page.getByRole('tab', { name: 'Audit log' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'resource_created' }).first()).toBeVisible()
    await expect(page.getByLabel('Filter by action').locator('option', { hasText: 'engine_config_updated' })).toHaveCount(1)   // options come from the API
    await page.getByLabel('Filter by action').selectOption('engine_config_updated')
    await expect.poll(async () => {
      const rows = await page.locator('tbody tr').allInnerTexts()
      return rows.length > 0 && rows.every((t) => t.includes('engine_config_updated'))
    }).toBe(true)
  })

  test('analytics: filters re-query the backend and charts render', async ({ page, request }) => {
    await login(page, 'admin', PW.admin())
    await page.getByRole('link', { name: 'Analytics' }).click()
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible()
    const reqs: string[] = []
    page.on('request', (r) => { if (r.url().includes('/analytics/overview')) reqs.push(r.url()) })
    await page.getByLabel('Organisational unit').selectOption('Demo Unit North')
    await expect.poll(() => reqs.some((u) => u.includes('org_unit=Demo+Unit+North') || u.includes('org_unit=Demo%20Unit%20North'))).toBeTruthy()
    await page.getByLabel('From').fill('2026-10-01')
    await expect.poll(() => reqs.some((u) => u.includes('from_date=2026-10-01'))).toBeTruthy()
    await expect(page.getByText('Minimum cell size').first()).toBeVisible()
    await expect(page.getByText(/BEN-\d{5}|Participant \d+/)).toHaveCount(0)
  })
})
