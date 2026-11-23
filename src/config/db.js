import mysql from 'mysql2/promise'
import { env } from './env.js'

// Railway's managed MySQL runs its session clock in UTC by default. Left
// alone, CURRENT_TIMESTAMP/NOW() (orders.created_at, confirmed_at, etc.)
// get stamped in UTC while every admin page filters "hoy"/"esta semana"
// against the business's own local calendar day (Aguascalientes, UTC-6
// year-round — Mexico dropped DST almost everywhere in 2022) — an order
// placed in the evening already lands on "tomorrow" for the server, so it
// silently falls outside today's date range (shows up eventually once the
// range widens, but never where you'd expect it that same day). Setting
// the session's own time_zone on every pooled connection fixes this at the
// source instead of having to convert it back and forth in every query
// across orders/cashCuts/returns/restock history.
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
})

pool.on('connection', (connection) => {
  connection.query("SET time_zone = '-06:00'")
})
