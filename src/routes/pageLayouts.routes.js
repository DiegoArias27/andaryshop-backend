import { Router } from 'express'
import { getPageLayout, updatePageLayout } from '../controllers/pageLayouts.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/:page', getPageLayout)
router.put('/:page', requireAdmin, updatePageLayout)

export default router
