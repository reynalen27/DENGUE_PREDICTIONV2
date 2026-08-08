# Revision plan — aligning the project to the finalised objective

Written after a field-level audit of `RESEARCH DATA SET/REVISED DATA SET`.
Every number below was computed from those files; the audit scripts are named
in §8 so you can re-run them.

**The headline:** the revised dataset is a large step up. It replaces 5 annual
observations per unit with a **complete 1,020-row monthly panel** — and that
panel is enough to train the hybrid, evaluate it against SARIMA and LSTM, and
report calibrated intervals. Three things must change to get there: the unit of
analysis moves from CALABARZON municipalities to the **17 administrative
regions**, the schema gains four modelling tables it does not currently have,
and the evaluation window must avoid 2020.

---

## 1. What the revised dataset actually contains

| Folder | Granularity | Coverage | Fields | Verdict |
|---|---|---|---|---|
| Recorded Dengue Cases 2016-2020 | region × month | 2016-01 → 2020-12 | `Dengue_Cases` (count), `Dengue_Deaths` | ✅ **The target.** 1,020 rows, complete |
| Dengue Cases Per 100k 2008-2016 | region × month | 2008-01 → 2016-12 | rate per 100k | ⛔ **Excluded** — see §2 |
| Mean Air Temperature | region × month | 1950-01 → 2025-12 | °C | ✅ Complete, 15,504 values |
| Mean Precipitation | region × month | 1950-01 → 2025-12 | mm/month | ✅ Complete |
| Mean Relative Humidity | region × month | 1950-01 → 2025-12 | % | ✅ Complete |
| Number of Hot Days (>35 °C) | region × month | 1950-03 → 2025-12 | days | ⚠️ Only 4,182/15,504 populated; blanks are almost certainly "zero hot days", not missing |
| Population Density 2010/2015/2020 | municipality, **with region subtotals** | 2010, 2015, 2020 | population + **land area km²** | ✅ The only source of area → density |
| Population 2022-2025 | region × year | 2022–2025 | totals + age/sex | ⛔ **No overlap** with the 2016–2020 case window |
| Urban Population 2015/2020 | municipality + region | 2015, 2020 | urban count, % urban | ➕ Optional covariate |
| Poverty Threshold 2015/2018 | region | 2015, 2018 | threshold, incidence | ➕ Optional covariate |

**The unit of analysis is now the 17 administrative regions of the
Philippines, monthly.** Every case, climate, population and area file resolves
to that grid. This is a change from the current app, which is built around 142
CALABARZON cities and municipalities.

### The join is verified, not assumed

Four different region vocabularies appear across the files —
`Region.IV.A` / `Region IV-A` / `Region 4-A` / `REGION IV-A (CALABARZON)`, plus
`ARMM`↔`BARMM` and `CARAGA`↔`Region XIII`. After canonicalisation:

```
panel rows      1,020      (17 regions × 60 months)
missing         0
complete        yes
```

The geography extraction reconciles exactly against PSA's own total:

```
sum of 17 regional populations (2020) = 109,033,245
PSA "PHILIPPINES" row                 = 109,033,245
```

Two traps in that file, both handled: the **BARMM label wraps across two rows**
(`Bangsamoro Autonomous Region` / `in Muslim Mindanao (BARMM) 3`), and there is
a **municipality called Caraga** in Davao Oriental that a naive region-name
match picks up as if it were Region XIII.

---

## 2. Two findings that constrain the study design

These are the reason this plan is not simply "load the new data".

### 2a. The 2008–2016 file has a period-3 artefact — exclude it

Pooled across all regions and years, its monthly means form a repeating
quarterly ramp rather than a seasonal curve:

```
month    1     2     3  |  4     5     6  |  7     8     9  | 10    11    12
value  6.76 10.76 16.60 | 6.80 10.55 15.57 | 7.60 10.93 15.16 | 6.96 11.70 16.17
       ^low       ^high   ^low        ^high  ^low        ^high  ^low        ^high
```

It peaks in **March** and troughs in **January**. Real Philippine dengue peaks
in August–September, which the 2016–2020 file shows correctly. Values rise
monotonically within a quarter in **41.2%** of quarters against **16.7%**
expected by chance.

The two files also fail to reconcile on their shared year: backing out an
implied population from `counts ÷ rate × 100,000` across 2016 gives figures
that swing by up to **3,247×** within a single region.

