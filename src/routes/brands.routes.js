import { Router } from 'express'
import {
  listBrands,
  createBrand,
  updateBrand,
  deleteBrand,
} from '../controllers/brands.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', listBrands)
router.post('/', requireAdmin, createBrand)
router.put('/:id', requireAdmin, updateBrand)
router.delete('/:id', requireAdmin, deleteBrand)

export default router
