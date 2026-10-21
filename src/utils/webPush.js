import webpush from 'web-push'
import { env } from '../config/env.js'
import { pool } from '../config/db.js'

if (env.vapid.publicKey && env.vapid.privateKey) {
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey)
}

/** Sends `payload` (plain object — JSON-encoded here) to every registered
 * device. A subscription the browser has since revoked comes back as a 404
 * or 410 from the push service — that one row is deleted so it stops being
 * retried forever; any other per-subscription failure is swallowed (best-
 * effort, same reasoning as the rest of this app's notification-adjacent
 * code — a push failing must never take down whatever real action (a sale,
 * a stock update) triggered it). */
export async function sendPushToAllAdmins(payload) {
  if (!env.vapid.publicKey || !env.vapid.privateKey) return

  const [subscriptions] = await pool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions')
  const body = JSON.stringify(payload)

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        )
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]).catch(() => {})
        } else {
          console.error('[webPush] Failed to send to subscription', sub.id, err.message)
        }
      }
    })
  )
}
