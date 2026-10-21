import { pool } from '../config/db.js'
import { slugify } from '../utils/slugify.js'
import { deleteR2ObjectByUrl } from '../utils/r2Cleanup.js'

export async function listCategories(req, res, next) {
  try {
    // has_stock: whether any active product in this category still has any
    // variant with stock > 0 — the storefront (catalog filter pills) and the
    // Cotizador both treat a category as effectively hidden once this goes
    // false, same as a manually unchecked show_in_nav, without the admin
    // having to remember to toggle anything by hand as stock runs out (and
    // it un-hides itself automatically the moment stock comes back).
    const [rows] = await pool.query(`
      SELECT c.*,
        EXISTS (
          SELECT 1 FROM products p
          JOIN product_variants pv ON pv.product_id = p.id
          WHERE p.category_id = c.id AND p.is_active = 1 AND pv.stock > 0
        ) AS has_stock
      FROM categories c
      ORDER BY c.sort_order ASC, c.name ASC
    `)
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function createCategory(req, res, next) {
  try {
    const { name, imageUrl, tagline, imageFocusX = 50, imageFocusY = 50, imageZoom = null, scrimOpacity = null } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    const slug = slugify(name)
    const [[{ maxOrder }]] = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM categories')
    const [result] = await pool.query(
      'INSERT INTO categories (name, slug, image_url, tagline, image_focus_x, image_focus_y, image_zoom, scrim_opacity, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, slug, imageUrl || null, tagline || null, imageFocusX, imageFocusY, imageZoom, scrimOpacity, maxOrder + 1]
    )

    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function updateCategory(req, res, next) {
  try {
    const { id } = req.params
    const { name, imageUrl, tagline, sortOrder, imageFocusX, imageFocusY, imageZoom, scrimOpacity, showInNav } = req.body

    // Partial update — a drag-reorder save only sends sortOrder, a rename
    // only sends name, etc., so each field is applied only when present.
    const fields = []
    const values = []
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: 'name is required' })
      fields.push('name = ?', 'slug = ?')
      values.push(name, slugify(name))
    }
    if (imageUrl !== undefined) {
      fields.push('image_url = ?')
      values.push(imageUrl || null)
    }
    if (tagline !== undefined) {
      fields.push('tagline = ?')
      values.push(tagline || null)
    }
    if (sortOrder !== undefined) {
      fields.push('sort_order = ?')
      values.push(sortOrder)
    }
    if (imageFocusX !== undefined) {
      fields.push('image_focus_x = ?')
      values.push(imageFocusX)
    }
    if (imageFocusY !== undefined) {
      fields.push('image_focus_y = ?')
      values.push(imageFocusY)
    }
    if (imageZoom !== undefined) {
      fields.push('image_zoom = ?')
      values.push(imageZoom)
    }
    if (scrimOpacity !== undefined) {
      fields.push('scrim_opacity = ?')
      values.push(scrimOpacity)
    }
    if (showInNav !== undefined) {
      fields.push('show_in_nav = ?')
      values.push(showInNav ? 1 : 0)
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' })

    // Read the old image before overwriting it, so a replaced/removed photo
    // doesn't linger in R2 forever.
    let oldImageUrl = null
    if (imageUrl !== undefined) {
      const [existing] = await pool.query('SELECT image_url FROM categories WHERE id = ?', [id])
      oldImageUrl = existing[0]?.image_url ?? null
    }

    const [result] = await pool.query(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`, [...values, id])

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' })
    }

    if (oldImageUrl && oldImageUrl !== imageUrl) await deleteR2ObjectByUrl(oldImageUrl)

    const [rows] = await pool.query('SELECT * FROM categories WHERE id = ?', [id])
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteCategory(req, res, next) {
  try {
    const { id } = req.params
    const [existing] = await pool.query('SELECT image_url FROM categories WHERE id = ?', [id])

    let result
    try {
      ;[result] = await pool.query('DELETE FROM categories WHERE id = ?', [id])
    } catch (err) {
      if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.code === 'ER_ROW_IS_REFERENCED') {
        return res.status(409).json({
          error: 'No se puede eliminar: esta categoría se usa en un paquete combinado. Quita esa parte primero.',
        })
      }
      throw err
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' })
    }

    if (existing[0]?.image_url) await deleteR2ObjectByUrl(existing[0].image_url)

    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
