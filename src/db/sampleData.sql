-- Optional sample data for local development/demo purposes.
-- Run after schema.sql: mysql -u root -p andary_shop < src/db/sampleData.sql
-- Images point to placeholder URLs (picsum.photos) — replace with real
-- Cloudflare R2 URLs once you upload real product photos via the admin API.

INSERT INTO categories (name, slug) VALUES
  ('Playeras', 'playeras'),
  ('Gorras', 'gorras');

INSERT INTO brands (name, slug) VALUES
  ('Andary Originals', 'andary-originals'),
  ('Urban Co', 'urban-co'),
  ('Street Basics', 'street-basics'),
  ('Blackline', 'blackline');

INSERT INTO products (category_id, brand_id, name, slug, description, price, main_image_url, is_new, is_featured) VALUES
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'andary-originals'), 'Playera Urban Elite', 'playera-urban-elite',
   'Oversized fit, 100% algodón premium. Diseñada para máxima comodidad y estilo urbano. Eleva tu streetwear diario con esta pieza esencial.',
   35.00, 'https://picsum.photos/seed/andary-tee-1/900/1200', 1, 0),
  ((SELECT id FROM categories WHERE slug = 'gorras'), (SELECT id FROM brands WHERE slug = 'urban-co'), 'Gorra Minimalist', 'gorra-minimalist',
   'Estructurada, ajustable, bordado minimalista. El complemento perfecto para cualquier look urbano.',
   25.00, 'https://picsum.photos/seed/andary-cap-1/900/1200', 1, 0),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'street-basics'), 'Basic Red Tee', 'basic-red-tee',
   'Playera básica de corte regular en rojo. 100% algodón peinado, ideal para combinar con todo.',
   22.00, 'https://picsum.photos/seed/andary-tee-2/900/1200', 0, 1),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'street-basics'), 'Playera Oversize Blanca', 'playera-oversize-blanca',
   'Corte oversize, algodón peinado 100%. Silueta relajada para un look urbano sin esfuerzo.',
   32.00, 'https://picsum.photos/seed/andary-tee-3/900/1200', 1, 0),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'blackline'), 'Playera Graphic Skull', 'playera-graphic-skull',
   'Estampado gráfico frontal, tela premium con caída suave. Edición limitada.',
   38.00, 'https://picsum.photos/seed/andary-tee-4/900/1200', 1, 1),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'urban-co'), 'Playera Street Stripes', 'playera-street-stripes',
   'Rayas contrastantes, fit regular. Versátil para el día a día.',
   30.00, 'https://picsum.photos/seed/andary-tee-5/900/1200', 0, 0),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'andary-originals'), 'Playera Essential Black', 'playera-essential-black',
   'El básico que no puede faltar. Algodón grueso, corte recto, negro profundo.',
   28.00, 'https://picsum.photos/seed/andary-tee-6/900/1200', 0, 1),
  ((SELECT id FROM categories WHERE slug = 'gorras'), (SELECT id FROM brands WHERE slug = 'blackline'), 'Gorra Trucker Red', 'gorra-trucker-red',
   'Panel frontal estructurado, malla trasera transpirable. Ajuste snapback.',
   27.00, 'https://picsum.photos/seed/andary-cap-2/900/1200', 1, 0),
  ((SELECT id FROM categories WHERE slug = 'gorras'), (SELECT id FROM brands WHERE slug = 'urban-co'), 'Gorra Snapback Classic', 'gorra-snapback-classic',
   'Bordado 3D, visera plana. Estilo urbano clásico.',
   26.00, 'https://picsum.photos/seed/andary-cap-3/900/1200', 0, 0),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'blackline'), 'Playera Tie-Dye Sunset', 'playera-tie-dye-sunset',
   'Teñido artesanal degradado, cada pieza es única. Algodón 100% suave.',
   36.00, 'https://picsum.photos/seed/andary-tee-7/900/1200', 1, 0),
  ((SELECT id FROM categories WHERE slug = 'playeras'), (SELECT id FROM brands WHERE slug = 'urban-co'), 'Playera Varsity Number', 'playera-varsity-number',
   'Estilo universitario, número bordado en el pecho. Fit clásico.',
   34.00, 'https://picsum.photos/seed/andary-tee-8/900/1200', 0, 0),
  ((SELECT id FROM categories WHERE slug = 'gorras'), (SELECT id FROM brands WHERE slug = 'street-basics'), 'Gorra Corduroy Beige', 'gorra-corduroy-beige',
   'Pana suave, ajuste con hebilla trasera. Look retro.',
   29.00, 'https://picsum.photos/seed/andary-cap-4/900/1200', 1, 0);

