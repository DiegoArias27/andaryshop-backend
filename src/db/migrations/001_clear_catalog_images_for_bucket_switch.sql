-- One-time cleanup after switching to a new Cloudflare R2 bucket/account:
-- every existing catalog image URL still points at the old bucket, which
-- stays reachable and keeps serving them fine, so nothing actually breaks
-- on its own. This clears those references so the admin sees "sin imagen"
-- everywhere and is forced to re-upload each photo fresh into the new
-- bucket. Deliberately leaves order_items.main_image_url and
-- returns.new_main_image_url untouched — those are historical snapshots of
-- what was actually sold/exchanged, not live catalog images.

UPDATE categories SET image_url = NULL;
UPDATE packages_tile SET image_url = NULL;
UPDATE products SET main_image_url = NULL, main_thumb_url = NULL;
DELETE FROM product_images;
UPDATE collections SET banner_image_url = NULL;
UPDATE banners SET image_url = '', image_url_mobile = NULL;
DELETE FROM media_library;