**Decision: train on 2016–2020 only.** Adding the earlier file would hand the
model a strong quarterly signal that is an artefact of the source, and it would
contaminate exactly the seasonality the study is about. If the 2008–2016 series
can be re-obtained from its original publisher with the ordering explained, it
would extend the panel to 2,652 rows and is worth chasing — but not on these
values.

### 2b. 2020 is a structural break — do not evaluate on it

```
year    total cases   vs prev   peak month
2016        209,544              Aug
2017        154,155     -26%     Aug
2018        250,783     +63%     Sep
2019        441,902     +76%     Sep
2020         91,041     -79%     Feb      <- COVID
```

Month by month against 2019, the 2020 collapse tracks the lockdown exactly:

```
Jan 0.89   Feb 0.77   Mar 0.65   Apr 0.30   May 0.24   Jun 0.10
Jul 0.08   Aug 0.08   Sep 0.06   Oct 0.09   Nov 0.19   Dec 0.24
```

July–October 2020 runs at **6–9%** of 2019. That is collapsed health-seeking
and surveillance reporting, not transmission. A model scored on 2020 is scored
on a regime it was never shown.

**Recommended evaluation design:**

| Split | Months | Purpose |
|---|---|---|
| Train | 2016-01 → 2018-12 (36 mo × 17 = 612 rows) | Fit all three models |
| Test | 2019-01 → 2019-12 (12 mo × 17 = 204 rows) | **Headline** RMSE/MAE/MAPE/CRPS/coverage |
| Excluded | 2020 (204 rows) | Reported separately as an out-of-regime diagnostic |

2019 was itself a national epidemic year — a demanding but genuine test. State
this split explicitly in the paper; it is a defensible choice, but it is a
choice, and a reviewer will ask.

### 2c. Signal check — the objective is supported

Within-region (region-demeaned) correlation of `log(incidence)` against each
predictor, by lag in months — this is the variation a hierarchical model with
region effects actually fits:

| Predictor | lag 0 | lag 1 | lag 2 | lag 3 |
|---|---:|---:|---:|---:|
| temperature | −0.163 | 0.005 | 0.257 | **0.398** |
| humidity | 0.123 | **0.213** | 0.154 | −0.031 |
| precipitation | 0.059 | **0.191** | 0.173 | 0.083 |
| hot days | −0.180 | −0.123 | 0.045 | **0.200** |

Temperature at a three-month lag is the strongest single signal, which matches
the mosquito development → transmission → case-onset chain. **Lagged
predictors are essential** — at lag 0 the climate correlations are weak or
wrong-signed.

Between-region (n=17), the two static predictors are near-zero:

```
log population density   r = -0.042
log population           r = -0.120
```

**Population density, which the objective names, may well come out as an
uninfluential factor.** With 17 regions there is very little cross-sectional
power. That is a legitimate finding for objective #3 and should be reported as
such — not engineered away.

---

## 3. Objective → what has to exist

| Objective clause | Needs | Status today |
|---|---|---|
| ① Beat LSTM and SARIMA on RMSE, MAE, MAPE | 3 model runs + point metrics | ✅ schema has it; UI shows it |
| ② Quantify uncertainty via CRPS and interval coverage | CRPS + coverage **at named nominal levels** | ⚠️ one `coverage` column, no nominal level |
| ③ Identify which factors most influence predicted cases **per region** | per-run, per-region, per-feature importance with uncertainty | ❌ **nothing exists** |
| ④ Confirm uncertainty is reliably reportable as a credible interval | calibration evidence (PIT / reliability curve), interval width | ❌ **nothing exists** |

①. is close to done. ②–④ are the real work.

---

## 4. Schema changes

All additive; nothing existing is dropped.

### 4a. `regions` — hold both admin levels, and get a real unique key

```sql
ALTER TABLE regions
  ADD COLUMN slug          VARCHAR(40)  NULL AFTER id,
  ADD COLUMN admin_level   ENUM('region','province','municipality')
                           NOT NULL DEFAULT 'municipality' AFTER slug,
  ADD COLUMN psgc_code     VARCHAR(12)  NULL,
  ADD COLUMN land_area_km2 DECIMAL(10,2) NULL;

-- after backfilling slug ('R4A', 'NCR', 'CAR', …):
ALTER TABLE regions
  MODIFY slug VARCHAR(40) NOT NULL,
  ADD UNIQUE KEY uniq_region_slug (slug);
```

