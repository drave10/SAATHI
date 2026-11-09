import { expect, type APIRequestContext, type Page } from '@playwright/test'

export const need = (n: string) => { const v = process.env[n]; if (!v) throw new Error(`Set ${n} (see README → End-to-end tests)`); return v }
export const PW = { admin: () => need('E2E_ADMIN_PASSWORD'), cw: () => need('E2E_CASEWORKER_PASSWORD'), ben: () => need('E2E_BENEFICIARY_PASSWORD') }

export async function login(page: Page, username: string, password: string) {
  await page.goto('/')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/app/)
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
}

export async function logout(page: Page) {
  const btn = page.getByRole('button', { name: 'Log out' }).first()
  if (!(await btn.isVisible())) await page.getByRole('button', { name: 'Open menu' }).click()
  await page.getByRole('button', { name: 'Log out' }).first().click()
  await expect(page.getByRole('heading', { name: 'Sign in to SAATHI' })).toBeVisible()
}

/** Token for direct API calls (used to compare UI against the backend's own numbers). */
export async function apiToken(request: APIRequestContext, username: string, password: string) {
  const r = await request.post('/api/auth/login', { data: { username, password } })
  expect(r.ok()).toBeTruthy()
  return (await r.json()).access_token as string
}
export const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

export async function noHorizontalOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  return over <= 1
}
