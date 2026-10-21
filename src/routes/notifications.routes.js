import { Router } from 'express'
import {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notifications.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/vapid-public-key', requireAdmin, getVapidPublicKey)
router.post('/subscribe', requireAdmin, subscribe)
router.post('/unsubscribe', requireAdmin, unsubscribe)
router.get('/', requireAdmin, listNotifications)
router.post('/:id/read', requireAdmin, markNotificationRead)
router.post('/read-all', requireAdmin, markAllNotificationsRead)

export default router
