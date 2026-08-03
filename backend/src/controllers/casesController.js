import { pool, query } from '../config/db.js'
import { sendJson, readJsonBody } from '../utils/http.js'

export async function listCases(req, res) {
  const { regionId } = req.query
  const rows = regionId
    ? await query(
        'SELECT id, region_id, date, confirmed_cases, deaths FROM case_data WHERE region_id = :regionId ORDER BY date DESC LIMIT 500',
        { regionId },
      )
    : await query('SELECT id, region_id, date, confirmed_cases, deaths FROM case_data ORDER BY date DESC LIMIT 500')
  sendJson(res, 200, rows)
}

// Bulk insert from a CSV upload: [{ region_id, date, confirmed_cases, deaths }, ...]
export async function bulkInsertCases(req, res) {
  const { rows } = await readJsonBody(req)
  if (!Array.isArray(rows) || rows.length === 0) {
    return sendJson(res, 400, { error: 'Expected a non-empty "rows" array' })
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const row of rows) {
      await conn.execute(
        `INSERT INTO case_data (region_id, date, confirmed_cases, deaths)
         VALUES (:region_id, :date, :confirmed_cases, :deaths)
         ON DUPLICATE KEY UPDATE confirmed_cases = VALUES(confirmed_cases), deaths = VALUES(deaths)`,
        {
          region_id: row.region_id,
          date: row.date,
          confirmed_cases: row.confirmed_cases ?? 0,
          deaths: row.deaths ?? 0,
        },
      )
    }
    await conn.commit()
    sendJson(res, 201, { inserted: rows.length })
  } catch (err) {
    await conn.rollback()
    sendJson(res, 500, { error: 'Bulk insert failed', detail: err.message })
  } finally {
    conn.release()
  }
}
