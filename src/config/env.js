import 'dotenv/config'

function required(name, fallback) {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const adminUrl = process.env.ADMIN_URL || 'http://localhost:5174'

// Railway (and most hosts) offer the DB as one connection string instead of
// separate host/user/password fields — DATABASE_URL, set to
// `${{ MySQL.MYSQL_PRIVATE_URL }}` in the service's Variables tab, is
// parsed here so deploys don't need five separate variables wired by hand.
// Local dev keeps using the plain DB_HOST/DB_USER/etc. vars below.
function dbConfigFromUrl(databaseUrl) {
  const u = new URL(databaseUrl)
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    name: u.pathname.replace(/^\//, ''),
  }
}

export const env = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl,
  // Comma-separated values in FRONTEND_URL/ADMIN_URL are supported for
  // multi-domain setups (e.g. staging + production storefront URLs).
  allowedOrigins: [frontendUrl, adminUrl]
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean),

  db: process.env.DATABASE_URL
    ? dbConfigFromUrl(process.env.DATABASE_URL)
    : {
        host: required('DB_HOST', 'localhost'),
        port: Number(process.env.DB_PORT || 3306),
        user: required('DB_USER', 'root'),
        password: process.env.DB_PASSWORD || '',
        name: required('DB_NAME', 'andary_shop'),
      },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
    customerExpiresIn: process.env.CUSTOMER_JWT_EXPIRES_IN || '30d',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
  },

  admin: {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucketName: process.env.R2_BUCKET_NAME || '',
    publicUrl: process.env.R2_PUBLIC_URL || '',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:designard03@gmail.com',
  },
}
