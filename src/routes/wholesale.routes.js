import { Router } from 'express'
import { listTiers, createTier, updateTier, deleteTier } from '../controllers/wholesale.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

// Public GET so the storefront cart can compute bulk pricing without auth.
router.get('/', listTiers)
router.post('/', requireAdmin, createTier)
router.put('/:id', requireAdmin, updateTier)
router.delete('/:id', requireAdmin, deleteTier)

export default router
