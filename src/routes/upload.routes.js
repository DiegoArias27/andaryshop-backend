import { Router } from 'express'
import { uploadImage, deleteImage, listMedia } from '../controllers/upload.controller.js'
import { requireAdmin } from '../middleware/auth.js'
import { upload } from '../middleware/upload.js'

const router = Router()

router.post('/', requireAdmin, upload.single('image'), uploadImage)
router.delete('/', requireAdmin, deleteImage)
router.get('/', requireAdmin, listMedia)

export default router
