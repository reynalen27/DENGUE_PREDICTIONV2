# Model service — write contract

Specification for the Python service that trains the Bayesian-neural hybrid and
its SARIMA/LSTM baselines, and writes their output into MySQL.

**The database is the contract.** The service and this app never call each
other: the service writes rows, the app reads them. That is why nothing in
`frontend/src/` or `backend/src/` has to change when the real model lands —
clear the demo fixtures, write real rows, refresh the browser.

Read alongside:
[ARCHITECTURE.md](ARCHITECTURE.md) for the system,
[REVISION_PLAN.md](REVISION_PLAN.md) for why the study is designed this way,
[DATA_ASSESSMENT.md](DATA_ASSESSMENT.md) for what the source data can support.

---

## 1. Before you start

```bash
cd backend
npm run migrate                        # must report 4 of 4 applied
npm run etl:revised                    # 1,020-row panel into MySQL
npm run seed:fixtures -- --clear       # remove the demo values
```

`seed:fixtures --clear` matters. Until it runs, `model_runs.notes` reads
`DEMO FIXTURE — illustrative values, not a real fit`, and every page renders a
warning banner saying the numbers are invented. That banner is keyed off
`notes`, so it disappears on its own once real runs replace the fixtures.

### Read the panel

Either hit the API:

```
GET http://localhost:4000/api/panel
GET http://localhost:4000/api/panel?region=R4A&from=2016-01&to=2018-12
```

or query MySQL directly:

```sql
SELECT r.id   AS region_id,
       r.slug AS region_slug,
       DATE_FORMAT(c.date, '%Y-%m') AS period,
       c.confirmed_cases, c.deaths,
       d.population, d.population_density,
       cl.temperature, cl.rainfall, cl.humidity, cl.hot_days
FROM case_data c
JOIN regions r          ON r.id = c.region_id AND r.admin_level = 'region'
JOIN climate_data cl    ON cl.region_id = r.id AND cl.date = c.date
JOIN demographic_data d ON d.region_id = r.id AND d.year = YEAR(c.date)
WHERE c.period_type = 'month'
ORDER BY r.slug, c.date;
-- 1,020 rows · 17 regions · 60 months
```

> **Key on `period`, never on `date`.** mysql2 returns a `DATE` as a JS Date at
> local midnight, which JSON-encodes to the previous day in UTC+8 — `2019-08-01`
> reaches an HTTP client reading `2019-07-31`. `period`, `year` and `month` are
> formatted by MySQL and carry no timezone. Reading MySQL directly from Python
> does not have this problem, but the API does.

### Resolving `region_id`

Always by slug. The `regions` table holds two admin levels; the 17 study
regions are the ones with `admin_level = 'region'`.

```sql
SELECT id, slug FROM regions WHERE admin_level = 'region';
-- NCR, CAR, R1, R2, R3, R4A, R4B, R5 … R13, BARMM
```

---

## 2. The evaluation split

Every run must use the same split, or the comparison means nothing.

| | Window | Rows |
|---|---|---|
| **Train** | 2016-01 → 2018-12 | 36 months × 17 = 612 |
| **Test** | 2019-01 → 2019-12 | 12 months × 17 = 204 |
| **Excluded** | 2020 | 204 |

2020 is loaded but must not be scored. July–October 2020 runs at **6–9% of
2019** — the COVID lockdown collapsing health-seeking and surveillance
reporting, not a fall in transmission. A model scored on it is scored on a
regime it was never shown. Reporting 2020 separately as an out-of-regime
diagnostic is fine and interesting; folding it into the headline is not.

Record the split on every run (§3.1). Without it "the hybrid beat SARIMA" is
unreproducible.

---

## 3. Write order

Foreign keys force this sequence. Everything below is idempotent — re-running
the same experiment replaces its rows rather than appending duplicates.

```
1. model_runs           -> run_id
2. predictions          -> prediction_id per region-month
3. prediction_intervals    (needs prediction_id)
4. evaluation_metrics
5. interval_coverage
6. calibration_bins
7. feature_importance
```

