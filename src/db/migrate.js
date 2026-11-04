import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

// A dedicated, one-off connection (not the shared pool from db.js) — this is
// the only place `multipleStatements` is ever needed, and turning it on for
// the app's normal pool would widen the SQL-injection surface for no reason.
async function migrate() {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')

  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.name,
    multipleStatements: true,
  })

  try {
    await connection.query(schema)
    console.log('Schema applied.')
  } catch (err) {
    // Tables are all `CREATE TABLE IF NOT EXISTS` (safe to re-run), but the
    // indexes further down aren't — hitting this specifically just means
    // the schema was already applied in full on an earlier run.
    if (err.code === 'ER_DUP_KEYNAME') {
      console.log('Schema already applied — nothing to do.')
    } else {
      throw err
    }
  } finally {
    await connection.end()
  }
  process.exit(0)
}

migrate().catch((err) => {
  console.error('Failed to apply schema:', err.sqlMessage || err.message)
  process.exit(1)
})
