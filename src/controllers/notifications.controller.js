import { pool } from '../config/db.js'
import { env } from '../config/env.js'
import { sendPushToAllAdmins } from '../utils/webPush.js'

export async function getVapidPublicKey(req, res) {
  res.json({ publicKey: env.vapid.publicKey })
}

export async function subscribe(req, res, next) {
  try {
    const { endpoint, keys } = req.body
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'endpoint and keys.p256dh/auth are required' })
    }
    await pool.query(
      `INSERT INTO push_subscriptions (admin_email, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE p256dh = VALUES(p256dh), auth = VALUES(auth), admin_email = VALUES(admin_email)`,
      [req.admin?.email ?? null, endpoint, keys.p256dh, keys.auth]
    )
    res.status(201).json({ ok: true })
  } catch (err) {
    next(err)
  }
}

export async function unsubscribe(req, res, next) {
  try {
    const { endpoint } = req.body
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' })
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint])
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function listNotifications(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    const offset = Math.max(0, Number(req.query.offset) || 0)
    const [rows] = await pool.query(
      `SELECT n.*, p.name AS product_name, p.slug AS product_slug,
              COALESCE(p.main_thumb_url, p.main_image_url) AS product_image_url
       FROM notifications n
       LEFT JOIN products p ON p.id = n.product_id
       ORDER BY n.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    )
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM notifications')
    const [[{ unread }]] = await pool.query('SELECT COUNT(*) AS unread FROM notifications WHERE read_at IS NULL')
    res.json({ rows, unread, total })
  } catch (err) {
    next(err)
  }
}

export async function markNotificationRead(req, res, next) {
  try {
    const { id } = req.params
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE id = ? AND read_at IS NULL', [id])
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

export async function markAllNotificationsRead(req, res, next) {
  try {
    await pool.query('UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL')
    res.status(204).send()
  } catch (err) {
    next(err)
  }
}

/** Shared by the stock-alert scheduler and the cash-cut scheduler — inserts
 * the notification row and fans it out as a push in one step, so a new
 * trigger point never forgets one half of it. */
export async function createNotification({ type, title, body, productId = null }) {
  const [result] = await pool.query(
    'INSERT INTO notifications (type, title, body, product_id) VALUES (?, ?, ?, ?)',
    [type, title, body, productId]
  )
  await sendPushToAllAdmins({ title, body, notificationId: result.insertId }).catch((err) =>
    console.error('[notifications] push failed', err)
  )
  return result.insertId
}
