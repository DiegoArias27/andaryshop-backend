import { Router } from 'express'
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categories.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', listCategories)
router.post('/', requireAdmin, createCategory)
router.put('/:id', requireAdmin, updateCategory)
router.delete('/:id', requireAdmin, deleteCategory)

export default router
