import bcrypt from 'bcrypt'
import { pool } from '../config/db.js'
import { env } from '../config/env.js'

async function seedAdmin() {
  const email = env.admin.email
  const password = env.admin.password

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your environment before seeding.')
    process.exit(1)
  }

  const passwordHash = await bcrypt.hash(password, 10)

  await pool.query(
    `INSERT INTO admins (email, password_hash) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [email, passwordHash]
  )

  console.log(`Admin ready: ${email}`)
  process.exit(0)
}

seedAdmin().catch((err) => {
  console.error('Failed to seed admin:', err)
  process.exit(1)
})
