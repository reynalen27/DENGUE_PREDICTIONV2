import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

/*
 * Versioned migration runner.
 *
 * Applies every `NNN_*.sql` in migrations/ in filename order, once, recording
 * each in a `schema_migrations` ledger. Re-running is a no-op.
 *
 * The ledger matters more here than in a greenfield project: MySQL has no
 * `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so a second run of an ALTER-based
 * migration is an error rather than a nudge. The ledger is what makes
 * `npm run migrate` safe to run at any time.
 *
 * Baselining: a database created before this runner existed already has the
 * 001 tables but no ledger. Rather than fail on a duplicate CREATE, the runner
 * detects that case and records 001 as already applied.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations')

const log = (...a) => console.log(...a)

/**
 * Split a migration file into statements.
 *
 * A single character scan, because none of the shortcuts survive real SQL: a
 * `;` inside a COMMENT '...' string literal is not a statement boundary (that
 * bug split an ALTER in half), and a `--` inside a string is not a comment.
 * Handles ' and " literals with backslash and doubled-quote escapes, `--` and
 * `#` line comments, and /* *\/ blocks.
 */
function statementsOf(sql) {
  const out = []
  let buf = ''
  let i = 0

  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]

    // line comment
    if ((c === '-' && next === '-') || c === '#') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    // block comment
    if (c === '/' && next === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    // string literal — copied verbatim, boundaries ignored inside
    if (c === "'" || c === '"') {
      const quote = c
      buf += c
      i += 1
      while (i < sql.length) {
        if (sql[i] === '\\') { buf += sql[i] + (sql[i + 1] ?? ''); i += 2; continue }
        if (sql[i] === quote && sql[i + 1] === quote) { buf += quote + quote; i += 2; continue }
        buf += sql[i]
        if (sql[i] === quote) { i += 1; break }
        i += 1
      }
      continue
    }
    if (c === ';') {
      if (buf.trim()) out.push(buf.trim())
      buf = ''
      i += 1
      continue
    }
    buf += c
    i += 1
  }

  if (buf.trim()) out.push(buf.trim())
  return out
}

async function ensureLedger(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(160) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      statements INT NOT NULL
    )
  `)
}

async function baselineIfNeeded(conn, files) {
  const [applied] = await conn.query('SELECT COUNT(*) AS n FROM schema_migrations')
  if (applied[0].n > 0) return

  const [tables] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES "
    + "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('regions','case_data','model_runs')",
  )
  if (tables[0].n < 3) return          // genuinely empty database, run everything

  const first = files[0]
  await conn.execute(
    'INSERT INTO schema_migrations (filename, statements) VALUES (:f, 0)',
    { f: first },
  )
  log(`  baseline: ${first} recorded as already applied (its tables exist)`)
}

async function migrate() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (!files.length) {
    log('No migrations found.')
    return
  }

  const conn = await pool.getConnection()
  try {
    await ensureLedger(conn)
    await baselineIfNeeded(conn, files)

    const [rows] = await conn.query('SELECT filename FROM schema_migrations')
    const done = new Set(rows.map((r) => r.filename))
    const pending = files.filter((f) => !done.has(f))

    if (!pending.length) {
      log(`Up to date — ${files.length} migration(s) already applied.`)
      return
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      const statements = statementsOf(sql)
      log(`\nApplying ${file}  (${statements.length} statements)`)

      // Each migration is its own transaction. MySQL implicitly commits on
      // DDL, so a mid-file failure can leave a partial migration — the error
      // names the statement so it can be finished or reverted by hand.
      for (const [i, statement] of statements.entries()) {
        try {
          await conn.query(statement)
        } catch (err) {
          log(`\n  FAILED at statement ${i + 1}/${statements.length}:`)
          log(`  ${statement.slice(0, 300).replace(/\s+/g, ' ')}`)
          throw err
        }
      }

      await conn.execute(
        'INSERT INTO schema_migrations (filename, statements) VALUES (:f, :n)',
        { f: file, n: statements.length },
      )
      log(`  ok`)
    }

    log(`\nMigration complete — ${pending.length} applied, ${files.length} total.`)
  } finally {
    conn.release()
    await pool.end()
  }
}

migrate().catch((err) => {
  console.error('\nMigration failed:', err.message)
  process.exit(1)
})
