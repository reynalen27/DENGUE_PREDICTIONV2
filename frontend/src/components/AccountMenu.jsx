import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Notice } from './Controls.jsx'
import { useAuth } from '../context/AuthContext.jsx'

/*
 * Surfaces the auth that already exists in AuthContext. Routes stay public --
 * this only puts a face on the session and lets the demo login be exercised
 * from the UI instead of a .http file.
 */
export default function AccountMenu() {
  const { user, login, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
      setPassword('')
      setOpen(false)
    } catch (err) {
      setError(
        err?.response?.status === 401
          ? 'Invalid email or password.'
          : err?.code === 'ERR_NETWORK'
            ? 'No response from the API server on port 4000.'
            : err?.response?.data?.error ?? 'Sign-in failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  const initials = user?.name
    ? user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
    : null

  return (
    <div className="popover-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={user ? `Signed in as ${user.name}` : 'Sign in'}
      >
        {initials
          ? <span className="avatar-initials">{initials}</span>
          : <Icon name="user" size={16} />}
      </button>

      {open && (
        <div className="popover" role="dialog" aria-label="Account">
          {user ? (
            <>
              <div className="popover-head">
                <p className="popover-title">{user.name}</p>
                <p className="popover-sub">{user.email}</p>
                <span className="badge badge-accent" style={{ marginTop: 8 }}>
                  <span className="badge-dot" />
                  {user.role.replace('_', ' ')}
                </span>
              </div>
              <div className="popover-body">
                <button type="button" className="btn btn-secondary" style={{ width: '100%' }} onClick={() => { logout(); setOpen(false) }}>
                  <Icon name="logout" size={15} />
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="popover-head">
                <p className="popover-title">Sign in</p>
                <p className="popover-sub">Required only for write operations.</p>
              </div>
              <form className="popover-body" onSubmit={handleSubmit}>
                <div className="field">
                  <label className="field-label" htmlFor="acct-email">Email</label>
                  <input
                    id="acct-email"
                    className="input"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@dews.local"
                    required
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="acct-pass">Password</label>
                  <input
                    id="acct-pass"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <Notice tone="bad">{error}</Notice>}
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
                <p className="popover-sub">
                  Seeded demo account: <code className="mono">admin@dews.local</code> / <code className="mono">password123</code>
                </p>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}