Wrap one run in one transaction. A half-written run renders as a half-empty
page rather than an error, which is worse than no run at all.

---

### 3.1 `model_runs` — one row per training run

**No unique key, deliberately.** Every run *should* be a new row: that is what
makes the app a run-comparison tool rather than a display of whichever fit
happened last. Do not overwrite an old run to "update" it — insert a new one
and bump `version`.

```sql
INSERT INTO model_runs
  (model_type, version, trained_at, hyperparameters_json,
   train_start, train_end, test_start, test_end,
   horizon_months, feature_set_json, notes)
VALUES
  ('Bayesian-Neural Hybrid', 'v2', NOW(),
   JSON_OBJECT('prior','hierarchical','nn','GRU-32','chains',4,'draws',2000),
   '2016-01-01', '2018-12-01', '2019-01-01', '2019-12-01',
   1,
   JSON_OBJECT(
     'target', 'confirmed_cases',
     'predictors', JSON_ARRAY('cases_lag1','cases_lag12','temperature_lag3',
                              'humidity_lag1','rainfall_lag1','hot_days_lag3',
                              'log_population_offset','population_density'),
     'excluded', JSON_OBJECT('2020','COVID surveillance break')
   ),
   NULL);
SELECT LAST_INSERT_ID();   -- run_id
```

| Column | Required | Notes |
|---|---|---|
| `model_type` | yes | Must contain "hybrid" (any case) for the hybrid — the Drivers page selects the run that way, and only the hybrid is expected to produce feature effects. |
| `version` | recommended | Distinguishes iterations of the same model. |
| `train_start` … `test_end` | **yes** | Rendered on every model page by `EvaluationBanner`. |
| `horizon_months` | recommended | 1 for one-month-ahead. |
| `feature_set_json` | **yes** | The `excluded` key is rendered as a badge, so the 2020 exclusion is visible on-screen. |
| `notes` | leave NULL | Any text matching `/demo fixture/i` triggers the "not model output" banner. Use it only if the run really is illustrative. |

---

### 3.2 `predictions` — one row per region-month of the test window

```sql
INSERT INTO predictions
  (model_run_id, region_id, date, predicted_cases, predicted_median,
   ci_lower, ci_upper, actual_cases)
VALUES (:run_id, :region_id, :date, :mean, :median, :lo95, :hi95, :actual)
ON DUPLICATE KEY UPDATE
  predicted_cases  = VALUES(predicted_cases),
  predicted_median = VALUES(predicted_median),
  ci_lower         = VALUES(ci_lower),
  ci_upper         = VALUES(ci_upper),
  actual_cases     = VALUES(actual_cases);
```

Unique on `(model_run_id, region_id, date)` — added by migration 004.

- `date` is the **first of the month**: `2019-08-01`.
- `ci_lower`/`ci_upper` are the **95%** interval, kept for the Forecast page's
  default band. Every level, including 95%, also goes in
  `prediction_intervals`.
- **Set `actual_cases`.** It is what lets the Forecast page draw observed
  against predicted on the test window, so a reader can see hits and misses
  rather than take the metrics on trust. Leave it `NULL` only for genuine
  out-of-sample forecasts with no observation yet.

> `predicted_cases` is `DECIMAL(8,2)` — max 999,999.99. The largest observed
> regional month is 21,658, so there is headroom, but a diverging model that
> emits 10⁷ will error rather than truncate.

---

### 3.3 `prediction_intervals` — one row per level

```sql
INSERT INTO prediction_intervals (prediction_id, nominal_level, lower, upper)
VALUES (:prediction_id, :level, :lower, :upper)
ON DUPLICATE KEY UPDATE lower = VALUES(lower), upper = VALUES(upper);
```

**Emit at least three levels — 50, 80, 95.** Calibration is the agreement
between nominal and empirical coverage *across* levels; a single 95% band
cannot demonstrate it, and the reliability diagram degenerates to one point.

---

### 3.4 `evaluation_metrics` — point and probabilistic accuracy

