-- 002_objective_alignment.sql
--
-- Brings the schema up to the finalised study objective. See
-- markdown/REVISION_PLAN.md section 4 for the reasoning behind each change.
--
-- The objective makes four claims. 001 could only support the first:
--   1. point accuracy vs LSTM and SARIMA   -> rmse / mae / mape        (existed)
--   2. uncertainty and calibration          -> crps, interval_coverage  (added here)
--   3. which factors influence cases        -> feature_importance       (added here)
--   4. intervals are reliably reportable    -> calibration_bins         (added here)
--
-- Everything here is additive. No column is dropped and no row is deleted.
-- One index is replaced (case_data) because its replacement is strictly wider.
--
-- NOT included, deliberately: the unique key on region identity. Three
-- duplicate region rows and three duplicate model runs exist from a second
-- `npm run seed`, and adding that key would fail against them. Removing rows
-- is a decision for a human, so it lives in scripts/dedupe-seed-artifacts.js
-- and 003 adds the key once that has been run.

-- ---------------------------------------------------------------------------
-- 1. regions: hold both administrative levels, and gain a real identity column
-- ---------------------------------------------------------------------------
-- The study unit is the 17 administrative regions; the existing 142 CALABARZON
-- municipalities stay as a second scope. `admin_level` keeps them apart so a
-- query can never sum a region and its own municipalities together.
--
-- `slug` is the stable key the ETL upserts on ('R4A', 'NCR', 'CAR'). It is
-- NULLable because MySQL permits repeated NULLs in a unique index, which lets
-- the pre-existing municipal rows coexist un-slugged.
--
-- `land_area_km2` is what makes population density computable at all - it is
-- the one field only the PSA density workbook carries.

ALTER TABLE regions
  ADD COLUMN slug          VARCHAR(40)   NULL AFTER id,
  ADD COLUMN admin_level   ENUM('region','province','municipality')
                           NOT NULL DEFAULT 'municipality' AFTER slug,
  ADD COLUMN psgc_code     VARCHAR(12)   NULL,
  ADD COLUMN land_area_km2 DECIMAL(10,2) NULL;

ALTER TABLE regions
  ADD UNIQUE KEY uniq_region_slug (slug);

CREATE INDEX idx_regions_level ON regions (admin_level);

-- ---------------------------------------------------------------------------
-- 2. case_data: never let two reporting periods be summed together
-- ---------------------------------------------------------------------------
-- Monthly regional rows (2016-2020) and annual municipal rows (2020-2024) now
-- share this table. Without a discriminator any SUM() silently mixes an annual
-- total with twelve monthly ones.

ALTER TABLE case_data
  ADD COLUMN period_type ENUM('week','month','year') NOT NULL DEFAULT 'month' AFTER date;

-- Backfill from the shape of the existing dates: the annual ETL stamps
-- YYYY-12-31, the seed writes weekly dates, monthly rows land on the 1st.
UPDATE case_data
   SET period_type = CASE
         WHEN MONTH(date) = 12 AND DAY(date) = 31 THEN 'year'
         WHEN DAY(date) = 1                       THEN 'month'
         ELSE 'week'
       END;

ALTER TABLE case_data
  DROP INDEX uniq_case_region_date,
  ADD UNIQUE KEY uniq_case_region_period (region_id, date, period_type);

-- ---------------------------------------------------------------------------
-- 3. climate_data: the fourth ERA5 variable
-- ---------------------------------------------------------------------------
-- Blank in the ERA5 source means "no days above 35 C", not "not measured" -
-- the ETL writes 0 and says so in its run report.

ALTER TABLE climate_data
  ADD COLUMN hot_days DECIMAL(6,2) NULL
    COMMENT 'days with Tmax above 35C; blank in ERA5 source is loaded as 0';

-- ---------------------------------------------------------------------------
-- 4. demographic_data: population density becomes first-class
-- ---------------------------------------------------------------------------
-- `source` exists so an interpolated figure is never mistaken for an
-- observation. Population for 2016-2019 is linear between the 2015 and 2020
-- censuses; there is no annual census to read.

ALTER TABLE demographic_data
  ADD COLUMN population_density DECIMAL(10,2) NULL COMMENT 'persons per km2',
  ADD COLUMN source VARCHAR(40) NULL COMMENT 'census | interpolated | projection';

-- ---------------------------------------------------------------------------
-- 5. model_runs: record the experiment, not just the model
-- ---------------------------------------------------------------------------
-- "The hybrid beat SARIMA" is unreproducible without the window and feature
-- set that produced it. This study trains on 2016-2018 and tests on 2019;
-- 2020 is excluded because COVID collapsed surveillance reporting.

