import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.join(__dirname, '..', '..', 'migrations', 'schema.sql')

async function migrate() {
  const sql = fs.readFileSync(schemaPath, 'utf8')
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  const conn = await pool.getConnection()
  try {
    for (const statement of statements) {
      await conn.query(statement)
    }
    console.log(`Migration complete: ${statements.length} statements executed.`)
  } finally {
    conn.release()
    await pool.end()
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
