import bcrypt from 'bcryptjs'
import { pool } from './db.js'

// Populates enough demo data (regions, a login user, three model runs with
// evaluation metrics, a forecast, and alerts) so the UI isn't empty on first run.
async function seed() {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const regions = [
      ['Metro Manila', 'NCR', 'NCR', 14.5995, 120.9842],
      ['Calabarzon', 'Calabarzon', 'REG4A', 14.1008, 121.0794],
      ['Davao Region', 'Davao del Sur', 'REG11', 7.1907, 125.4553],
      ['Central Visayas', 'Cebu', 'REG7', 10.3157, 123.8854],
    ]
    for (const [name, province, code, lat, lng] of regions) {
      await conn.execute(
        'INSERT IGNORE INTO regions (name, province, region_code, lat, lng) VALUES (?, ?, ?, ?, ?)',
        [name, province, code, lat, lng],
      )
    }
    const [regionRows] = await conn.query('SELECT id, name FROM regions ORDER BY id')

    const passwordHash = await bcrypt.hash('password123', 10)
    await conn.execute(
      'INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['Demo Admin', 'admin@dews.local', passwordHash, 'admin'],
    )

    const modelDefs = [
      ['SARIMA', 'v1', { p: 2, d: 1, q: 2 }],
      ['LSTM', 'v1', { units: 64, epochs: 50 }],
      ['Bayesian-Neural Hybrid', 'v1', { prior: 'hierarchical', nn: 'GRU-32' }],
    ]
    const modelRuns = []
    for (const [type, version, hp] of modelDefs) {
      const [result] = await conn.execute(
        'INSERT INTO model_runs (model_type, version, hyperparameters_json) VALUES (?, ?, ?)',
        [type, version, JSON.stringify(hp)],
      )
      modelRuns.push({ id: result.insertId, type })
    }

    // Hybrid model deliberately scored best, illustrating the comparative-evaluation study.
    const metrics = [
      { type: 'SARIMA', rmse: 42.1, mae: 31.4, mape: 18.2, crps: 27.6, coverage: 71.2 },
      { type: 'LSTM', rmse: 35.7, mae: 26.8, mape: 15.1, crps: 22.9, coverage: 68.5 },
      { type: 'Bayesian-Neural Hybrid', rmse: 28.3, mae: 21.0, mape: 11.4, crps: 17.2, coverage: 89.6 },
    ]
    for (const m of metrics) {
      const run = modelRuns.find((r) => r.type === m.type)
      await conn.execute(
        'INSERT INTO evaluation_metrics (model_run_id, rmse, mae, mape, crps, coverage) VALUES (?, ?, ?, ?, ?, ?)',
        [run.id, m.rmse, m.mae, m.mape, m.crps, m.coverage],
      )
    }

    const hybridRun = modelRuns.find((r) => r.type === 'Bayesian-Neural Hybrid')
    const firstRegionId = regionRows[0].id
    const today = new Date()

    for (let week = 0; week < 6; week++) {
      const date = new Date(today)
      date.setDate(date.getDate() + week * 7)
      const predicted = 120 + week * 15
      await conn.execute(
        'INSERT INTO predictions (model_run_id, region_id, date, predicted_cases, ci_lower, ci_upper) VALUES (?, ?, ?, ?, ?, ?)',
        [hybridRun.id, firstRegionId, date.toISOString().slice(0, 10), predicted, predicted - 25, predicted + 25],
      )
    }

    for (let week = 1; week <= 4; week++) {
      const date = new Date(today)
      date.setDate(date.getDate() - week * 7)
      await conn.execute(
        'INSERT IGNORE INTO case_data (region_id, date, confirmed_cases, deaths) VALUES (?, ?, ?, ?)',
        [firstRegionId, date.toISOString().slice(0, 10), 90 + week * 10, Math.floor(week / 2)],
      )
    }

    await conn.execute(
      'INSERT INTO alerts (region_id, date, risk_level, triggered_by_model_run_id) VALUES (?, ?, ?, ?)',
      [firstRegionId, today.toISOString().slice(0, 10), 'high', hybridRun.id],
    )
    if (regionRows[1]) {
      await conn.execute(
        'INSERT INTO alerts (region_id, date, risk_level, triggered_by_model_run_id) VALUES (?, ?, ?, ?)',
        [regionRows[1].id, today.toISOString().slice(0, 10), 'moderate', hybridRun.id],
      )
    }

    await conn.commit()
    console.log('Seed complete. Demo login: admin@dews.local / password123')
  } catch (err) {
    await conn.rollback()
    console.error('Seed failed:', err)
    process.exitCode = 1
  } finally {
    conn.release()
    await pool.end()
  }
}

seed()
