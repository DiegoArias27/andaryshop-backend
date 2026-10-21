import jwt from 'jsonwebtoken'
import { pool } from '../config/db.js'
import { env } from '../config/env.js'

const PUBLIC_FIELDS = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  // Applied automatically to the cart total on the storefront (see
  // frontend/src/utils/pricing.ts) — same "cliente frecuente" discount a
  // WhatsApp order already gets server-side, just also visible up front now.
  discountAmount: c.discount_amount ? Number(c.discount_amount) : 0,
  createdAt: c.created_at,
})

function issueToken(customer) {
  return jwt.sign(
    { sub: customer.id, type: 'customer' },
    env.jwt.secret,
    { expiresIn: env.jwt.customerExpiresIn }
  )
}

export async function googleLogin(req, res, next) {
  try {
    const { idToken } = req.body
    if (!idToken) return res.status(400).json({ error: 'idToken is required' })
    if (!env.google.clientId) {
      return res.status(503).json({ error: 'El inicio de sesión con Google no está configurado' })
    }

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`)
    if (!verifyRes.ok) {
      return res.status(401).json({ error: 'Token de Google inválido' })
    }
    const payload = await verifyRes.json()

    if (payload.aud !== env.google.clientId) {
      return res.status(401).json({ error: 'Token de Google inválido' })
    }

    const googleId = payload.sub
    const email = payload.email ? String(payload.email).trim().toLowerCase() : null
    const name = payload.name || email || 'Cliente'

    let [rows] = await pool.query('SELECT * FROM customers WHERE google_id = ? LIMIT 1', [googleId])
    let customer = rows[0]

    if (!customer && email) {
      ;[rows] = await pool.query('SELECT * FROM customers WHERE email = ? LIMIT 1', [email])
      customer = rows[0]
      if (customer) {
        await pool.query('UPDATE customers SET google_id = ? WHERE id = ?', [googleId, customer.id])
      }
    }

    if (!customer) {
      const [result] = await pool.query(
        'INSERT INTO customers (name, email, google_id) VALUES (?, ?, ?)',
        [name, email, googleId]
      )
      ;[rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [result.insertId])
      customer = rows[0]
    }

    res.json({ token: issueToken(customer), customer: PUBLIC_FIELDS(customer) })
  } catch (err) {
    next(err)
  }
}

export async function me(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.customer.sub])
    if (rows.length === 0) return res.status(404).json({ error: 'Customer not found' })
    res.json({ customer: PUBLIC_FIELDS(rows[0]) })
  } catch (err) {
    next(err)
  }
}

const DEFAULT_CATALOG_FILTERS = { sizes: [], brands: [], sizesTouched: false }

export async function getData(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT cart_json, favorites_json, size_preferences_json, quotes_json, catalog_filters_json FROM customer_data WHERE customer_id = ?',
      [req.customer.sub]
    )
    if (rows.length === 0) {
      return res.json({ cart: [], favorites: [], sizePreferences: {}, quotes: [], catalogFilters: DEFAULT_CATALOG_FILTERS })
    }
    res.json({
      cart: rows[0].cart_json ?? [],
      favorites: rows[0].favorites_json ?? [],
      sizePreferences: rows[0].size_preferences_json ?? {},
      quotes: rows[0].quotes_json ?? [],
      catalogFilters: rows[0].catalog_filters_json ?? DEFAULT_CATALOG_FILTERS,
    })
  } catch (err) {
    next(err)
  }
}

const ADMIN_FIELDS = (c) => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  discount_amount: c.discount_amount,
  created_at: c.created_at,
})

export async function listCustomersAdmin(req, res, next) {
  try {
    const { search } = req.query
    const where = []
    const params = []
    if (search) {
      where.push('(name LIKE ? OR email LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const [rows] = await pool.query(
      `SELECT * FROM customers ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`,
      params
    )
    res.json(rows.map(ADMIN_FIELDS))
  } catch (err) {
    next(err)
  }
}

// Lets the admin set up a "cliente frecuente" discount for an email BEFORE
// that person ever logs in — googleLogin() already links an existing email
// row to the new google_id instead of creating a duplicate, so this record
// gets "claimed" automatically the first time they actually sign in.
export async function createCustomerAdmin(req, res, next) {
  try {
    const { name, email, phone = null, discountAmount = 0 } = req.body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const [existing] = await pool.query('SELECT id FROM customers WHERE email = ?', [email])
    if (existing.length > 0) return res.status(409).json({ error: 'Ya existe un cliente con ese correo' })

    const [result] = await pool.query(
      'INSERT INTO customers (name, email, phone, discount_amount) VALUES (?, ?, ?, ?)',
      [name || email, email, phone || null, discountAmount]
    )
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [result.insertId])
    res.status(201).json(ADMIN_FIELDS(rows[0]))
  } catch (err) {
    next(err)
  }
}

export async function updateCustomerAdmin(req, res, next) {
  try {
    const { id } = req.params
    const { name, phone, discountAmount } = req.body

    const fields = []
    const params = []
    if (name !== undefined) { fields.push('name = ?'); params.push(name) }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone || null) }
    if (discountAmount !== undefined) { fields.push('discount_amount = ?'); params.push(discountAmount) }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' })

    params.push(id)
    const [result] = await pool.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, params)
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Customer not found' })

    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [id])
    res.json(ADMIN_FIELDS(rows[0]))
  } catch (err) {
    next(err)
  }
}

export async function saveData(req, res, next) {
  try {
    const { cart, favorites, sizePreferences = {}, quotes = [], catalogFilters = DEFAULT_CATALOG_FILTERS } = req.body
    if (!Array.isArray(cart) || !Array.isArray(favorites) || !Array.isArray(quotes)) {
      return res.status(400).json({ error: 'cart, favorites y quotes deben ser arreglos' })
    }
    if (typeof sizePreferences !== 'object' || sizePreferences === null || Array.isArray(sizePreferences)) {
      return res.status(400).json({ error: 'sizePreferences debe ser un objeto' })
    }
    if (
      typeof catalogFilters !== 'object' ||
      catalogFilters === null ||
      !Array.isArray(catalogFilters.sizes) ||
      !Array.isArray(catalogFilters.brands)
    ) {
      return res.status(400).json({ error: 'catalogFilters debe tener sizes y brands como arreglos' })
    }
    await pool.query(
      `INSERT INTO customer_data (customer_id, cart_json, favorites_json, size_preferences_json, quotes_json, catalog_filters_json) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE cart_json = VALUES(cart_json), favorites_json = VALUES(favorites_json), size_preferences_json = VALUES(size_preferences_json), quotes_json = VALUES(quotes_json), catalog_filters_json = VALUES(catalog_filters_json)`,
      [
        req.customer.sub,
        JSON.stringify(cart),
        JSON.stringify(favorites),
        JSON.stringify(sizePreferences),
        JSON.stringify(quotes),
        JSON.stringify(catalogFilters),
      ]
    )
    res.json({ cart, favorites, sizePreferences, quotes, catalogFilters })
  } catch (err) {
    next(err)
  }
}
