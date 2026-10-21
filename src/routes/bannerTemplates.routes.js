import { Router } from 'express'
import { listBannerTemplates, createBannerTemplate, deleteBannerTemplate } from '../controllers/bannerTemplates.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAdmin, listBannerTemplates)
router.post('/', requireAdmin, createBannerTemplate)
router.delete('/:id', requireAdmin, deleteBannerTemplate)

export default router
