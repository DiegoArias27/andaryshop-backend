import { Router } from 'express'
import { listTags, createTag, deleteTag } from '../controllers/tags.controller.js'
import { requireAdmin } from '../middleware/auth.js'

const router = Router()

router.get('/', listTags)
router.post('/', requireAdmin, createTag)
router.delete('/:id', requireAdmin, deleteTag)

export default router