One row with `scope='overall'`, plus one per region with `scope='region'`.
Unique on `(model_run_id, scope, region_id)` — migration 004.

```sql
-- overall
INSERT INTO evaluation_metrics
  (model_run_id, scope, region_id, rmse, mae, mape, crps, coverage,
   mean_interval_width, n_obs)
VALUES (:run_id, 'overall', NULL, :rmse, :mae, :mape, :crps, :cov95, :width95, 204)
ON DUPLICATE KEY UPDATE
  rmse = VALUES(rmse), mae = VALUES(mae), mape = VALUES(mape),
  crps = VALUES(crps), coverage = VALUES(coverage),
  mean_interval_width = VALUES(mean_interval_width), n_obs = VALUES(n_obs);

-- per region (n_obs = 12)
INSERT INTO evaluation_metrics
  (model_run_id, scope, region_id, rmse, mae, mape, crps, coverage,
   mean_interval_width, n_obs)
VALUES (:run_id, 'region', :region_id, …, 12)
ON DUPLICATE KEY UPDATE …;
```

| Column | Definition |
|---|---|
| `rmse` | √mean((ŷ−y)²), in cases |
| `mae` | mean(\|ŷ−y\|), in cases |
| `mape` | mean(\|ŷ−y\|/y) × 100 |
| `crps` | Continuous ranked probability score over the full predictive distribution |
| `coverage` | % of observations inside the **95%** interval |
| `mean_interval_width` | mean(upper−lower) at 95%, in cases — sharpness |

> **`mape` is `DECIMAL(6,3)` — max 999.999.** The smallest observed regional
> month is 10 cases, so a badly wrong prediction there can blow past 1000% and
> the insert will error. Guard it, or report a robust variant (sMAPE) and say
> which you used.

`coverage` here duplicates the 95% row of `interval_coverage` on purpose: the
Model comparison page wants one number per model, the Calibration page wants
the curve. Keep them consistent.

---

### 3.5 `interval_coverage` — objective ④

```sql
INSERT INTO interval_coverage
  (model_run_id, region_id, nominal_level, empirical_level, mean_width, n_obs)
VALUES (:run_id, NULL, 95.00, :empirical, :mean_width, 204)
ON DUPLICATE KEY UPDATE
  empirical_level = VALUES(empirical_level),
  mean_width      = VALUES(mean_width),
  n_obs           = VALUES(n_obs);
```

`region_id IS NULL` means pooled across all regions; a region id gives the
per-region breakdown. Unique on `(model_run_id, region_id, nominal_level)`.

Write one row per nominal level, matching §3.3.

**`mean_width` is not optional.** Coverage alone is not evidence: an interval
wide enough to contain every plausible value has perfect coverage and no
decision value. The page reads the pair, and the API returns
`gap = empirical − nominal` so the sign is unambiguous.

---

### 3.6 `calibration_bins` — the PIT histogram

```sql
INSERT INTO calibration_bins
  (model_run_id, bin_lower, bin_upper, observed_freq, n_obs)
VALUES (:run_id, 0.0000, 0.1000, :freq, 204)
ON DUPLICATE KEY UPDATE observed_freq = VALUES(observed_freq), n_obs = VALUES(n_obs);
```

Ten bins over [0,1]. For each test observation compute the probability
integral transform — the predictive CDF evaluated at the observed value —
then the fraction of observations falling in each bin. `observed_freq` is a
**fraction**, not a percentage: 0.10 for a perfectly flat histogram.

Flat = calibrated · U-shaped = overconfident · hump = intervals too wide.

Both this and §3.5 are needed. A reliability curve can look acceptable while
the PIT shows the predictive distribution has the wrong shape.

---

### 3.7 `feature_importance` — objective ③

```sql
INSERT INTO feature_importance
  (model_run_id, region_id, feature, lag_months, importance,
   ci_lower, ci_upper, method, rank_in_scope)
VALUES (:run_id, NULL, 'temperature', 3, 0.412, 0.243, 0.585, 'posterior', 2)
ON DUPLICATE KEY UPDATE
  importance = VALUES(importance),
  ci_lower   = VALUES(ci_lower),
  ci_upper   = VALUES(ci_upper),
  rank_in_scope = VALUES(rank_in_scope);
```

