import { Router } from 'express'
import {
  createOrder,
  createPosSale,
  listOrders,
  getOrder,
  updateOrder,
  updateOrderPhone,
  updateOrderPackaging,
  confirmOrder,
  cancelOrder,
  cancelConfirmedOrder,
} from '../controllers/orders.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

// Public — hit right when a customer clicks "Enviar pedido por WhatsApp",
// guest or logged in.
router.post('/', createOrder)

router.post('/pos', requireAdmin, createPosSale)
router.get('/', requireAdmin, listOrders)
router.get('/:id', requireAdmin, getOrder)
router.put('/:id', requireAdmin, updateOrder)
router.patch('/:id/phone', requireAdmin, updateOrderPhone)
router.patch('/:id/packaging', requireAdmin, updateOrderPackaging)
router.post('/:id/confirm', requireAdmin, confirmOrder)
router.post('/:id/cancel', requireAdmin, cancelOrder)
router.post('/:id/cancel-confirmed', requireAdmin, cancelConfirmedOrder)

export default router
