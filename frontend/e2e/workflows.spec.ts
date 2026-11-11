import { expect, test, type Page } from '@playwright/test'

const need = (n: string) => { const v = process.env[n]; if (!v) throw new Error(`Set ${n} (see README → End-to-end tests)`); return v }

async function login(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app/)
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).first().click()
  await expect(page.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()
}

test('login rejects bad credentials with a visible error', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Username').fill('ben011')
  await page.getByLabel('Password').fill('definitely-wrong-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect username or password')
})

test('beneficiary check-in with a critical answer -> support shown -> caseworker is notified', async ({ page }) => {
  await login(page, 'ben011', need('E2E_BENEFICIARY_PASSWORD'))
  await page.getByRole('link', { name: /check-in/i }).first().click()
  await expect(page.getByRole('heading', { name: 'SAATHI well-being check-in' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Begin check-in|Save & finish later/ })).toBeVisible()
  if (await page.getByRole('button', { name: 'Begin check-in' }).isVisible()) {  // a saved draft skips the consent screen
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Begin check-in' }).click()
  }

  // Walk every section: choose the first option of each question except the self-harm item ("Several days").
  for (let section = 1; section <= 8; section++) {
    await expect(page.getByText(`Section ${section} of 8`)).toBeVisible()  // wait for the section to render
    const groups = page.locator('fieldset')
    const n = await groups.count()
    for (let i = 0; i < n; i++) {
      const g = groups.nth(i)
      if ((await g.locator('input[type=radio]').count()) === 0) continue
      const isSelf = (await g.locator('legend').innerText()).includes('hurting yourself')
      await g.locator('input[type=radio]').nth(isSelf ? 1 : 0).check()
    }
    const submit = page.getByRole('button', { name: 'Submit check-in' })
    if (await submit.isVisible()) { await submit.click(); break }
    await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Thank you for checking in' })).toBeVisible()
  await expect(page.getByText('Support is available right now')).toBeVisible()
  await expect(page.getByText(/Urgent review|priority/i)).toHaveCount(0)  // beneficiary never sees a risk label
  await page.getByRole('link', { name: 'Back to dashboard' }).click()
  await logout(page)

  await login(page, 'caseworker1', need('E2E_CASEWORKER_PASSWORD'))
  await expect(page.getByRole('heading', { name: 'Review notifications' })).toBeVisible()
  await expect(page.getByText('Participant 011').first()).toBeVisible()
  await page.getByRole('link', { name: 'Participant 011' }).first().click()
  await expect(page.getByText('Reported thoughts of self-harm').first()).toBeVisible()
  await expect(page.getByText(/Not a diagnosis|not a diagnosis/).first()).toBeVisible()
})

test('role restrictions are enforced in the UI and the API', async ({ page, request }) => {
  await login(page, 'ben001', need('E2E_BENEFICIARY_PASSWORD'))
  await page.goto('/app/users')
  await expect(page).toHaveURL(/\/app$/)  // redirected away from the admin page
  const token = await page.evaluate(() => sessionStorage.getItem('saathi.token'))
  const r = await request.get('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
  expect(r.status()).toBe(403)
})

test('admin sees aggregate analytics only', async ({ page }) => {
  await login(page, 'admin', need('E2E_ADMIN_PASSWORD'))
  await page.getByRole('link', { name: 'Analytics' }).click()
  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
  await expect(page.getByText('Check-ins per week')).toBeVisible()
  await expect(page.getByText(/BEN-\d{5}/)).toHaveCount(0)
})

test('demo mode: one click per role, no password, and one visitor logging out does not sign out another', async ({ browser }) => {
  const heading: Record<string, RegExp> = { Beneficiary: /Hello, /, Caseworker: /Caseworker dashboard/, Admin: /Administration/ }
  for (const role of ['Beneficiary', 'Caseworker', 'Admin']) {
    const page = await (await browser.newContext({ baseURL: 'http://localhost:5173' })).newPage()
    await page.goto('/')
    await page.getByRole('button', { name: role, exact: true }).click()
    await expect(page).toHaveURL(/\/app/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading[role])
    await page.close()
  }
  const a = await (await browser.newContext({ baseURL: 'http://localhost:5173' })).newPage()
  const b = await (await browser.newContext({ baseURL: 'http://localhost:5173' })).newPage()
  for (const p of [a, b]) { await p.goto('/'); await p.getByRole('button', { name: 'Caseworker', exact: true }).click(); await expect(p).toHaveURL(/\/app/) }
  await a.getByRole('button', { name: 'Log out' }).first().click()
  await expect(a.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()
  await b.getByRole('link', { name: 'Follow-ups' }).click()
  await expect(b.getByRole('heading', { name: 'Follow-up management' })).toBeVisible()   // still signed in
})
