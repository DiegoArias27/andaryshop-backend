import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import mysql from 'mysql2/promise'
import { env } from '../config/env.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, 'migrations')

// A dedicated, one-off connection (not the shared pool from db.js) — this is
// the only place `multipleStatements` is ever needed, and turning it on for
// the app's normal pool would widen the SQL-injection surface for no reason.
async function migrate() {
  console.log(`Connecting to ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name} ...`)
  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.name,
    multipleStatements: true,
  })

  try {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
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
    }

    // One-off, numbered follow-up changes (data cleanups, column tweaks)
    // that must run at most once each — tracked here instead of folded into
    // schema.sql, since schema.sql's CREATE TABLE/INDEX statements are only
    // safe to replay because they're idempotent by nature; a migration like
    // "clear every image column" is not, so it needs its own record of
    // having already run.
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(190) PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`
    )

    const files = existsSync(migrationsDir)
      ? readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
      : []
    const [appliedRows] = await connection.query('SELECT name FROM schema_migrations')
    const applied = new Set(appliedRows.map((r) => r.name))

    let ranAny = false
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`Skipping ${file} (already applied).`)
        continue
      }
      console.log(`Applying ${file} ...`)
      const sql = readFileSync(join(migrationsDir, file), 'utf8')
      const [result] = await connection.query(sql)
      const statementResults = Array.isArray(result) ? result : [result]
      const affectedRows = statementResults.reduce((sum, r) => sum + (r?.affectedRows ?? 0), 0)
      await connection.query('INSERT INTO schema_migrations (name) VALUES (?)', [file])
      console.log(`Applied ${file} (${affectedRows} rows affected).`)
      ranAny = true
    }
    if (!ranAny) {
      console.log('No pending migrations.')
    }
  } finally {
    await connection.end()
  }
  process.exit(0)
}

migrate().catch((err) => {
  console.error('Migration failed.')
  console.error('code:', err.code)
  console.error('errno:', err.errno)
  console.error('message:', err.sqlMessage || err.message || String(err))
  process.exit(1)
})
