import { Router } from 'express'
import {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  addCollectionProduct,
  reorderCollectionProducts,
  updateCollectionProductDiscount,
  removeCollectionProduct,
} from '../controllers/collections.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', listCollections)
router.get('/:id', getCollection)
router.post('/', requireAdmin, createCollection)
router.put('/:id', requireAdmin, updateCollection)
router.delete('/:id', requireAdmin, deleteCollection)
router.post('/:id/products', requireAdmin, addCollectionProduct)
router.put('/:id/products/reorder', requireAdmin, reorderCollectionProducts)
router.put('/:id/products/:productId', requireAdmin, updateCollectionProductDiscount)
router.delete('/:id/products/:productId', requireAdmin, removeCollectionProduct)

export default router
