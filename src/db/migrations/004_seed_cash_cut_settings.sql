-- Same bug as 002_seed_app_settings.sql: cash_cut_settings (schema.sql)
-- never had an INSERT anywhere, only its own CREATE TABLE — so a database
-- that only ran schema.sql has zero rows in it. getCashCutSettings then
-- finds no row, res.json(rows[0]) sends `undefined` as an empty 200 body,
-- and the admin's fetch client silently fails to parse it as JSON (caught
-- and swallowed in CashCuts.tsx) — the whole "Corte automático" toggle
-- section just never renders, with no visible error. INSERT IGNORE so this
-- stays safe to leave in place if schema_migrations is ever reset/replayed.

INSERT IGNORE INTO cash_cut_settings (id) VALUES (1);
