import { useState, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

const ME_SESSION_KEY = 'slip_me_auth'

export function setMeSession() {
  sessionStorage.setItem(ME_SESSION_KEY, '1')
}

export function hasMeSession(): boolean {
  return sessionStorage.getItem(ME_SESSION_KEY) === '1'
}

export function clearMeSession() {
  sessionStorage.removeItem(ME_SESSION_KEY)
}

export function HomePage() {
  const navigate = useNavigate()
  const [showPassword, setShowPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [shaking, setShaking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleMeClick() {
    setShowPassword(true)
    setPassword('')
    setError(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const expected = import.meta.env.VITE_ME_PASSWORD
    if (password === expected) {
      setMeSession()
      navigate('/me')
    } else {
      setError(true)
      setShaking(true)
      setPassword('')
      setTimeout(() => { setShaking(false); inputRef.current?.focus() }, 500)
    }
  }

  return (
    <div className="home-gate">
      <div className="home-card">
        <header className="home-brand">
          <div className="home-logo">
            slip<span className="home-dot">.</span>
          </div>
          <p className="home-tagline">
            Turn receipt photos into a shareable expense report.
          </p>
        </header>

        {!showPassword ? (
          <div className="home-roles" role="group" aria-label="Choose how you use slip">
            <button
              type="button"
              className="home-role-btn"
              onClick={handleMeClick}
            >
              <span className="home-role-label">Me</span>
              <span className="home-role-hint">Upload receipts and build reports</span>
            </button>
            <button
              type="button"
              className="home-role-btn"
              onClick={() => navigate('/mom')}
            >
              <span className="home-role-label">Mom</span>
              <span className="home-role-hint">Open a shared link and approve</span>
            </button>
          </div>
        ) : (
          <form
            className={`home-pw-form ${shaking ? 'shake' : ''}`}
            onSubmit={handleSubmit}
            autoComplete="off"
            aria-labelledby="home-pw-heading"
          >
            <p id="home-pw-heading" className="home-pw-lead">
              Enter the organizer PIN to continue.
            </p>
            <label className="home-pw-label" htmlFor="home-pw-input">
              PIN
            </label>
            <input
              id="home-pw-input"
              ref={inputRef}
              type="password"
              className={`home-pw-input ${error ? 'error' : ''}`}
              placeholder="••••••"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(false) }}
              spellCheck={false}
              aria-invalid={error}
              aria-describedby={error ? 'home-pw-error-msg' : undefined}
              autoComplete="current-password"
            />
            {error && (
              <p id="home-pw-error-msg" className="home-pw-error" role="alert">
                That PIN does not match. Try again.
              </p>
            )}
            <div className="home-pw-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowPassword(false); setError(false) }}
              >
                Back
              </button>
              <button type="submit" className="home-pw-btn">Continue</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
