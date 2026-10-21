import { pool } from '../config/db.js'

export async function listBannerTemplates(req, res, next) {
  try {
    const [rows] = await pool.query('SELECT * FROM banner_templates ORDER BY created_at ASC')
    res.json(rows)
  } catch (err) {
    next(err)
  }
}

export async function createBannerTemplate(req, res, next) {
  try {
    const { name, preset } = req.body
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' })
    if (!preset || typeof preset !== 'object') return res.status(400).json({ error: 'preset is required' })

    const [result] = await pool.query('INSERT INTO banner_templates (name, preset_json) VALUES (?, ?)', [
      name.trim(),
      JSON.stringify(preset),
    ])
    const [rows] = await pool.query('SELECT * FROM banner_templates WHERE id = ?', [result.insertId])
    res.status(201).json(rows[0])
  } catch (err) {
    next(err)
  }
}

export async function deleteBannerTemplate(req, res, next) {
  try {
    await pool.query('DELETE FROM banner_templates WHERE id = ?', [req.params.id])
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}
