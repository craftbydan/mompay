import { useState, type FormEvent } from 'react'
import type { Role } from '../types'

interface LoginGateProps {
  role: Role
  onSuccess: () => void
  signIn: (role: Role, password: string) => boolean
}

export function LoginGate({ role, onSuccess, signIn }: LoginGateProps) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [shaking, setShaking] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const ok = signIn(role, password)
    if (ok) {
      onSuccess()
    } else {
      setError(true)
      setShaking(true)
      setPassword('')
      setTimeout(() => setShaking(false), 500)
    }
  }

  const label = role === 'me' ? 'My Dashboard' : 'Mom\'s View'

  return (
    <div className="login-gate">
      <div className={`login-card ${shaking ? 'shake' : ''}`}>
        <div className="login-logo">
          <span className="logo-text">slip</span>
          <span className="logo-dot">.</span>
        </div>
        <p className="login-label">{label}</p>
        <form onSubmit={handleSubmit} autoComplete="off">
          <input
            type="password"
            value={password}
            onChange={e => {
              setPassword(e.target.value)
              setError(false)
            }}
            placeholder="password"
            autoFocus
            className={`login-input ${error ? 'error' : ''}`}
            spellCheck={false}
          />
          {error && <p className="login-error">incorrect password</p>}
          <button type="submit" className="login-btn">
            enter
          </button>
        </form>
      </div>
    </div>
  )
}
