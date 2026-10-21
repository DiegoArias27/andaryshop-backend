import { Router } from 'express'
import { getSettings, updateSettings } from '../controllers/settings.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAdmin, getSettings)
router.put('/', requireAdmin, updateSettings)

export default router
