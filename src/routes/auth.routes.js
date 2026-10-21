import { Router } from 'express'
import { login, me } from '../controllers/auth.controller.js'
import { requireAdmin } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rateLimit.js'

const router = Router()

router.post('/login', authRateLimit, login)
router.get('/me', requireAdmin, me)

export default router
