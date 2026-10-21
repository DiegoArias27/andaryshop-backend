import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret)
    if (payload.type !== 'admin') {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.admin = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireCustomer(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  try {
    const payload = jwt.verify(token, env.jwt.secret)
    if (payload.type !== 'customer') {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    req.customer = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