`land_area_km2` is what makes population density computable. The unique key on
`slug` also fixes the re-seed duplication found earlier (`regions` currently has
no unique constraint, so `INSERT IGNORE` in `seed.js` has nothing to catch on).

### 4b. `case_data` — mark the period type

Monthly regional rows and the existing annual municipal rows both live here.
Without a discriminator, any `SUM()` silently mixes them.

```sql
ALTER TABLE case_data
  ADD COLUMN period_type ENUM('month','year') NOT NULL DEFAULT 'month' AFTER date,
  DROP INDEX uniq_case_region_date,
  ADD UNIQUE KEY uniq_case_region_period (region_id, date, period_type);
```

### 4c. `climate_data` — add hot days

```sql
ALTER TABLE climate_data
  ADD COLUMN hot_days DECIMAL(6,2) NULL COMMENT 'days with Tmax > 35C; blank in source = 0';
```

### 4d. `demographic_data` — density becomes first-class

```sql
ALTER TABLE demographic_data
  ADD COLUMN population_density DECIMAL(10,2) NULL COMMENT 'persons per km2',
  ADD COLUMN source VARCHAR(40) NULL COMMENT 'census | interpolated | projection';
```

Values for 2016–2019 are linearly interpolated between the 2015 and 2020
censuses. `source` records that, so an interpolated figure is never mistaken
for an observation.

### 4e. `model_runs` — record the experiment, not just the model

```sql
ALTER TABLE model_runs
  ADD COLUMN train_start DATE NULL,
  ADD COLUMN train_end   DATE NULL,
  ADD COLUMN test_start  DATE NULL,
  ADD COLUMN test_end    DATE NULL,
  ADD COLUMN horizon_months TINYINT NULL,
  ADD COLUMN feature_set_json JSON NULL,
  ADD COLUMN notes TEXT NULL;
```

Without this, "the hybrid beat SARIMA" is unreproducible — the reader cannot
tell what window or feature set produced it.

### 4f. `predictions` — an interval needs its nominal level

`ci_lower`/`ci_upper` today carry no statement of *what* interval they are.
An 80% and a 95% interval are not comparable, and coverage cannot be assessed
without knowing the target.

```sql
CREATE TABLE IF NOT EXISTS prediction_intervals (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  prediction_id INT NOT NULL,
  nominal_level DECIMAL(5,2) NOT NULL COMMENT 'e.g. 50.00, 80.00, 95.00',
  lower         DECIMAL(10,2) NOT NULL,
  upper         DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_interval (prediction_id, nominal_level)
);

ALTER TABLE predictions
  ADD COLUMN actual_cases DECIMAL(10,2) NULL COMMENT 'observed, for backtest rows',
  ADD COLUMN predicted_median DECIMAL(10,2) NULL;
```

Keep `ci_lower`/`ci_upper` as the default 95% pair so nothing breaks.

### 4g. `evaluation_metrics` — scope, and coverage per level

```sql
ALTER TABLE evaluation_metrics
  ADD COLUMN scope        ENUM('overall','region') NOT NULL DEFAULT 'overall',
  ADD COLUMN region_id    INT NULL,
  ADD COLUMN n_obs        INT NULL,
  ADD COLUMN mean_interval_width DECIMAL(10,2) NULL COMMENT 'sharpness',
  ADD FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS interval_coverage (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id   INT NOT NULL,
  region_id      INT NULL,
  nominal_level  DECIMAL(5,2) NOT NULL,
  empirical_level DECIMAL(5,2) NOT NULL,
  mean_width     DECIMAL(10,2) NULL,
  n_obs          INT NOT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_cov (model_run_id, region_id, nominal_level)
);
```

Objective ④ is answered by `empirical_level ≈ nominal_level` across levels.
`mean_width` is the necessary companion: an interval can be perfectly covered
and useless if it is wide enough to contain everything.

### 4h. `feature_importance` — new, for objective ③