Unique on `(model_run_id, region_id, feature, lag_months, method)`.
`region_id IS NULL` = pooled/global effect.

| Column | Notes |
|---|---|
| `feature` | Bare variable name — `temperature`, not `temperature_lag3`. The lag lives in its own column so the same variable at two lags is two comparable rows. |
| `lag_months` | `NULL` for a static predictor (`population_density`). |
| `importance` | Posterior mean effect on the model's link scale, or a SHAP value. State which in `method`. |
| `ci_lower` / `ci_upper` | **Required in practice.** See below. |
| `method` | `posterior` \| `shap` \| `permutation` |

> ### The interval is the interpretability claim
>
> The API derives `crosses_zero` from `ci_lower <= 0 AND ci_upper >= 0` and the
> Drivers page renders those effects **hollow, in the neutral midpoint colour,
> with an explicit "not distinguishable from no effect" label**.
>
> Omit the bounds and `crosses_zero` returns `NULL`; the page silently
> degrades into a ranked leaderboard, which is exactly the failure the
> objective exists to avoid. A reader would see "population density, rank 7"
> and conclude it has a small effect, when the honest statement is that its
> effect cannot be distinguished from none.
>
> Expect population density to land there. Between the 17 regions its
> correlation with incidence is **−0.042** — there is very little
> cross-sectional power at n=17. That is a finding, not a gap in the model.

Also emit per-region rows where the model supports them: a hierarchical model's
region-level coefficients are precisely the "per region" that objective ③
asks for.

---

## 4. Python skeleton

```python
import mysql.connector, json

conn = mysql.connector.connect(
    host="localhost", user="root", password="…", database="dengue_hybrid")
cur = conn.cursor(dictionary=True)

cur.execute("SELECT id, slug FROM regions WHERE admin_level='region'")
region_id = {r["slug"]: r["id"] for r in cur.fetchall()}

try:
    conn.start_transaction()

    cur.execute("""
        INSERT INTO model_runs (model_type, version, trained_at,
            train_start, train_end, test_start, test_end,
            horizon_months, feature_set_json)
        VALUES (%s,%s,NOW(),%s,%s,%s,%s,%s,%s)
    """, ("Bayesian-Neural Hybrid", "v2",
          "2016-01-01", "2018-12-01", "2019-01-01", "2019-12-01",
          1, json.dumps(feature_set)))
    run_id = cur.lastrowid

    for row in test_predictions:                      # 204 region-months
        cur.execute("""
            INSERT INTO predictions (model_run_id, region_id, date,
                predicted_cases, predicted_median, ci_lower, ci_upper, actual_cases)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              predicted_cases=VALUES(predicted_cases),
              predicted_median=VALUES(predicted_median),
              ci_lower=VALUES(ci_lower), ci_upper=VALUES(ci_upper),
              actual_cases=VALUES(actual_cases)
        """, (run_id, region_id[row.slug], row.date,
              row.mean, row.median, row.lo95, row.hi95, row.actual))
        pid = cur.lastrowid

        for level, (lo, hi) in row.intervals.items():  # 50 / 80 / 95
            cur.execute("""
                INSERT INTO prediction_intervals
                    (prediction_id, nominal_level, lower, upper)
                VALUES (%s,%s,%s,%s)
                ON DUPLICATE KEY UPDATE lower=VALUES(lower), upper=VALUES(upper)
            """, (pid, level, lo, hi))

    # … evaluation_metrics, interval_coverage, calibration_bins,
    #     feature_importance — same pattern

    conn.commit()
except Exception:
    conn.rollback()
    raise
```