INSERT INTO product_variants (product_id, size, color_name, color_hex, barcode, stock) VALUES
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'S', 'Negro', '#0d0d0d', '750000000101', 12),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'M', 'Negro', '#0d0d0d', '750000000102', 20),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'L', 'Negro', '#0d0d0d', '750000000103', 15),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'XL', 'Negro', '#0d0d0d', '750000000104', 0),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'S', 'Blanco', '#ffffff', '750000000105', 8),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'M', 'Blanco', '#ffffff', '750000000106', 10),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'L', 'Blanco', '#ffffff', '750000000107', 6),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'M', 'Gris', '#8a8a8a', '750000000108', 14),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'L', 'Gris', '#8a8a8a', '750000000109', 9),

  ((SELECT id FROM products WHERE slug = 'gorra-minimalist'), 'S/M', 'Negro', '#0d0d0d', '750000000201', 18),
  ((SELECT id FROM products WHERE slug = 'gorra-minimalist'), 'L/XL', 'Negro', '#0d0d0d', '750000000202', 11),
  ((SELECT id FROM products WHERE slug = 'gorra-minimalist'), 'S/M', 'Gris', '#8a8a8a', '750000000203', 7),

  ((SELECT id FROM products WHERE slug = 'basic-red-tee'), 'S', 'Rojo', '#e01230', '750000000401', 16),
  ((SELECT id FROM products WHERE slug = 'basic-red-tee'), 'M', 'Rojo', '#e01230', '750000000402', 22),
  ((SELECT id FROM products WHERE slug = 'basic-red-tee'), 'L', 'Rojo', '#e01230', '750000000403', 4),

  ((SELECT id FROM products WHERE slug = 'playera-oversize-blanca'), 'M', 'Blanco', '#ffffff', '750000000501', 15),
  ((SELECT id FROM products WHERE slug = 'playera-oversize-blanca'), 'L', 'Blanco', '#ffffff', '750000000502', 12),
  ((SELECT id FROM products WHERE slug = 'playera-oversize-blanca'), 'M', 'Negro', '#0d0d0d', '750000000503', 9),

  ((SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 'S', 'Negro', '#0d0d0d', '750000000504', 10),
  ((SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 'M', 'Negro', '#0d0d0d', '750000000505', 14),
  ((SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 'L', 'Negro', '#0d0d0d', '750000000506', 6),

  ((SELECT id FROM products WHERE slug = 'playera-street-stripes'), 'M', 'Gris', '#8a8a8a', '750000000507', 11),
  ((SELECT id FROM products WHERE slug = 'playera-street-stripes'), 'L', 'Gris', '#8a8a8a', '750000000508', 8),

  ((SELECT id FROM products WHERE slug = 'playera-essential-black'), 'S', 'Negro', '#0d0d0d', '750000000509', 20),
  ((SELECT id FROM products WHERE slug = 'playera-essential-black'), 'M', 'Negro', '#0d0d0d', '750000000510', 25),
  ((SELECT id FROM products WHERE slug = 'playera-essential-black'), 'L', 'Negro', '#0d0d0d', '750000000511', 18),
  ((SELECT id FROM products WHERE slug = 'playera-essential-black'), 'XL', 'Negro', '#0d0d0d', '750000000512', 7),

  ((SELECT id FROM products WHERE slug = 'gorra-trucker-red'), 'S/M', 'Rojo', '#e01230', '750000000513', 13),
  ((SELECT id FROM products WHERE slug = 'gorra-trucker-red'), 'L/XL', 'Rojo', '#e01230', '750000000514', 9),

  ((SELECT id FROM products WHERE slug = 'gorra-snapback-classic'), 'S/M', 'Negro', '#0d0d0d', '750000000515', 16),
  ((SELECT id FROM products WHERE slug = 'gorra-snapback-classic'), 'S/M', 'Blanco', '#ffffff', '750000000516', 10),

  ((SELECT id FROM products WHERE slug = 'playera-tie-dye-sunset'), 'S', 'Multicolor', '#e01230', '750000000601', 9),
  ((SELECT id FROM products WHERE slug = 'playera-tie-dye-sunset'), 'M', 'Multicolor', '#e01230', '750000000602', 13),
  ((SELECT id FROM products WHERE slug = 'playera-tie-dye-sunset'), 'L', 'Multicolor', '#e01230', '750000000603', 7),

  ((SELECT id FROM products WHERE slug = 'playera-varsity-number'), 'M', 'Negro', '#0d0d0d', '750000000604', 12),
  ((SELECT id FROM products WHERE slug = 'playera-varsity-number'), 'L', 'Negro', '#0d0d0d', '750000000605', 10),
  ((SELECT id FROM products WHERE slug = 'playera-varsity-number'), 'M', 'Blanco', '#ffffff', '750000000606', 8),

  ((SELECT id FROM products WHERE slug = 'gorra-corduroy-beige'), 'S/M', 'Beige', '#d8c9a8', '750000000607', 14),
  ((SELECT id FROM products WHERE slug = 'gorra-corduroy-beige'), 'L/XL', 'Beige', '#d8c9a8', '750000000608', 10);

-- Extra gallery photos (main_image_url already covers photo #1 of each product)
INSERT INTO product_images (product_id, image_url, sort_order) VALUES
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'https://picsum.photos/seed/andary-tee-1b/900/1200', 0),
  ((SELECT id FROM products WHERE slug = 'playera-urban-elite'), 'https://picsum.photos/seed/andary-tee-1c/900/1200', 1),

  ((SELECT id FROM products WHERE slug = 'basic-red-tee'), 'https://picsum.photos/seed/andary-tee-2b/900/1200', 0),
  ((SELECT id FROM products WHERE slug = 'basic-red-tee'), 'https://picsum.photos/seed/andary-tee-2c/900/1200', 1),

  ((SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 'https://picsum.photos/seed/andary-tee-4b/900/1200', 0),
  ((SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 'https://picsum.photos/seed/andary-tee-4c/900/1200', 1),
  ((SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 'https://picsum.photos/seed/andary-tee-4d/900/1200', 2),

  ((SELECT id FROM products WHERE slug = 'gorra-minimalist'), 'https://picsum.photos/seed/andary-cap-1b/900/1200', 0),
  ((SELECT id FROM products WHERE slug = 'gorra-minimalist'), 'https://picsum.photos/seed/andary-cap-1c/900/1200', 1);

INSERT INTO wholesale_tiers (min_qty, max_qty, price_per_unit, sort_order) VALUES
  (1, 3, 550.00, 0),
  (4, 5, 350.00, 1),
  (6, 9, 333.00, 2),
  (10, 19, 290.00, 3),
  (20, 49, 275.00, 4),
  (50, 69, 260.00, 5),
  (70, 100, 250.00, 6);

-- Default homepage sections, now admin-editable collections instead of
-- hardcoded is_new/is_featured grids.
INSERT INTO collections (name, slug, description, pricing_mode, is_active, sort_order) VALUES
  ('Lo más nuevo', 'lo-mas-nuevo', '', 'none', 1, 0),
  ('Lo más pedido', 'lo-mas-pedido', '', 'none', 1, 1),
  ('Prueba', 'prueba', '', 'none', 1, 2);

INSERT INTO collection_products (collection_id, product_id, sort_order) VALUES
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'playera-urban-elite'), 0),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'gorra-minimalist'), 1),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'playera-oversize-blanca'), 2),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 3),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'gorra-trucker-red'), 4),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'playera-tie-dye-sunset'), 5),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-nuevo'), (SELECT id FROM products WHERE slug = 'gorra-corduroy-beige'), 6),

  ((SELECT id FROM collections WHERE slug = 'lo-mas-pedido'), (SELECT id FROM products WHERE slug = 'basic-red-tee'), 0),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-pedido'), (SELECT id FROM products WHERE slug = 'playera-graphic-skull'), 1),
  ((SELECT id FROM collections WHERE slug = 'lo-mas-pedido'), (SELECT id FROM products WHERE slug = 'playera-essential-black'), 2);

INSERT INTO collection_products (collection_id, product_id, sort_order, discount_price) VALUES
  ((SELECT id FROM collections WHERE slug = 'prueba'), (SELECT id FROM products WHERE slug = 'playera-varsity-number'), 0, 5.00),
  ((SELECT id FROM collections WHERE slug = 'prueba'), (SELECT id FROM products WHERE slug = 'gorra-corduroy-beige'), 1, NULL),
  ((SELECT id FROM collections WHERE slug = 'prueba'), (SELECT id FROM products WHERE slug = 'gorra-trucker-red'), 2, 17.00);