```sql
CREATE TABLE IF NOT EXISTS feature_importance (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id  INT NOT NULL,
  region_id     INT NULL COMMENT 'NULL = global/pooled effect',
  feature       VARCHAR(60) NOT NULL,
  lag_months    TINYINT NULL,
  importance    DECIMAL(10,5) NOT NULL COMMENT 'posterior mean effect or SHAP value',
  ci_lower      DECIMAL(10,5) NULL,
  ci_upper      DECIMAL(10,5) NULL,
  method        VARCHAR(30) NOT NULL COMMENT 'posterior | shap | permutation',
  rank_in_scope SMALLINT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_fi (model_run_id, region_id, feature, lag_months, method)
);
```

`ci_lower`/`ci_upper` are what make this an *interpretability* result rather
than a leaderboard: a feature whose interval straddles zero is not influential,
and the UI must be able to say so. Given §2c, expect population density to land
there.

### 4i. `calibration_bins` — new, for objective ④

```sql
CREATE TABLE IF NOT EXISTS calibration_bins (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id INT NOT NULL,
  bin_lower    DECIMAL(5,4) NOT NULL,
  bin_upper    DECIMAL(5,4) NOT NULL,
  observed_freq DECIMAL(6,4) NOT NULL,
  n_obs        INT NOT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE
);
```

A PIT histogram. Flat = calibrated; U-shaped = overconfident; hump = too wide.

---

## 5. Backend changes

### 5a. New ETL: `backend/scripts/import-revised-dataset.js`

Parallels the existing `import-research-data.js` and reuses its patterns. It
must:

1. Insert the **17 region rows** (`admin_level='region'`, slug, land area).
2. Load **monthly cases + deaths** 2016–2020 → `case_data` (`period_type='month'`).
3. Load **four ERA5 variables** → `climate_data`, wide → long, `hot_days` blank → 0
   (flagged in the run report as an assumption, not silence).
4. Interpolate population 2016–2020 between the 2015/2020 censuses →
   `demographic_data` with `source='interpolated'`, and compute
   `population_density` from `land_area_km2`.
5. Optionally load urban % and poverty incidence.
6. **Refuse to load the 2008–2016 file** unless `--include-legacy-rates` is
   passed, and print the §2a artefact evidence when it is.

Report, in the same style as the existing ETL: the 4-vocabulary region
canonicalisation, the BARMM wrapped label, the Caraga municipality trap, the
hot-days blank convention, and the 2020 COVID break.

### 5b. Endpoints

| Method | Path | Serves |
|---|---|---|
| GET | `/api/regions?level=region` | The 17 regions for selectors and the map |
| GET | `/api/panel?regionId=&from=&to=` | The joined monthly panel — cases, incidence, all predictors |
| GET | `/api/models/compare?scope=overall\|region` | Point + probabilistic metrics side by side |
| GET | `/api/models/:runId/coverage` | `interval_coverage` rows for the reliability chart |
| GET | `/api/models/:runId/calibration` | `calibration_bins` for the PIT histogram |
| GET | `/api/models/:runId/importance?regionId=` | `feature_importance`, ranked |
| GET | `/api/predictions/:regionId?runId=&level=` | Forecast with the requested interval level |

`/api/cases/annual` stays for the existing CALABARZON map.

### 5c. Fix while in there

`seed.js` is not idempotent — re-running it duplicates model runs and demo
regions (this has already happened in the live DB: 6 model runs instead of 3).
The `uniq_region_slug` key from §4a plus `INSERT … ON DUPLICATE KEY UPDATE` for
`model_runs` fixes it.

---

## 6. Frontend changes

| Page | Change |
|---|---|
| **Risk map** | Add a **national 17-region** choropleth. Keep the CALABARZON municipal view as a second scope; a `level` toggle switches. Needs an ADM1 GeoJSON built by the existing `build-boundaries.js` (geoBoundaries ADM1, same CC-BY source, still no runtime API). |
| **Forecast** | Region selector over the 17 regions; monthly x-axis; **interval-level selector** (50/80/95) driven by `prediction_intervals`; overlay observed actuals on the test window so the reader sees hit vs miss. |
| **Model comparison** | Split into two panels: **point accuracy** (RMSE/MAE/MAPE) and **probabilistic** (CRPS, coverage, sharpness). State the train/test split on the page — the numbers are meaningless without it. |
| **Calibration** *(new)* | Reliability diagram: nominal vs empirical coverage with the 45° ideal line, plus the PIT histogram and mean interval width. This is objective ④ made visible. |
| **Drivers** *(new)* | Objective ③. Ranked feature effects with uncertainty intervals, global and per region; a small-multiples view showing how the ranking differs by region. Features whose interval crosses zero must be visually marked as *not distinguishable from no effect* — that is the honest reading and the whole point of the interpretability claim. |
| **Dashboard** | Hero becomes a national figure; retire the CALABARZON-specific framing. |
| **Data management** | Show panel coverage (regions × months loaded, gaps) rather than just recent rows. |

