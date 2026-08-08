-- 003_region_identity.sql
--
-- Adds the unique key that stops `regions` accumulating duplicates.
--
-- Deferred out of 002 because it cannot be applied to a database that already
-- contains duplicates, and removing rows is a human decision. Run
-- `npm run dedupe -- --apply` first if this migration fails with
-- "Duplicate entry" - that script reports exactly which rows collide and what
-- dependent data each one owns.
--
-- Why two keys rather than one:
--   * uniq_region_slug (added in 002) constrains rows that HAVE a slug. MySQL
--     permits repeated NULLs in a unique index, so the pre-existing municipal
--     rows are not affected by it.
--   * uniq_region_identity constrains everything by natural identity, which is
--     what `seed.js` and the municipal ETL actually upsert on.
--
-- `province` is NULL for admin_level='region' rows. Repeated NULLs are allowed
-- in a MySQL unique index, so the 17 regions are not constrained by this key -
-- they are constrained by their slug instead, which is never NULL for them.

ALTER TABLE regions
  ADD UNIQUE KEY uniq_region_identity (admin_level, province, name);
