import { expect, test } from '@playwright/test'
import { PW, apiToken, auth, login, logout } from './helpers'

test.describe('beneficiary workflows (real backend)', () => {
  test('dashboard, history, trends and resources show exactly what the API returns', async ({ page, request }) => {
    const t = await apiToken(request, 'ben001', PW.ben())
    const me = await (await request.get('/api/beneficiaries/me', { headers: auth(t) })).json()
    const hist = await (await request.get('/api/assessments', { headers: auth(t) })).json()
    const resources = await (await request.get('/api/resources', { headers: auth(t) })).json()

    await login(page, 'ben001', PW.ben())
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Debashish')
    await expect(page.getByText(String(me.assessments_completed), { exact: true }).first()).toBeVisible()
    await expect(page.getByText(me.caseworker_name.replace(' (synthetic)', ''))).toBeVisible()

    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.getByRole('heading', { name: 'Check-in history' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'View answers' })).toHaveCount(hist.length)
    await page.getByRole('button', { name: 'View answers' }).first().click()
    await expect(page.getByRole('dialog', { name: 'Your answers' })).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Over the last two weeks, how often have you felt low or down?')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // beneficiary must never see review levels anywhere in history
    await expect(page.getByText(/Urgent review|Attention|Routine/)).toHaveCount(0)

    await page.getByRole('link', { name: 'Well-being trends' }).click()
    await expect(page.getByRole('heading', { name: 'Well-being trends' })).toBeVisible()
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible()
    expect(await page.locator('svg.recharts-surface').count()).toBeGreaterThanOrEqual(3)

    await page.getByRole('link', { name: 'Support resources' }).click()
    for (const [tab, cat] of [['Urgent help', 'emergency'], ['Support services', 'support'], ['Learn & cope', 'education']] as const) {
      await page.getByRole('tab', { name: tab }).click()
      await expect(page.locator('article')).toHaveCount(resources.filter((r: any) => r.category === cat).length)
    }
    await page.getByRole('tab', { name: 'Urgent help' }).click()
    await expect(page.getByText('112').first()).toBeVisible()
    await expect(page.getByText('Pending verification').first()).toBeVisible()
  })

  test('request follow-up: success persists in backend, duplicate shows server error', async ({ page, request }) => {
    let user = '', t = ''
    for (let i = 18; i <= 25; i++) {  // find a beneficiary with no open request (seed data varies)
      user = `ben${String(i).padStart(3, '0')}`; t = await apiToken(request, user, PW.ben())
      const open = await (await request.get('/api/followups?status=requested', { headers: auth(t) })).json()
      if (open.total === 0) break
    }
    await login(page, user, PW.ben())
    await page.getByRole('button', { name: 'Request a follow-up' }).click()
    await page.getByLabel(/Anything you would like to share/).fill('e2e request')
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByText('Your request has been sent. Your support worker will contact you.')).toBeVisible()
    const reqs = await (await request.get('/api/followups?status=requested', { headers: auth(t) })).json()
    expect(reqs.items.length).toBe(1)
    // second request must fail with the backend's message
    await page.getByRole('button', { name: 'Request a follow-up' }).click()
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByRole('alert')).toContainText('already have an open request')
    await page.reload()
    await expect(page.getByText('Awaiting scheduling')).toBeVisible()
  })

  test('settings: consent toggle persists, export downloads, wrong password shows error', async ({ page, request }) => {
    await login(page, 'ben017', PW.ben())
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings & privacy' }).click()
    const sw = page.getByRole('switch', { name: /aggregate statistics/ })
    const before = await sw.isChecked()
    await sw.click()
    await expect(page.getByText('Preference saved.')).toBeVisible()
    await page.reload()
    expect(await page.getByRole('switch', { name: /aggregate statistics/ }).isChecked()).toBe(!before)
    await page.getByRole('switch', { name: /aggregate statistics/ }).click()  // restore
    await expect(page.getByText('Preference saved.')).toBeVisible()

    // Capture the download instead of letting Edge write a file (a real download leaves Edge unable to open new tabs for later tests)
    await page.evaluate(() => { (window as any).__dl = []; HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { (window as any).__dl.push({ name: this.download, href: this.href }) } })
    const exportResp = page.waitForResponse((r) => r.url().includes('/api/me/export') && r.status() === 200)
    await page.getByRole('button', { name: 'Download my data' }).click()
    await exportResp
    await expect.poll(() => page.evaluate(() => (window as any).__dl.length)).toBe(1)
    const dl = await page.evaluate(() => (window as any).__dl[0])
    expect(dl.name).toBe('my-saathi-data.json')
    expect(dl.href).toMatch(/^blob:/)

    await page.getByLabel('Current password').fill('not-the-password-1')
    await page.getByLabel('New password').fill('Another-pass-9')
    await page.getByRole('button', { name: 'Update password' }).click()
    await expect(page.getByRole('alert')).toContainText('Current password is incorrect')
    await expect(page.getByText(/Privacy notice/)).toBeVisible()
  })

  test('full onboarding: admin creates invitation -> person registers -> empty states -> first check-in -> trends', async ({ browser }) => {
    const admin = await (await browser.newContext()).newPage()
    await login(admin, 'admin', PW.admin())
    await admin.getByRole('tab', { name: 'Onboarding & data deletion' }).click()
    await admin.getByRole('button', { name: 'Generate code' }).click()
    const code = (await admin.getByTestId('invite-code').innerText()).trim()
    expect(code.length).toBeGreaterThanOrEqual(8)

    const page = await (await browser.newContext()).newPage()
    const uname = `e2e_new_${Date.now() % 100000}`
    await page.goto('/')
    await page.getByText('I have an invitation code').click()
    await page.getByLabel('Invitation code').fill('WRONGCODE123')
    await page.getByLabel('Name to display').fill('E2E Newcomer')
    await page.getByLabel('Username').fill(uname)
    await page.getByLabel('Password').fill('E2E-pass-12345')
    const boxes = page.getByRole('checkbox')
    await boxes.nth(0).check(); await boxes.nth(1).check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByRole('alert')).toContainText('invalid or has expired')
    await page.getByLabel('Invitation code').fill(code)
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Newcomer')
    await expect(page.getByText('You have not completed a check-in yet.')).toBeVisible()

    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.getByText('No check-ins yet')).toBeVisible()
    await page.getByRole('link', { name: 'Well-being trends' }).click()
    await expect(page.getByText('Not enough data yet')).toBeVisible()

    // first check-in: validation (cannot proceed without answers), save & resume, then submit
    await page.getByRole('link', { name: 'Check-in' }).click()
    await expect(page.getByRole('button', { name: 'Begin check-in' })).toBeDisabled()
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'Begin check-in' }).click()
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
    for (const f of await page.locator('fieldset').all()) await f.locator('input[type=radio]').first().check()
    await expect(page.getByText(/2 of 17 questions answered/)).toBeVisible()
    await page.getByRole('button', { name: 'Save & finish later' }).click()
    await expect(page.getByText('Progress saved.')).toBeVisible()
    await page.getByRole('link', { name: 'Back to dashboard' }).click()
    await expect(page.getByText('You have a check-in in progress')).toBeVisible()
    await page.getByRole('link', { name: 'Resume check-in' }).click()
    await expect(page.getByText('Welcome back')).toBeVisible()
    await expect(page.getByText(/2 of 17 questions answered/)).toBeVisible()
    for (let s = 1; s <= 8; s++) {
      await expect(page.getByText(`Section ${s} of 8`)).toBeVisible()
      for (const f of await page.locator('fieldset').all()) if ((await f.locator('input[type=radio]').count()) > 0) await f.locator('input[type=radio]').first().check()
      const submit = page.getByRole('button', { name: 'Submit check-in' })
      if (await submit.isVisible()) { await submit.click(); break }
      await page.getByRole('button', { name: 'Next' }).click()
    }
    await expect(page.getByRole('heading', { name: 'Thank you for checking in' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to dashboard' }).click()
    await expect(page.getByText('Your check-in is up to date')).toBeVisible()
    await page.getByRole('link', { name: 'Well-being trends' }).click()
    await expect(page.getByText('Overall well-being score')).toBeVisible()
    await logout(page)
  })

  test('data deletion request is visible to admin and erasure removes the account', async ({ browser, request }) => {
    const ct = await apiToken(request, 'admin', PW.admin())
    const inv = await (await request.post('/api/admin/invitations', { headers: auth(ct), data: { org_unit: 'Demo Unit East', valid_days: 1 } })).json()
    const uname = `e2e_del_${Date.now() % 100000}`
    const reg = await request.post('/api/auth/register', { data: { invite_code: inv.code, username: uname, password: 'E2E-pass-12345', display_name: 'Delete Me', consent_privacy: true, consent_assessment: true } })
    expect(reg.status()).toBe(201)

    const page = await (await browser.newContext()).newPage()
    await login(page, uname, 'E2E-pass-12345')
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings & privacy' }).click()
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: 'Request data deletion' }).click()
    await expect(page.getByText('Deletion request sent.')).toBeVisible()
    await expect(page.getByText(/You asked for your data to be erased/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Request data deletion' })).toBeDisabled()

    const adm = await (await browser.newContext()).newPage()
    await login(adm, 'admin', PW.admin())
    await adm.getByRole('tab', { name: 'Onboarding & data deletion' }).click()
    adm.once('dialog', (d) => d.accept())
    await adm.getByRole('button', { name: 'Erase permanently' }).last().click()
    await expect(adm.getByText(/erased\./)).toBeVisible()
    const r = await request.post('/api/auth/login', { data: { username: uname, password: 'E2E-pass-12345' } })
    expect(r.status()).toBe(401)
  })
})