Reuse the existing design system throughout — tokens, `AsyncSection`, table
twins, the validated sequential ramp for the map. The Drivers page should use
the **diverging** palette (effects are signed) with a neutral grey midpoint,
not the sequential ramp.

---

## 7. Sequencing

1. ✅ **Schema migration** (§4) — **done**, see §7a.
2. ✅ **New ETL** (§5a) — **done**, see §7b.
3. ✅ **Endpoints** (§5b) — **done**, see §7c.
4. ✅ **Frontend** — **done**, see §7d.
5. ⏳ **Python model service** writes real `predictions`, `evaluation_metrics`,
   `interval_coverage`, `calibration_bins`, `feature_importance`.

Steps 2–4 can be done now against seeded fixtures; step 5 is the research work
and is unblocked by them.

### 7a. Step 1 — applied

`backend/migrations/002_objective_alignment.sql`, applied to `dengue_hybrid`.
Verified first on a clean database and then on a full clone of the live one;
all row counts preserved (149 regions / 696 cases / 6,720 climate / 568
demographic), and every API endpoint still returns 200.

| Change | Detail |
|---|---|
| `regions` | `slug` (unique), `admin_level`, `psgc_code`, `land_area_km2` |
| `case_data` | `period_type` week/month/year, backfilled from date shape — 692 → `year`, 4 → `week`; unique key now `(region_id, date, period_type)` |
| `climate_data` | `hot_days` |
| `demographic_data` | `population_density`, `source` |
| `model_runs` | train/test window, `horizon_months`, `feature_set_json`, `notes` |
| `predictions` | `predicted_median`, `actual_cases` |
| **new** | `prediction_intervals`, `interval_coverage`, `feature_importance`, `calibration_bins` |

Two supporting changes came out of doing it:

- **`migrate.js` is now a versioned runner.** `schema.sql` became
  `001_initial_schema.sql`; the runner applies each `NNN_*.sql` once against a
  `schema_migrations` ledger and *baselines* a pre-existing database rather
  than re-running 001 against tables that already exist. Without the ledger,
  `npm run migrate` would be unsafe to re-run — MySQL has no
  `ADD COLUMN IF NOT EXISTS`.
- **The statement splitter is a character scanner.** The naive `split(';')`
  cut an `ALTER TABLE` in half at a semicolon *inside* a `COMMENT '...'`
  literal. Caught by testing on a scratch database before the live one.

**Deferred: migration 003, the region identity unique key.** It cannot be
applied yet — three duplicate regions and three duplicate model runs exist from
a second `npm run seed`, and the key would fail against them. Removing rows is
a human decision, so it lives in `scripts/dedupe-seed-artifacts.js`:

```bash
npm run dedupe            # report only (default)
npm run dedupe -- --apply # delete
```

The dry run confirms the three duplicate region rows own **zero** dependent
rows, so removing them is risk-free. The duplicate model runs do own
predictions and metrics, which cascade — that is why they are behind a flag.

**Run and applied.** 6 rows removed (3 regions, 3 model runs);
`/api/models/compare` is back to 3. `003_region_identity.sql` then added the
`uniq_region_identity (admin_level, province, name)` key that had been blocked,
so a third `npm run seed` can no longer duplicate anything.

### 7b. Step 2 — applied

`backend/scripts/import-revised-dataset.js` (`npm run etl:revised`), with
`etl/regions-ph.js` and `etl/revised-sources.js` behind it.

```
regions            17 region rows (upserted on slug)
case_data       1,020 monthly rows (period_type='month')
climate_data    1,020 monthly rows (temperature, rainfall, humidity, hot_days)
demographic_data  119 rows (2010/2015/2020 census + 2016-2019 interpolated)
```

The panel is now one join away:

```sql
SELECT ... FROM case_data c
JOIN regions r          ON r.id = c.region_id AND r.admin_level = 'region'
JOIN climate_data cl    ON cl.region_id = r.id AND cl.date = c.date
JOIN demographic_data d ON d.region_id = r.id AND d.year = YEAR(c.date)
WHERE c.period_type = 'month';
-- 1,020 rows · 17 regions · 60 months
```

Idempotent — a second run reports the same counts and changes nothing.

**Guards it enforces rather than assumes:**

- **Refuses to load the 2008–2016 rate file**, and re-derives the evidence at
  run time instead of trusting a comment: it recomputes the period-3 statistic
  (41.2% of quarters rising, against 16.7% by chance) and prints the peak/trough
  months on every run. If the file is ever corrected, the guard stops firing on
  evidence rather than on faith.
- **Aborts if the 17 regional populations do not sum to 109,033,245**, PSA's own
  national total. That single assertion is what proves the region rows were
  picked out of a mixed hierarchy correctly.
- **Reports every look-alike it skipped** — the municipality of Caraga in Davao
  Oriental being the one that survives tightening.
- **Reports the hot-days convention** — 617 blank month-cells written as 0 —
  rather than silently filling them.

Two things came out of doing it:

- **The substring matcher was too loose.** `zamboanga` also matches *Zamboanga
  del Sur*, which at 1.05 M people over 4,484 km² is large enough to pass the
  region size guard; only row order was preventing a province being promoted to
  a region. Needles are now `zamboanga peninsula`, `ilocos region`, `bicol
  region`.
- **`/api/regions` had to become scope-aware.** Loading 17 regions alongside
  142 municipalities turned it into a 163-row mixed list, which put "National
  Capital Region" next to "Agdangan" in every selector. It now returns
  `slug`/`admin_level` and accepts `?level=region|province|municipality`; the
  three existing pages pass `municipality`, so their behaviour is unchanged
  (verified: 146 options, not 163).

---

### 7c. Step 3 — applied

Five endpoints, all returning 200 with the expected row counts:

| Endpoint | Rows | Objective |
|---|---:|---|
| `/api/panel` | 1,020 | ③ |
| `/api/panel?region=NCR` | 60 | ③ |
| `/api/models/compare` | 3 | ①, ② |
| `/api/models/3/coverage` | 21 | ②, ④ |
| `/api/models/3/calibration` | 10 | ④ |
| `/api/models/3/importance` | 56 | ③ |

`panelController.js` is new; `modelsController.js` gained the three run
endpoints. Bad input is rejected rather than coerced — `scope=bogus`,
`runId=abc` and `runId=0` all return 400 with a message naming the valid
values. A run that simply has not produced an output yet returns `[]`, so the
UI can tell "not computed" from "failed".

**Two design choices that carry study meaning:**

- `crosses_zero` is computed in SQL, not left to the client. An effect whose
  interval spans zero is not distinguishable from no effect; deriving it once
  server-side means no consumer can forget to show it. On the fixtures it
  correctly flags `hot_days`, `population` and `population_density`.
- `mean_width` travels with every coverage row. Coverage alone is not evidence
  — a wide enough interval always covers.

**Demo fixtures** — `npm run seed:fixtures` populates the three new tables so
step 4 can be built and reviewed before the Python service exists. Every value
is invented and every run it touches is stamped
`notes = 'DEMO FIXTURE — illustrative values, not a real fit'`, which the UI
must surface. `-- --clear` removes them. The *shapes* are chosen to exercise
the pages honestly: SARIMA and LSTM are overconfident (empirical coverage
15–19 points below nominal, U-shaped PIT), the hybrid is calibrated (within
1 point, flat PIT), and the feature effects reproduce the lag structure
actually measured in §2c.

**Three bugs found while building, all caught by testing:**

1. **A backtick inside a JS template literal.** A SQL comment written as
   `` `period` `` terminated the string and the module failed to parse.
2. **A colon inside a SQL comment.** With `namedPlaceholders: true`, mysql2
   scans the whole statement for `:name` — including comments. An example
   timestamp containing `16:00:00` registered `:00` as a bind parameter and the
   query died with *"Bind parameters must not contain undefined"*. The comment
   explaining the timezone trap caused its own bug. **Never put a colon in a
   SQL comment in this codebase.**
3. **`train_start` served as `2015-12-31`** when stored as `2016-01-01` — the
   documented DATE-serialisation trap, reaching the API this time. All four
   window dates and the panel's `period` are now `DATE_FORMAT`-ed in SQL, so
   they carry no timezone.

