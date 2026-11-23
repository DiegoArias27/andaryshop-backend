import { Router } from 'express'
import {
  createOrder,
  createPosSale,
  listOrders,
  getOrder,
  getOrderByToken,
  claimOrder,
  listMyOrders,
  updateOrder,
  updateOrderPhone,
  updateOrderPackaging,
  updatePaymentStatus,
  confirmOrder,
  cancelOrder,
  cancelConfirmedOrder,
} from '../controllers/orders.controller.js'
import { requireAdmin, requireCustomer } from '../middleware/auth.js'
import { orderRateLimit } from '../middleware/rateLimit.js'

const router = Router()

// Public — hit right when a customer clicks "Enviar pedido por WhatsApp",
// guest or logged in.
router.post('/', orderRateLimit, createOrder)
// Public too — anyone holding the link (see createOrder's returned token)
// can view that one order's status, no login needed. /:token has its own
// path segment (/public/...) so it never collides with the admin-only
// /:id route below.
router.get('/public/:token', getOrderByToken)
// Logged in, but intentionally NOT requireAdmin — claiming only ever
// touches the one order matching this exact token (see claimOrder).
router.post('/public/:token/claim', requireCustomer, claimOrder)
// A real path segment before /:id below — registered first so Express
// never mistakes "mine" for an :id.
router.get('/mine', requireCustomer, listMyOrders)

router.post('/pos', requireAdmin, createPosSale)
router.get('/', requireAdmin, listOrders)
router.get('/:id', requireAdmin, getOrder)
router.put('/:id', requireAdmin, updateOrder)
router.patch('/:id/phone', requireAdmin, updateOrderPhone)
router.patch('/:id/packaging', requireAdmin, updateOrderPackaging)
router.patch('/:id/payment-status', requireAdmin, updatePaymentStatus)
router.post('/:id/confirm', requireAdmin, confirmOrder)
router.post('/:id/cancel', requireAdmin, cancelOrder)
router.post('/:id/cancel-confirmed', requireAdmin, cancelConfirmedOrder)

export default router
