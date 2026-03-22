import { useState, useCallback } from 'react'
import { login, logout, getRole, isAuthenticated } from '../lib/auth'
import type { Role } from '../types'

export function useAuth() {
  const [role, setRole] = useState<Role | null>(getRole)

  const signIn = useCallback((targetRole: Role, password: string): boolean => {
    const ok = login(targetRole, password)
    if (ok) setRole(targetRole)
    return ok
  }, [])

  const signOut = useCallback(() => {
    logout()
    setRole(null)
  }, [])

  return {
    role,
    isAuthenticated: (r: Role) => isAuthenticated(r),
    signIn,
    signOut,
  }
}
