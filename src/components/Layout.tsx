import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Role } from '../types'
import { clearMeSession } from '../pages/HomePage'

interface LayoutProps {
  children: ReactNode
  role?: Role
}

export function Layout({ children, role }: LayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="topbar-logo-btn"
            aria-label="Slip home"
            onClick={() => { if (role === 'me') clearMeSession(); navigate('/') }}
          >
            slip<span className="topbar-dot">.</span>
          </button>
          {role === 'me' && (
            <nav className="topbar-nav" aria-label="Organizer">
              <Link
                to="/me"
                className={`topbar-navlink ${location.pathname === '/me' ? 'active' : ''}`}
              >
                Reports
              </Link>
              <Link
                to="/me/merchants"
                className={`topbar-navlink ${location.pathname === '/me/merchants' ? 'active' : ''}`}
              >
                Merchants
              </Link>
            </nav>
          )}
        </div>
        {role && (
          <div className="topbar-right">
            <span
              className="topbar-role"
              title={role === 'me' ? 'You are signed in as the organizer' : 'Reviewer view'}
            >
              {role === 'me' ? 'Organizer' : 'Reviewer'}
            </span>
            <button
              type="button"
              className="topbar-signout"
              onClick={() => {
                if (role === 'me') clearMeSession()
                navigate('/')
              }}
            >
              Exit to home
            </button>
          </div>
        )}
      </header>
      <main className="main-content">{children}</main>
    </div>
  )
}