ALTER TABLE model_runs
  ADD COLUMN train_start      DATE    NULL,
  ADD COLUMN train_end        DATE    NULL,
  ADD COLUMN test_start       DATE    NULL,
  ADD COLUMN test_end         DATE    NULL,
  ADD COLUMN horizon_months   TINYINT NULL,
  ADD COLUMN feature_set_json JSON    NULL,
  ADD COLUMN notes            TEXT    NULL;

-- ---------------------------------------------------------------------------
-- 6. predictions: an interval must state which interval it is
-- ---------------------------------------------------------------------------
-- ci_lower / ci_upper carry no nominal level, so an 80% and a 95% band are
-- indistinguishable and coverage cannot be assessed against a target. They are
-- kept as the default 95% pair so nothing existing breaks.

ALTER TABLE predictions
  ADD COLUMN predicted_median DECIMAL(10,2) NULL,
  ADD COLUMN actual_cases     DECIMAL(10,2) NULL
    COMMENT 'observed value for backtest rows; NULL for true out-of-sample';

CREATE TABLE IF NOT EXISTS prediction_intervals (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  prediction_id INT NOT NULL,
  nominal_level DECIMAL(5,2) NOT NULL COMMENT 'e.g. 50.00, 80.00, 95.00',
  lower         DECIMAL(10,2) NOT NULL,
  upper         DECIMAL(10,2) NOT NULL,
  FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_prediction_interval (prediction_id, nominal_level)
);

-- ---------------------------------------------------------------------------
-- 7. evaluation_metrics: scope, and sharpness alongside coverage
-- ---------------------------------------------------------------------------
-- Objective 3 asks for influence *per region*, so metrics need a per-region
-- scope too. `mean_interval_width` is the necessary companion to coverage: an
-- interval wide enough to contain everything has perfect coverage and no value.

ALTER TABLE evaluation_metrics
  ADD COLUMN scope               ENUM('overall','region') NOT NULL DEFAULT 'overall',
  ADD COLUMN region_id           INT NULL,
  ADD COLUMN n_obs               INT NULL,
  ADD COLUMN mean_interval_width DECIMAL(10,2) NULL COMMENT 'sharpness',
  ADD FOREIGN KEY fk_eval_region (region_id) REFERENCES regions(id) ON DELETE CASCADE;

-- Objective 4 is answered by empirical_level tracking nominal_level across
-- several levels. A single 95% band cannot demonstrate calibration.
CREATE TABLE IF NOT EXISTS interval_coverage (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id    INT NOT NULL,
  region_id       INT NULL COMMENT 'NULL = pooled across all regions',
  nominal_level   DECIMAL(5,2) NOT NULL,
  empirical_level DECIMAL(5,2) NOT NULL,
  mean_width      DECIMAL(10,2) NULL,
  n_obs           INT NOT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id)    REFERENCES regions(id)    ON DELETE CASCADE,
  UNIQUE KEY uniq_coverage (model_run_id, region_id, nominal_level)
);

-- ---------------------------------------------------------------------------
-- 8. feature_importance: objective 3
-- ---------------------------------------------------------------------------
-- ci_lower / ci_upper are what make this interpretability rather than a
-- leaderboard: an effect whose interval straddles zero is not influential, and
-- the UI has to be able to say so. With only 17 regions, population density is
-- expected to land exactly there.
--
-- lag_months is part of the identity because the same variable at different
-- lags is a different predictor - temperature at lag 3 carries the signal,
-- temperature at lag 0 does not.

CREATE TABLE IF NOT EXISTS feature_importance (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id  INT NOT NULL,
  region_id     INT NULL COMMENT 'NULL = global/pooled effect',
  feature       VARCHAR(60) NOT NULL,
  lag_months    TINYINT NULL,
  importance    DECIMAL(12,6) NOT NULL COMMENT 'posterior mean effect or SHAP value',
  ci_lower      DECIMAL(12,6) NULL,
  ci_upper      DECIMAL(12,6) NULL,
  method        VARCHAR(30) NOT NULL COMMENT 'posterior | shap | permutation',
  rank_in_scope SMALLINT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (region_id)    REFERENCES regions(id)    ON DELETE CASCADE,
  UNIQUE KEY uniq_feature_importance (model_run_id, region_id, feature, lag_months, method)
);

-- ---------------------------------------------------------------------------
-- 9. calibration_bins: objective 4
-- ---------------------------------------------------------------------------
-- A PIT histogram. Flat means calibrated, U-shaped means overconfident,
-- hump-shaped means the intervals are too wide.

CREATE TABLE IF NOT EXISTS calibration_bins (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  model_run_id  INT NOT NULL,
  bin_lower     DECIMAL(5,4) NOT NULL,
  bin_upper     DECIMAL(5,4) NOT NULL,
  observed_freq DECIMAL(6,4) NOT NULL,
  n_obs         INT NOT NULL,
  FOREIGN KEY (model_run_id) REFERENCES model_runs(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_calibration_bin (model_run_id, bin_lower, bin_upper)
);
