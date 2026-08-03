import mysql from 'mysql2/promise'
import dotenv from 'dotenv'

dotenv.config()

export const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'dengue_hybrid',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
})

// Thin helper so controllers don't touch the pool/connection details directly.
export async function query(sql, params = {}) {
  const [rows] = await pool.execute(sql, params)
  return rows
}
