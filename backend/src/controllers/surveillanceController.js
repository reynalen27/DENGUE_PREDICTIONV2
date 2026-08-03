import { query } from '../config/db.js'
import { sendJson } from '../utils/http.js'

/*
 * Annual confirmed cases per LGU, with the census denominator attached so the
 * client can show incidence without a second round trip.
 *
 * The map needs all 142 LGUs x 5 years at once (710 rows) to hold its colour
 * bins fixed while the reader switches year — /api/cases is capped at 500 rows
 * and returns raw records, so it cannot serve this.
 *
 * Population is the 2020 census for every year: it is the latest count PSA
 * has published, and the case window is 2020-2024. The UI labels the metric
 * accordingly rather than implying an annual denominator.
 */
export async function listAnnualCases(req, res) {
  const { regionCode = 'REG4A' } = req.query

  const rows = await query(
    `SELECT r.id            AS region_id,
            r.name          AS region_name,
            r.province      AS province,
            YEAR(c.date)    AS year,
            c.confirmed_cases,
            c.deaths,
            d.population
     FROM case_data c
     JOIN regions r          ON r.id = c.region_id
     LEFT JOIN demographic_data d ON d.region_id = r.id AND d.year = 2020
     WHERE r.region_code = :regionCode
     ORDER BY r.province, r.name, year`,
    { regionCode },
  )

  sendJson(res, 200, rows)
}
