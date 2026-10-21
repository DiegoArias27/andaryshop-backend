import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { pool } from '../config/db.js'
import { env } from '../config/env.js'

export async function login(req, res, next) {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ? LIMIT 1', [email])
    const admin = rows[0]

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const passwordMatches = await bcrypt.compare(password, admin.password_hash)
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign(
      { sub: admin.id, email: admin.email, type: 'admin' },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    )

    res.json({ token, admin: { id: admin.id, email: admin.email } })
  } catch (err) {
    next(err)
  }
}

export async function me(req, res) {
  res.json({ admin: req.admin })
}
