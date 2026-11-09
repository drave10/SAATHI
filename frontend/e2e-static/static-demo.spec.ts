import { expect, test, type Page } from '@playwright/test'

/** The static build must work with NO backend: every /api call is answered inside the browser. */
test.beforeEach(async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiRequests.push(r.url()) })
  ;(page as any).__api = apiRequests
})
const noNetworkApi = (page: Page) => expect((page as any).__api).toEqual([])

async function leave(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).first().click()
  await expect(page.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()   // logout is asynchronous in the demo server too
}

async function enter(page: Page, role: 'Beneficiary' | 'Caseworker' | 'Admin') {
  await page.goto('/')
  await page.getByRole('button', { name: role, exact: true }).click()
  await expect(page).toHaveURL(/\/app/)
}

test('one-click roles land on the right dashboards, with the static-demo banner and no network API calls', async ({ page }) => {
  await enter(page, 'Beneficiary')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hello, Debashish')
  await expect(page.getByText('Static demo.')).toBeVisible()
  await leave(page)
  await enter(page, 'Caseworker')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Caseworker dashboard')
  await expect(page.getByText('Assigned beneficiaries')).toBeVisible()
  await leave(page)
  await enter(page, 'Admin')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Administration')
  noNetworkApi(page)
})

test('typed login works with the sample password and rejects a wrong one', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('caseworker2'); await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password')
  await page.getByLabel('Password').fill('Demo-pass-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Caseworker dashboard')
})

test('beneficiary check-in with a critical answer shows support; caseworker sees the new urgent notification; data survives reload', async ({ page }) => {
  await enter(page, 'Beneficiary')
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Check-in' }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Begin check-in' }).click()
  for (let s = 1; s <= 8; s++) {
    await expect(page.getByText(`Section ${s} of 8`)).toBeVisible()
    for (const f of await page.locator('fieldset').all()) {
      if ((await f.locator('input[type=radio]').count()) === 0) continue
      const self = (await f.locator('legend').innerText()).includes('hurting yourself')
      await f.locator('input[type=radio]').nth(self ? 1 : 0).check()
    }
    const submit = page.getByRole('button', { name: 'Submit check-in' })
    if (await submit.isVisible()) { await submit.click(); break }
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Thank you for checking in' })).toBeVisible()
  await expect(page.getByText('Support is available right now')).toBeVisible()
  await expect(page.getByText(/Urgent review/)).toHaveCount(0)   // beneficiary never sees a review label
  await leave(page)

  await enter(page, 'Caseworker')   // caseworker1 owns ben001
  await expect(page.getByText('Review notifications')).toBeVisible()
  await page.getByRole('link', { name: 'Debashish' }).first().click()
  await expect(page.getByText('Reported thoughts of self-harm').first()).toBeVisible()
  await page.reload()   // state is kept in the browser
  await expect(page.getByText('Reported thoughts of self-harm').first()).toBeVisible()
  noNetworkApi(page)
})

test('case profile: note, follow-up, intervention and status persist after reload', async ({ page }) => {
  await enter(page, 'Caseworker')
  await page.goto('/app/cases')
  await page.getByRole('link', { name: /Open case/ }).first().click()
  const note = `static note ${Date.now()}`
  await page.getByLabel('New case note').fill(note)
  await page.getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Note saved.')).toBeVisible()
  await page.getByRole('button', { name: 'Record intervention' }).click()
  await page.getByLabel('Description').fill('static intervention')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Intervention recorded.')).toBeVisible()
  await page.getByLabel('Case status').selectOption('monitoring')
  await expect(page.getByText('Case status updated.')).toBeVisible()
  await page.reload()
  await expect(page.getByText(note)).toBeVisible()
  await expect(page.getByText('static intervention')).toBeVisible()
  await expect(page.getByLabel('Case status')).toHaveValue('monitoring')
})

test('admin: analytics charts, user creation, engine-config validation, resources, reset demo data', async ({ page }) => {
  await enter(page, 'Admin')
  await page.getByRole('link', { name: 'Analytics' }).click()
  await expect(page.locator('svg.recharts-surface').first()).toBeVisible()
  await expect(page.getByText(/BEN-\d{5}|Participant \d+/)).toHaveCount(0)
  await page.getByRole('link', { name: 'User management' }).click()
  await page.getByRole('button', { name: 'New staff user' }).click()
  await page.getByLabel('Username').fill('static_staff'); await page.getByLabel('Display name').fill('Static Staff')
  await page.getByLabel('Temporary password').fill('Static-pass-12')
  await page.getByRole('dialog').getByRole('button', { name: 'Create user' }).click()
  await expect(page.getByText('User created.')).toBeVisible()
  await page.getByRole('link', { name: 'Overview' }).click()
  await page.getByRole('tab', { name: 'Assessment engine' }).click()
  await page.getByLabel('Attention: overall index ≥').fill('90')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert').or(page.getByRole('status')).first()).toContainText(/Invalid configuration|urgent_overall/)
  await page.getByRole('tab', { name: 'Resources & emergency contacts' }).click()
  await page.getByRole('button', { name: 'Add resource' }).click()
  await page.getByLabel('Title').fill('Static desk'); await page.getByLabel('Summary').fill('s')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Resource saved.')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Static desk' })).toHaveCount(1)
  // reset wipes local changes and re-seeds
  await page.getByRole('button', { name: 'Reset demo data' }).click()
  await page.waitForLoadState('load')
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await page.getByRole('tab', { name: 'Resources & emergency contacts' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Static desk' })).toHaveCount(0)
})

test('phone layout: no horizontal overflow on key pages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  for (const [role, paths] of [['Caseworker', ['/app', '/app/cases', '/app/followups']], ['Admin', ['/app', '/app/analytics', '/app/users']], ['Beneficiary', ['/app', '/app/trends', '/app/resources']]] as const) {
    await enter(page, role)
    for (const p of paths) {
      await page.goto(p); await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible(); await page.waitForLoadState('networkidle')
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${role} ${p}`).toBeLessThanOrEqual(1)
    }
    await page.getByRole('button', { name: 'Open menu' }).click()
    await leave(page)
  }
})
