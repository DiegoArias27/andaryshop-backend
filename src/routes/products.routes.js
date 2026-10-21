import { Router } from 'express'
import {
  listProducts,
  getProductBySlug,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  addProductImages,
  updateProductImage,
  reorderProductImages,
  deleteProductImage,
  bulkUpdateDiscount,
} from '../controllers/products.controller.js'
import {
  addVariant,
  updateVariant,
  deleteVariant,
} from '../controllers/variants.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', listProducts)
router.patch('/bulk-discount', requireAdmin, bulkUpdateDiscount)
router.delete('/bulk', requireAdmin, bulkDeleteProducts)
router.get('/slug/:slug', getProductBySlug)
router.get('/:id', getProductById)
router.post('/', requireAdmin, createProduct)
router.put('/:id', requireAdmin, updateProduct)
router.delete('/:id', requireAdmin, deleteProduct)

router.post('/:id/images', requireAdmin, addProductImages)
router.put('/:id/images/reorder', requireAdmin, reorderProductImages)
router.put('/images/:imageId', requireAdmin, updateProductImage)
router.delete('/images/:imageId', requireAdmin, deleteProductImage)

router.post('/:id/variants', requireAdmin, addVariant)
router.put('/variants/:variantId', requireAdmin, updateVariant)
router.delete('/variants/:variantId', requireAdmin, deleteVariant)

export default router
