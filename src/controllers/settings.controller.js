import { pool } from '../config/db.js'

const NUMERIC_FIELDS = [
  'labelWidthMm',
  'labelHeightMm',
  'lowStockThreshold',
  'bestsellerMinQty',
  'bestsellerLimit',
]

const FIELD_TO_COLUMN = {
  labelWidthMm: 'label_width_mm',
  labelHeightMm: 'label_height_mm',
  lowStockThreshold: 'low_stock_threshold',
  bestsellerMinQty: 'bestseller_min_qty',
  bestsellerLimit: 'bestseller_limit',
}

export async function getSettings(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM app_settings WHERE id = 1')
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateSettings(req, res, next) {
  try {
    const fields = []
    const params = []
    for (const key of NUMERIC_FIELDS) {
      const value = req.body[key]
      if (value === undefined) continue
      if (!Number.isInteger(value) || value < 1) {
        return res.status(400).json({ error: `${key} debe ser un entero positivo` })
      }
      fields.push(`${FIELD_TO_COLUMN[key]} = ?`)
      params.push(value)
    }

    if (fields.length > 0) {
      await pool.query(`UPDATE app_settings SET ${fields.join(', ')} WHERE id = 1`, params)
    }

    const [rows] = await pool.query('SELECT * FROM app_settings WHERE id = 1')
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}
