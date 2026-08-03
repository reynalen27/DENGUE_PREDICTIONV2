import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../config/db.js'
import { sendJson, readJsonBody } from '../utils/http.js'

export async function login(req, res) {
  const { email, password } = await readJsonBody(req)
  if (!email || !password) {
    return sendJson(res, 400, { error: 'email and password are required' })
  }

  const users = await query('SELECT id, name, email, password_hash, role FROM users WHERE email = :email', { email })
  const user = users[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return sendJson(res, 401, { error: 'Invalid credentials' })
  }

  const token = jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET || 'change_this_secret',
    { expiresIn: '8h' },
  )

  sendJson(res, 200, {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  })
}
