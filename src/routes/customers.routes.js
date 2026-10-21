import { Router } from 'express'
import {
  googleLogin,
  me,
  getData,
  saveData,
  listCustomersAdmin,
  createCustomerAdmin,
  updateCustomerAdmin,
} from '../controllers/customers.controller.js'
import { requireAdmin, requireCustomer } from '../middleware/auth.js'
import { authRateLimit } from '../middleware/rateLimit.js'

const router = Router()

router.post('/google', authRateLimit, googleLogin)
router.get('/me', requireCustomer, me)
router.get('/data', requireCustomer, getData)
router.put('/data', requireCustomer, saveData)

router.get('/admin', requireAdmin, listCustomersAdmin)
router.post('/admin', requireAdmin, createCustomerAdmin)
router.put('/admin/:id', requireAdmin, updateCustomerAdmin)

export default router
