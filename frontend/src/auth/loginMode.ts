/** 'demo' (default): the login page offers only the three demo roles, with no username or password.
 *  'full': the normal sign-in form (username + password) and invitation-code registration, used for real deployments and the full-stack tests.
 *  Set with the build/dev variable VITE_LOGIN_MODE. Read at call time so tests can switch it. */
export type LoginMode = 'demo' | 'full'
export const loginMode = (): LoginMode => (import.meta.env.VITE_LOGIN_MODE === 'full' ? 'full' : 'demo')
