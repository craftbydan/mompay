import type { Role } from '../types'

const SESSION_KEY = 'slip_auth'

interface AuthSession {
  role: Role
  expires: number
}

const SESSION_DURATION_MS = 1000 * 60 * 60 * 8 // 8 hours

export function login(role: Role, password: string): boolean {
  const expectedPassword =
    role === 'me'
      ? import.meta.env.VITE_ME_PASSWORD
      : import.meta.env.VITE_MOM_PASSWORD

  if (!expectedPassword) {
    console.error(`No password configured for role: ${role}`)
    return false
  }

  if (password !== expectedPassword) return false

  const session: AuthSession = {
    role,
    expires: Date.now() + SESSION_DURATION_MS,
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  return true
}

export function logout(): void {
  sessionStorage.removeItem(SESSION_KEY)
}

export function getSession(): AuthSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const session: AuthSession = JSON.parse(raw)
    if (Date.now() > session.expires) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return session
  } catch {
    return null
  }
}

export function getRole(): Role | null {
  return getSession()?.role ?? null
}

export function isAuthenticated(requiredRole: Role): boolean {
  const session = getSession()
  return session !== null && session.role === requiredRole
}