### 7d. Step 4 — applied

Eight pages, two themes, five widths: no errors, no 4xx, no horizontal overflow.

**Model comparison** now answers the objective's two questions separately —
*point accuracy* (RMSE/MAE/MAPE) and *uncertainty and calibration* (CRPS,
coverage, sharpness) — because a model can win outright on the first and be
useless on the second, and merging them into one ranking hides exactly the gap
the study exists to address. Interval width joins the table as a first-class
metric.

**Calibration** (new) carries objective ④ with two pieces of evidence, since
neither is sufficient alone: a reliability diagram of nominal vs empirical
coverage against the 45° ideal, and a PIT histogram. A reliability curve can
look acceptable while the PIT shows the distribution has the wrong shape.

**Drivers** (new) carries objective ③. Signed effects on a **diverging**
palette — blue↔orange, validated all-pairs in both modes (CVD ΔE 24.7 / 26.8),
with a grey midpoint, because the sequential ramp cannot express a sign. An
effect whose credible interval spans zero renders **hollow, in the neutral
colour, with an explicit label** — never colour alone. On the fixtures that is
hot days, population and population density, which is what §2c predicts.

**Risk map** gained a scope toggle: the 17 regions (monthly, with a month
selector) or the 142 CALABARZON municipalities (annual). Attribution, stat
labels and footnotes all follow the scope.

A shared **EvaluationBanner** puts the train/test window and the DEMO FIXTURE
warning on all three model pages. A page rendering invented numbers without
saying so is the worst thing this UI could do.

**Three bugs found by testing:**

1. **A broken Douglas-Peucker, live since the map was first built.** A GeoJSON
   ring is *closed*, so its first and last vertex are identical; the initial
   baseline had zero length, every perpendicular distance measured 0, nothing
   cleared eps, and the function returned its input untouched. My earlier
   conclusion — "geoBoundaries' simplified layer is already coarser than eps" —
   was **wrong**. Anchoring on the vertex farthest from the start fixes it:
   national 71,679 → 19,169 points (−73%, 1,159 → 318 kB), municipal
   12,807 → 7,700 (−40%, 259 → 166 kB). The committed CALABARZON map had been
   ~36% oversized all along.
2. **Duplicate React keys on the map.** The key was `province-key`; the
   national features carry neither property, so all 17 evaluated to
   `undefined-undefined`. React could not tell them apart and **16 stale region
   paths survived a scope switch**, leaving 158 shapes where there should have
   been 142. Now keyed on slug, falling back to province+key.
3. **A self-contradicting verdict badge** reading "Well calibrated:
   overconfident…". Below 3 points of gap the direction is noise, so it is no
   longer named.

## 8. Open decisions — these need your call

1. **Scope of the app.** Does CALABARZON municipal-level stay as a secondary
   view, or is the project now purely national/regional? This drives whether the
   142-LGU map and its ETL are kept or retired. *Recommendation: keep both —
   the code exists, and the municipal view is a genuine strength the regional
   data cannot reproduce.*
2. ~~**The 2008–2016 file.**~~ **Decided: excluded.** The period-3 artefact
   disqualifies it as a monthly series. The ETL in §5a will refuse to load it
   unless `--include-legacy-rates` is passed, and will print the §2a evidence
   when it is. Chasing the original publisher to explain the ordering is still
   worthwhile — it would more than double the panel — but nothing depends on it.
3. **2020.** Exclude from headline evaluation (recommended), or include with a
   COVID indicator variable? The latter is defensible but costs a degree of
   freedom you can barely afford at 36 training months.
4. **Hot days.** Confirm blanks mean zero. If they mean "not computed", the
   variable loses ~73% of its values and should be dropped.
5. **Optional covariates.** Urban % and poverty incidence are available at
   region level for 2015/2018/2020 only. Include as static covariates, or leave
   out to keep the feature set to the six the objective names?

### Audit scripts

The analysis behind §1–2 lives in the session scratchpad, not the repo:
`rev_audit.py` (file inventory), `rev_recon.py` (the two dengue series),
`rev_era5.py` (climate coverage), `rev_density.py` (population and land area),
`rev_panel.py` (the joined panel, signal check, COVID check). Say the word and
I will move them under `backend/scripts/etl/` alongside the ETL they justify.
