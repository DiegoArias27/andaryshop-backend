import express from 'express'
import cors from 'cors'
import { env } from './config/env.js'
import authRoutes from './routes/auth.routes.js'
import customersRoutes from './routes/customers.routes.js'
import categoriesRoutes from './routes/categories.routes.js'
import brandsRoutes from './routes/brands.routes.js'
import productsRoutes from './routes/products.routes.js'
import variantsRoutes from './routes/variants.routes.js'
import uploadRoutes from './routes/upload.routes.js'
import collectionsRoutes from './routes/collections.routes.js'
import bannersRoutes from './routes/banners.routes.js'
import bannerTemplatesRoutes from './routes/bannerTemplates.routes.js'
import pageLayoutsRoutes from './routes/pageLayouts.routes.js'
import packagesTileRoutes from './routes/packagesTile.routes.js'
import wholesaleRoutes from './routes/wholesale.routes.js'
import ordersRoutes from './routes/orders.routes.js'
import returnsRoutes from './routes/returns.routes.js'
import cashCutsRoutes from './routes/cashCuts.routes.js'
import settingsRoutes from './routes/settings.routes.js'
import notificationsRoutes from './routes/notifications.routes.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'
import { startCashCutScheduler } from './jobs/cashCutScheduler.js'
import { startNotificationScheduler } from './jobs/notificationScheduler.js'

const app = express()

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.allowedOrigins.includes(origin)) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }
    },
  })
)
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRoutes)
app.use('/api/customers', customersRoutes)
app.use('/api/categories', categoriesRoutes)
app.use('/api/brands', brandsRoutes)
app.use('/api/products', productsRoutes)
app.use('/api/variants', variantsRoutes)
app.use('/api/uploads', uploadRoutes)
app.use('/api/collections', collectionsRoutes)
app.use('/api/banners', bannersRoutes)
app.use('/api/banner-templates', bannerTemplatesRoutes)
app.use('/api/page-layouts', pageLayoutsRoutes)
app.use('/api/packages-tile', packagesTileRoutes)
app.use('/api/wholesale-tiers', wholesaleRoutes)
app.use('/api/orders', ordersRoutes)
app.use('/api/returns', returnsRoutes)
app.use('/api/cash-cuts', cashCutsRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/notifications', notificationsRoutes)

app.use(notFoundHandler)
app.use(errorHandler)

app.listen(env.port, () => {
  console.log(`ANDARY SHOP API listening on port ${env.port}`)
  startCashCutScheduler()
  startNotificationScheduler()
})
