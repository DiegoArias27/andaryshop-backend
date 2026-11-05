-- app_settings (schema.sql) never had an INSERT anywhere — only its own
-- CREATE TABLE — so a database that only ever ran schema.sql has zero rows
-- in it. getSettings/updateSettings (settings.controller.js) then find no
-- row, res.json(undefined) sends an empty 200 body, and the admin's fetch
-- client crashes trying to parse it as JSON ("Unexpected end of JSON
-- input"). INSERT IGNORE instead of a plain INSERT so this is still safe to
-- leave in place if schema_migrations is ever reset or replayed by hand.

INSERT IGNORE INTO app_settings (id) VALUES (1);
