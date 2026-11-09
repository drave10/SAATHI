import { expect, test } from '@playwright/test'
import { PW, apiToken, auth, login, noHorizontalOverflow } from './helpers'

const ROUTES = {
  beneficiary: { user: 'ben003', pw: () => PW.ben(), pages: [['/app', 'Hello'], ['/app/assessment', 'SAATHI well-being check-in'], ['/app/history', 'Check-in history'], ['/app/trends', 'Well-being trends'], ['/app/resources', 'Support resources'], ['/app/settings', 'Settings & privacy']] },
  caseworker: { user: 'caseworker3', pw: () => PW.cw(), pages: [['/app', 'Caseworker dashboard'], ['/app/cases', 'Cases'], ['/app/followups', 'Follow-up management'], ['/app/interventions', 'Intervention records'], ['/app/settings', 'Settings']] },
  admin: { user: 'admin', pw: () => PW.admin(), pages: [['/app', 'Administration'], ['/app/users', 'User management'], ['/app/analytics', 'Analytics'], ['/app/settings', 'Settings']] },
} as const

test.describe('navigation', () => {
  for (const [role, cfg] of Object.entries(ROUTES)) {
    test(`${role}: every sidebar link and deep link renders its page`, async ({ page }) => {
      await login(page, cfg.user, cfg.pw())
      const links = await page.getByRole('navigation', { name: 'Main' }).getByRole('link').all()
      expect(links.length).toBe(cfg.pages.length)
      for (const [path, title] of cfg.pages) {
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(title)
        const active = page.getByRole('navigation', { name: 'Main' }).locator('a[aria-current="page"]')
        await expect(active).toHaveCount(1)   // exactly one highlighted item
      }
      // client-side navigation + browser back/forward
      await page.goto('/app')
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link').nth(1).click()
      const second = page.url()
      await page.goBack()
      await expect(page).toHaveURL(/\/app$/)
      await page.goForward()
      expect(page.url()).toBe(second)
    })
  }

  test('guards: logged-out deep links, wrong-role routes, unknown routes', async ({ page }) => {
    await page.goto('/app/cases')
    await expect(page.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()
    await page.goto('/totally/unknown')
    await expect(page.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()

    await login(page, 'ben003', PW.ben())
    for (const p of ['/app/cases', '/app/users', '/app/analytics', '/app/followups', '/app/interventions', '/app/cases/1']) {
      await page.goto(p)
      await expect(page).toHaveURL(/\/app$/)
    }
    await page.goto('/nothing-here')
    await expect(page).toHaveURL(/\/app$/)   // logged in: unknown routes go home
    await page.goto('/')
    await expect(page).toHaveURL(/\/app$/)   // logged-in users skip the login page
  })

  test('session revoked on the server logs the user out on the next request', async ({ page, request }) => {
    await login(page, 'ben004', PW.ben())
    const token = await page.evaluate(() => sessionStorage.getItem('saathi.token'))
    expect((await request.post('/api/auth/logout', { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(204)
    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()
    expect(await page.evaluate(() => sessionStorage.getItem('saathi.token'))).toBeNull()
  })
})

test.describe('responsive layout', () => {
  const sizes = [{ w: 375, h: 812, n: 'phone' }, { w: 768, h: 1024, n: 'tablet' }, { w: 1280, h: 800, n: 'desktop' }]
  for (const [role, cfg] of Object.entries(ROUTES)) {
    for (const s of sizes) {
      test(`${role} @ ${s.n} ${s.w}px: no horizontal overflow, content visible, nav reachable`, async ({ page }) => {
        await page.setViewportSize({ width: s.w, height: s.h })
        await login(page, cfg.user, cfg.pw())
        for (const [path, title] of cfg.pages) {
          await page.goto(path)
          await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(title)
          await page.waitForLoadState('networkidle')
          expect(await noHorizontalOverflow(page), `${role} ${path} overflows at ${s.w}px`).toBe(true)
        }
        if (s.w < 1024) {
          await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible()
          await page.getByRole('button', { name: 'Open menu' }).click()
          await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link').first()).toBeVisible()
          await page.getByRole('navigation', { name: 'Main' }).getByRole('link').nth(1).click()
          await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)   // drawer closes after navigating
        } else {
          await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden()
        }
      })
    }
  }

  test('case profile and modals are usable on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await login(page, 'caseworker1', PW.cw())
    await page.goto('/app/cases')
    await page.getByRole('link', { name: /Open case/ }).first().click()
    await expect(page.getByText('Assessment timeline')).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await noHorizontalOverflow(page)).toBe(true)
    await page.getByRole('button', { name: 'Schedule follow-up' }).first().click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible()
    const box = await dlg.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(375)
  })
})

test.describe('loading and error states', () => {
  test('loading spinner is shown while the API is slow, then real data replaces it', async ({ page }) => {
    await login(page, 'ben005', PW.ben())
    await page.route('**/api/assessments', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue() })
    await page.getByRole('link', { name: 'History' }).click()
    await expect(page.getByRole('status').getByText('Loading…')).toBeVisible()
    await expect(page.getByRole('button', { name: 'View answers' }).first()).toBeVisible()
    await expect(page.getByText('Loading…')).toHaveCount(0)
  })

  test('network failure shows an error with retry that recovers', async ({ page }) => {
    await login(page, 'caseworker4', PW.cw())
    await page.route('**/api/followups**', (r) => r.abort())
    await page.getByRole('link', { name: 'Follow-ups' }).click()
    await expect(page.getByRole('alert')).toContainText('Cannot reach the server')
    await page.unroute('**/api/followups**')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.locator('table, :text("Nothing here")').first()).toBeVisible()
  })

  test('server 500 and 403 responses surface readable messages (no blank page, no fake success)', async ({ page }) => {
    await login(page, 'caseworker4', PW.cw())
    await page.route('**/api/interventions', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal server error"}' }))
    await page.getByRole('link', { name: 'Interventions' }).click()
    await expect(page.getByRole('alert')).toContainText('Internal server error')
    await page.unroute('**/api/interventions')
    await page.route('**/api/analytics/caseworker-summary', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: '{"detail":"You do not have permission to perform this action"}' }))
    await page.goto('/app')
    await expect(page.getByRole('alert').first()).toContainText('permission')
  })

  test('a failed save keeps the form open and reports the error', async ({ page }) => {
    await login(page, 'caseworker4', PW.cw())
    await page.goto('/app/cases')
    await page.getByRole('link', { name: /Open case/ }).first().click()
    await page.route('**/api/cases/*/notes', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Internal server error"}' }))
    await page.getByLabel('New case note').fill('will fail')
    await page.getByRole('button', { name: 'Save note' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Internal server error' })).toBeVisible()
    await expect(page.getByLabel('New case note')).toHaveValue('will fail')   // user's text is not lost
  })

  test('login shows the lockout message from the backend', async ({ page, request }) => {
    await page.goto('/')
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Username').fill('ben025'); await page.getByLabel('Password').fill('wrong-pass-1')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('alert')).toBeVisible()
    }
    await page.getByLabel('Password').fill(PW.ben())
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toContainText('Too many failed attempts')
  })
})
