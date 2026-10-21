import { pool } from '../config/db.js'
import { deleteR2ObjectByUrl } from '../utils/r2Cleanup.js'

const SELECT_FIELDS = 'image_url, tagline, image_focus_x, image_focus_y, image_zoom, scrim_opacity'

export async function getPackagesTile(req, res, next) {
  try {
    const [rows] = await pool.query(`SELECT ${SELECT_FIELDS} FROM packages_tile WHERE id = 1`)
    res.json(
      rows[0] ?? {
        image_url: null,
        tagline: null,
        image_focus_x: 50,
        image_focus_y: 50,
        image_zoom: null,
        scrim_opacity: null,
      }
    )
  } catch (err) {
    next(err)
  }
}

export async function updatePackagesTile(req, res, next) {
  try {
    const { imageUrl = null, tagline = null, imageFocusX = 50, imageFocusY = 50, imageZoom = null, scrimOpacity = null } = req.body

    const [existing] = await pool.query('SELECT image_url FROM packages_tile WHERE id = 1')
    const oldImageUrl = existing[0]?.image_url ?? null

    await pool.query(
      `INSERT INTO packages_tile (id, image_url, tagline, image_focus_x, image_focus_y, image_zoom, scrim_opacity)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE image_url = VALUES(image_url), tagline = VALUES(tagline),
         image_focus_x = VALUES(image_focus_x), image_focus_y = VALUES(image_focus_y), image_zoom = VALUES(image_zoom),
         scrim_opacity = VALUES(scrim_opacity)`,
      [imageUrl, tagline, imageFocusX, imageFocusY, imageZoom, scrimOpacity]
    )

    if (oldImageUrl && oldImageUrl !== imageUrl) await deleteR2ObjectByUrl(oldImageUrl)

    const [rows] = await pool.query(`SELECT ${SELECT_FIELDS} FROM packages_tile WHERE id = 1`)
    res.json(rows[0])
  } catch (err) {
    next(err)
  }
}
