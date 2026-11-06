-- Mirrors wholesale_tiers.is_featured (schema.sql) — lets the admin pin
-- which priced bundle part (a "N unidades de esta categoría por $X" tier)
-- shows the "Más elegido" ribbon, instead of only ever letting it be
-- decided automatically from real sales (collections.most_chosen_tier_key).

ALTER TABLE collection_bundle_parts
  ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0 AFTER price;
