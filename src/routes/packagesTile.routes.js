import { Router } from 'express'
import { getPackagesTile, updatePackagesTile } from '../controllers/packagesTile.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', getPackagesTile)
router.put('/', requireAdmin, updatePackagesTile)

export default router
