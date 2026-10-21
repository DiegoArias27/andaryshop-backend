import { pool } from '../config/db.js'
import { slugify } from '../utils/slugify.js'

export async function listBrands(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM brands ORDER BY name ASC')
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function createBrand(req, res, next) {
  try {
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const slug = slugify(name)
    const [result] = await pool.query(
      'INSERT INTO brands (name, slug) VALUES (?, ?)',
      [name, slug]
    )

    const [rows] = await pool.query('SELECT * FROM brands WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateBrand(req, res, next) {
  try {
    const { id } = req.params
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const slug = slugify(name)
    const [result] = await pool.query(
      'UPDATE brands SET name = ?, slug = ? WHERE id = ?',
      [name, slug, id]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Brand not found' })
    }

    const [rows] = await pool.query('SELECT * FROM brands WHERE id = ?', [id])
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteBrand(req, res, next) {
  try {
    const { id } = req.params
    const [result] = await pool.query('DELETE FROM brands WHERE id = ?', [id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Brand not found' })
    }

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
