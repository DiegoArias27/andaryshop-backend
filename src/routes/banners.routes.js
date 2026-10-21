import { Router } from 'express'
import {
  listBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  reorderBanners,
} from '../controllers/banners.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', listBanners)
router.post('/', requireAdmin, createBanner)
router.put('/reorder', requireAdmin, reorderBanners)
router.put('/:id', requireAdmin, updateBanner)
router.delete('/:id', requireAdmin, deleteBanner)

export default router
