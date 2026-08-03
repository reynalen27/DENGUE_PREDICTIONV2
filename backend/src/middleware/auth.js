import jwt from 'jsonwebtoken'

// Returns the decoded token payload, or null if missing/invalid.
// Controllers call this explicitly (no Express middleware chain available).
export function getAuthUser(req) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length)
  try {
    return jwt.verify(token, process.env.JWT_SECRET || 'change_this_secret')
  } catch {
    return null
  }
}

export function requireRole(req, res, ...roles) {
  const user = getAuthUser(req)
  if (!user || (roles.length && !roles.includes(user.role))) {
    return null
  }
  return user
}
