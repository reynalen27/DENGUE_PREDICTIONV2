import { createContext, useContext, useState } from 'react'
import { authApi } from '../services/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('dews_user')
    return saved ? JSON.parse(saved) : null
  })

  async function login(email, password) {
    const { token, user: loggedInUser } = await authApi.login(email, password)
    localStorage.setItem('dews_token', token)
    localStorage.setItem('dews_user', JSON.stringify(loggedInUser))
    setUser(loggedInUser)
    return loggedInUser
  }

  function logout() {
    localStorage.removeItem('dews_token')
    localStorage.removeItem('dews_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
