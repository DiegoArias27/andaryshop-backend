import { Router } from 'express'
import {
  getVariantByBarcode,
  adjustStockByBarcode,
  getRestockHistory,
} from '../controllers/variants.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

// Barcode-based stock lookups/adjustments, used by the admin stock scanner.
router.get('/barcode/:barcode', requireAdmin, getVariantByBarcode)
router.patch('/barcode/:barcode/stock', requireAdmin, adjustStockByBarcode)
router.get('/restocks', requireAdmin, getRestockHistory)

export default router
