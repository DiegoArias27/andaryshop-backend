-- Playera-specific attribute (admin shows the switch only for that
-- category) — nullable since it doesn't apply to every product.
ALTER TABLE products
  ADD COLUMN neck_type ENUM('redondo', 'polo') NULL AFTER category_id;
