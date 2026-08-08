-- 004_model_output_keys.sql
--
-- Makes the model service's writes idempotent.
--
-- `predictions` and `evaluation_metrics` shipped without a unique key, so a
-- second run of the same experiment appends a duplicate set instead of
-- replacing it. That is not a hypothetical: the same omission on `regions` and
-- `model_runs` is what let a second `npm run seed` produce three duplicate
-- regions and three duplicate model runs, which then had to be deleted by hand
-- (scripts/dedupe-seed-artifacts.js) before 003 could add its key.
--
-- Re-running is the NORMAL case for a model service - refit, rescore, rewrite -
-- so these keys let it use INSERT ... ON DUPLICATE KEY UPDATE and stay
-- correct no matter how many times it runs.
--
-- `model_runs` deliberately gets no key: every training run SHOULD be a new
-- row. That is what makes the app a run-comparison tool rather than a display
-- of whichever fit happened last.
--
-- See markdown/MODEL_SERVICE.md for the full write contract.

-- One prediction per model run, region and target month.
ALTER TABLE predictions
  ADD UNIQUE KEY uniq_prediction (model_run_id, region_id, date);

-- One metrics row per run per scope. region_id is NULL for scope='overall';
-- MySQL permits repeated NULLs in a unique index, so the overall row is
-- constrained by (model_run_id, scope) in practice while the per-region rows
-- are constrained by all three columns.
ALTER TABLE evaluation_metrics
  ADD UNIQUE KEY uniq_eval (model_run_id, scope, region_id);