> ### `lastrowid` is 0 after an upsert that updated
>
> This one will bite on the second run and not the first. When
> `INSERT … ON DUPLICATE KEY UPDATE` *inserts*, `cur.lastrowid` is the new id.
> When it *updates* an existing row, **`LAST_INSERT_ID()` is 0** — verified
> against this database. Using it as `prediction_id` then violates the foreign
> key on `prediction_intervals`, so the first refit of any run fails.
>
> Two fixes. Either make the statement set it explicitly:
>
> ```sql
> INSERT INTO predictions (…) VALUES (…)
> ON DUPLICATE KEY UPDATE
>   id = LAST_INSERT_ID(id),          -- makes lastrowid the existing row's id
>   predicted_cases = VALUES(predicted_cases), …
> ```
>
> or read it back, which is unambiguous and needs no MySQL trivia:
>
> ```python
> cur.execute("SELECT id FROM predictions "
>             "WHERE model_run_id=%s AND region_id=%s AND date=%s",
>             (run_id, rid, date))
> pid = cur.fetchone()["id"]
> ```

---

## 5. Validating a run

After writing, check the run landed complete:

```sql
SET @run = <run_id>;

SELECT
  (SELECT COUNT(*) FROM predictions          WHERE model_run_id=@run) AS predictions,
  (SELECT COUNT(*) FROM prediction_intervals pi
     JOIN predictions p ON p.id=pi.prediction_id
    WHERE p.model_run_id=@run)                                        AS intervals,
  (SELECT COUNT(*) FROM evaluation_metrics   WHERE model_run_id=@run) AS metrics,
  (SELECT COUNT(*) FROM interval_coverage    WHERE model_run_id=@run) AS coverage,
  (SELECT COUNT(*) FROM calibration_bins     WHERE model_run_id=@run) AS pit,
  (SELECT COUNT(*) FROM feature_importance   WHERE model_run_id=@run) AS effects;
```

Expected for a complete hybrid run on the standard split:

| | Expected | Why |
|---|---:|---|
| `predictions` | 204 | 17 regions × 12 test months |
| `intervals` | 612 | 204 × 3 nominal levels |
| `metrics` | 18 | 1 overall + 17 regions |
| `coverage` | 54 | 3 levels × (1 pooled + 17 regions) |
| `pit` | 10 | ten bins |
| `effects` | ≥ 8 | one per feature × lag, pooled; more with per-region |

Then check the endpoints, which is what the pages actually read:

```bash
curl -s "http://localhost:4000/api/models/compare" | head -c 400
curl -s "http://localhost:4000/api/models/<run_id>/coverage?regionId=overall"
curl -s "http://localhost:4000/api/models/<run_id>/calibration"
curl -s "http://localhost:4000/api/models/<run_id>/importance?regionId=global"
```

Finally open the app. The fixture banner should be gone, and Model comparison,
Calibration and Drivers should show your numbers.

---

## 6. Iterating

Each refit is a **new `model_runs` row**, not an overwrite. The app then works
as a run-comparison tool: change a prior, refit, and the new run appears beside
the old ones with its own window and feature set recorded. It is a lab notebook
you cannot accidentally falsify.

Two things to expect:

- **`/api/models/compare` returns every run that has metrics.** After ~20
  iterations the page gets crowded. When it does, add a `reported BOOLEAN` to
  `model_runs` and filter on it, rather than deleting runs.
- **Deleting a `model_runs` row cascades** to its predictions, intervals,
  metrics, coverage, PIT bins and effects. That is intended, but it is not
  reversible.

---

## 7. Three things to be honest about

**612 training rows.** Ample for a hierarchical Bayesian model that pools
across regions; **thin for an LSTM**. If the LSTM loses on RMSE it may be
under-trained rather than unsuited — say so. "The LSTM was under-trained at
this sample size" is a real finding.

**2019 is an epidemic year** (441,902 cases against 250,783 in 2018). A
demanding test set, and a reviewer will ask why. The answer is that 2020 is
unusable and 2018 is needed for training — a defensible choice, but one to
argue rather than assume.

**The demo fixtures encode an expected result** — hybrid wins, hybrid is
calibrated. The real model may not. The pages were built before the answer was
known precisely so they render whatever is true: if the hybrid is overconfident,
the reliability curve will sit below the diagonal and the verdict badge will say
so. Do not tune the model to match the fixtures.
