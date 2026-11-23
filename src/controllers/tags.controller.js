import { pool } from '../config/db.js'
import { slugify } from '../utils/slugify.js'

/** Public — the storefront needs the full tag catalog nowhere right now
 * (a product already carries its own tags, see products.controller.js's
 * attachRelations), but the admin's tag picker does, and there's nothing
 * sensitive in a tag's name. */
export async function listTags(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM tags ORDER BY name ASC')
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function createTag(req, res, next) {
  try {
    const { name } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' })

    const slug = slugify(name.trim())
    const [existing] = await pool.query('SELECT * FROM tags WHERE slug = ? LIMIT 1', [slug])
    // Reuses the existing tag instead of rejecting a near-duplicate name
    // outright (e.g. "oferta" vs "Oferta") — simplest way to keep the
    // catalog from accumulating near-identical rows.
    if (existing.length > 0) return res.status(201).json(existing[0])

    const [result] = await pool.query('INSERT INTO tags (name, slug) VALUES (?, ?)', [name.trim(), slug])
    const [rows] = await pool.query('SELECT * FROM tags WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteTag(req, res, next) {
  try {
    const { id } = req.params
    // product_tags rows cascade automatically (ON DELETE CASCADE) — every
    // product currently wearing this tag just loses it.
    const [result] = await pool.query('DELETE FROM tags WHERE id = ?', [id])
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tag not found' })
    res.status(204).end()
  } catch (err) {
    next(err)
  }
}
