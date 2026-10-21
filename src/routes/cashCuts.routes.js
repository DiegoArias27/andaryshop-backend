import { Router } from 'express'
import { listCashCuts, createCashCut, getCashCutSettings, updateCashCutSettings } from '../controllers/cashCuts.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAdmin, listCashCuts)
router.post('/', requireAdmin, createCashCut)
router.get('/settings', requireAdmin, getCashCutSettings)
router.put('/settings', requireAdmin, updateCashCutSettings)

export default router
