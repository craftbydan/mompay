import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { hasMeSession } from '../pages/HomePage'

export function MeGuard({ children }: { children: ReactNode }) {
  if (!hasMeSession()) return <Navigate to="/" replace />
  return <>{children}</>
}
