import { Router } from 'express'
import { listReturns, createReturn, updateReturn } from '../controllers/returns.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAdmin, listReturns)
router.post('/', requireAdmin, createReturn)
router.patch('/:id', requireAdmin, updateReturn)

export default router
