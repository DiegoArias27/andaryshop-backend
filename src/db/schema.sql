-- ANDARY SHOP database schema
-- Run this once against your MySQL database (e.g. `mysql -u root -p andary_shop < src/db/schema.sql`)

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Storefront customer accounts. A customer registers/logs in with email OR
-- phone + password, or via Google (password_hash stays NULL for Google-only
-- accounts). At least one of email/phone is required — enforced in the
-- controller since MySQL CHECK constraints aren't reliably enforced pre-8.0.16.
CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(190) NULL UNIQUE,
  phone VARCHAR(30) NULL UNIQUE,
  password_hash VARCHAR(255) NULL,
  google_id VARCHAR(64) NULL UNIQUE,
  -- Flat currency amount taken off EVERY unit in every order this customer
  -- places (on top of whatever collection/wholesale pricing already
  -- applies) — set from the admin's Clientes page ("cliente frecuente"),
  -- keyed by email since the admin can set this before the person ever logs
  -- in (googleLogin links an existing email row to the new google_id).
  -- 0 = no special treatment.
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- One row per customer, holding their cart and favorites as JSON so they
-- follow the account across devices instead of living only in localStorage.
CREATE TABLE IF NOT EXISTS customer_data (
  customer_id INT NOT NULL PRIMARY KEY,
  cart_json JSON NULL,
  favorites_json JSON NULL,
  -- { [categorySlug]: size } — the "para mayor experiencia" size-picker
  -- modal's per-category preference, mirrored from localStorage once logged in.
  size_preferences_json JSON NULL,
  -- Saved Cotizador quotes — [{ id, createdAt, quantities }], mirrored from
  -- sessionStorage once logged in (guests only keep quotes for the tab's
  -- lifetime; an account keeps them until deleted or fulfilled).
  quotes_json JSON NULL,
  -- { sizes: string[], brands: string[], sizesTouched: boolean } — the
  -- catalog's Talla/Marca filter, mirrored from sessionStorage once logged
  -- in (guests only keep it for the tab's lifetime; an account keeps it
  -- until changed).
  catalog_filters_json JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_customer_data_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  -- Optional overrides for the storefront's "shop by category" tile (see
  -- CategoryShowcase in frontend) — NULL falls back to an auto-picked
  -- product photo / a generic tagline.
  image_url VARCHAR(500) NULL,
  tagline VARCHAR(255) NULL,
  -- Where image_url is anchored within its box (CSS background-position,
  -- percent — 50/50 is centered).
  image_focus_x TINYINT UNSIGNED NOT NULL DEFAULT 50,
  image_focus_y TINYINT UNSIGNED NOT NULL DEFAULT 50,
  -- NULL = background-size: cover (fills the box, the original behavior).
  -- Set = an explicit background-size percent instead, letting the admin
  -- shrink the photo within its box (e.g. 60) instead of always cropping to
  -- fill it.
  image_zoom TINYINT UNSIGNED NULL,
  -- NULL = the tile's own default dark gradient over the photo (for text
  -- legibility). Set = a 0-150 percent multiplier scaling that gradient's
  -- opacity — same idea as banners.scrim_opacity.
  scrim_opacity TINYINT UNSIGNED NULL,
  sort_order INT NOT NULL DEFAULT 0,
  -- 0 = kept out of customer-facing category browsing (the home page's
  -- "Comprar por categoría" tiles, the catalog's Playeras/Gorras/... filter
  -- pills) while still usable everywhere a category is just a pricing/
  -- grouping key — e.g. Mayoreo's wholesale_tiers, or the Cotizador tool's
  -- Pants/Paq. 3 Boss rows, neither of which has real browsable products
  -- yet. Default 1 (shown), same as every category before this existed.
  show_in_nav TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Single fixed row (id always 1) of overrides for the storefront home
-- page's fixed "Paquetes" tile in "Comprar por categoría" (CategoryShowcase
-- in Catalog.tsx) — same idea as categories.image_url/tagline above, but
-- for that one synthetic tile (it isn't a real row in `categories`, so it
-- had no admin control of its own before this). NULL fields fall back to
-- the same auto-picked product photo / fixed "Más piezas, mejor precio."
-- tagline the tile always used.
CREATE TABLE IF NOT EXISTS packages_tile (
  id TINYINT PRIMARY KEY DEFAULT 1,
  image_url VARCHAR(500) NULL,
  tagline VARCHAR(255) NULL,
  image_focus_x TINYINT UNSIGNED NOT NULL DEFAULT 50,
  image_focus_y TINYINT UNSIGNED NOT NULL DEFAULT 50,
  image_zoom TINYINT UNSIGNED NULL,
  scrim_opacity TINYINT UNSIGNED NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS brands (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NULL,
  brand_id INT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  description TEXT,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  main_image_url VARCHAR(500),
  -- Small catalog/list-grid version of main_image_url (same photo, ~480px)
  -- so the catalog grid, cart and favorites don't each pull the full
  -- up-to-2000px photo just to show a thumbnail. NULL for a product created
  -- before this existed — the frontend falls back to main_image_url. Kept in
  -- sync by the same code paths that keep main_image_url mirroring the
  -- gallery's first photo (see syncMainImage).
  main_thumb_url VARCHAR(500) NULL,
  is_new TINYINT(1) NOT NULL DEFAULT 0,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  -- Direct product-level sale price. NULL discount_type means no discount.
  discount_type ENUM('percent','fixed_price','amount_off') NULL,
  discount_value DECIMAL(10,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_products_brand FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  image_url VARCHAR(500) NOT NULL,
  -- Small catalog/list-grid companion to image_url — see products.main_thumb_url.
  thumb_url VARCHAR(500) NULL,
  -- NULL = shown for every color that has no dedicated photos of its own.
  color_name VARCHAR(60) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Each size/color combination is its own sellable variant, tracked by its own barcode.
CREATE TABLE IF NOT EXISTS product_variants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  size VARCHAR(20) NOT NULL,
  color_name VARCHAR(60) NOT NULL,
  color_hex VARCHAR(7) NOT NULL DEFAULT '#000000',
  barcode VARCHAR(64) NOT NULL UNIQUE,
  stock INT NOT NULL DEFAULT 0,
  -- Admin-controlled display order; also drives the color/size order shown
  -- on the storefront product detail page.
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  UNIQUE KEY uq_product_size_color (product_id, size, color_name)
) ENGINE=InnoDB;

-- Audit trail of stock adjustments made from the admin barcode scanner.
CREATE TABLE IF NOT EXISTS stock_movements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  variant_id INT NOT NULL,
  delta INT NOT NULL,
  resulting_stock INT NOT NULL,
  admin_email VARCHAR(190),
  -- Set when this movement came from confirming a sale in Pedidos (see
  -- orders.controller.js) — no FK constraint since orders is declared later
  -- in this file; purely a traceability breadcrumb, never joined on for
  -- correctness.
  order_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_movements_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Admin-curated homepage sections ("Colección Verano", etc.), each with its
-- own banner and a hand-picked set of products.
CREATE TABLE IF NOT EXISTS collections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  -- Admin-only short label used to tell apart two collections that
  -- deliberately share the same customer-facing `name` (e.g. two "Paquete
  -- de Playeras" collections for different seasons). Folded into slug
  -- generation (see createCollection/updateCollection) so slug's UNIQUE
  -- constraint doesn't collide just because `name` was intentionally
  -- reused. Never shown to customers — admin UI only.
  admin_tag VARCHAR(60) NULL,
  description TEXT,
  -- Collection-wide pricing override. 'unit' = every product in the
  -- collection sells at unit_price each (once unit_min_qty units from the
  -- collection are in the cart, or always if unit_min_qty is NULL).
  -- 'bundle' = bundle_qty units from the collection (mixed products
  -- allowed) cost bundle_price together.
  -- 'wholesale' = no fixed price of its own; the collection's pooled
  -- quantity in the cart is looked up against wholesale_tiers rows for
  -- wholesale_category_id (or the fallback, category_id IS NULL, rows when
  -- wholesale_category_id is NULL), same as a customer mixing any products
  -- to hit a bulk tier. The storefront renders one card per tier row
  -- ("1 a 3 piezas — $X c/u") instead of a single open-ended picker.
  -- 'combo' = a fixed set of per-category (optionally per-product, see
  -- collection_bundle_parts.product_id) quotas must each be met from the
  -- collection's products; once met, the non-gift quota's units cost
  -- bundle_price together and the gift quota's units are free.
  pricing_mode ENUM('none','unit','bundle','wholesale','combo') NOT NULL DEFAULT 'none',
  unit_price DECIMAL(10,2) NULL,
  unit_min_qty INT NULL,
  bundle_qty INT NULL,
  bundle_price DECIMAL(10,2) NULL,
  -- Only meaningful for pricing_mode = 'wholesale'. Which wholesale_tiers
  -- category to price against; NULL uses the fallback (no-category) tiers.
  wholesale_category_id INT NULL,
  -- When true, every active product in wholesale_category_id (or the whole
  -- catalog when wholesale_category_id is NULL) counts toward this
  -- collection's wholesale pricing, without needing to be added to
  -- collection_products by hand.
  wholesale_any_product TINYINT(1) NOT NULL DEFAULT 0,
  -- Only meaningful for pricing_mode = 'none' with curated collection_products
  -- (a specific hand-picked set, e.g. a themed outfit) — shows an "Añadir
  -- todo al carrito" button that adds one in-stock variant of each curated
  -- product at once, instead of requiring the customer to add them one by
  -- one. Left off by default so plain showcase collections ("Lo más nuevo")
  -- don't get a button that doesn't make sense for them.
  allow_add_all_to_cart TINYINT(1) NOT NULL DEFAULT 0,
  -- Free-text promo line shown on the banner before the CTA/add-to-cart button.
  promo_text VARCHAR(300) NULL,
  banner_image_url VARCHAR(500),
  -- Same shape as banners.layout_json — a custom visual-editor layout
  -- for the collection banner. NULL falls back to the plain banner_image_url
  -- + promo_text rendering.
  layout_json JSON NULL,
  -- Same meaning as banners.image_focus_x/y — where banner_image_url is
  -- anchored within its box.
  image_focus_x TINYINT UNSIGNED NOT NULL DEFAULT 50,
  image_focus_y TINYINT UNSIGNED NOT NULL DEFAULT 50,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  -- Independent of is_active — a collection can be active (buyable, reachable
  -- via its own link/the "Paquetes" filtered view) without taking up its own
  -- section on the home page.
  show_on_home TINYINT(1) NOT NULL DEFAULT 1,
  -- Shows a "Tiempo limitado" tag on the storefront. Both date columns are
  -- optional even when this is on — left NULL, it's just the plain tag with
  -- no countdown (the admin is committing to "this won't be around forever"
  -- without picking exact dates yet). With limited_time_ends_at set, the
  -- storefront additionally counts down live once 3 days or fewer remain.
  -- Nothing here auto-deactivates the collection when the date passes —
  -- is_active is still the admin's own call.
  limited_time TINYINT(1) NOT NULL DEFAULT 0,
  limited_time_starts_at DATETIME NULL,
  limited_time_ends_at DATETIME NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_collections_wholesale_category FOREIGN KEY (wholesale_category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS collection_products (
  collection_id INT NOT NULL,
  product_id INT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  -- Per-product discount price that only applies while viewed/bought
  -- as part of this specific collection. Always wins over wholesale tiers.
  discount_price DECIMAL(10,2) NULL,
  PRIMARY KEY (collection_id, product_id),
  CONSTRAINT fk_cp_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- A priced variant of a 'combo' pricing_mode collection, e.g. a collection
-- offering both "2 Playeras + 2 Gorras — $1380" and "3 Playeras + 3 Gorras —
-- $1970" has two rows here, each owning its own set of collection_bundle_parts
-- rows (via combo_tier_id below). Every 'combo' collection has at least one
-- tier — with exactly one, the customer skips straight to picking products
-- (same as before this table existed); with more than one, they choose a
-- tier first via tier-cards, like wholesale's quantity ranges.
CREATE TABLE IF NOT EXISTS collection_combo_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collection_id INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_cct_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Per-category quotas for a 'combo' pricing_mode collection, e.g.
-- "2 Playeras + 2 Gorras a $400 + 1 Gorra de regalo" is three rows:
-- (playeras, 2, gift=0), (gorras, 2, gift=0), (gorras, 1, gift=1).
-- product_id optionally pins a part to one exact product instead of letting
-- the customer pick any product from category_id (e.g. a fixed-item gift).
CREATE TABLE IF NOT EXISTS collection_bundle_parts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collection_id INT NOT NULL,
  category_id INT NOT NULL,
  -- Deprecated: no longer set from the admin form (a specific product is
  -- chosen later, in "Gestionar productos", by curating it into
  -- collection_products — see is_specific). Kept nullable for backward
  -- compatibility; new rows always leave this NULL.
  product_id INT NULL,
  -- false (default): "cualquier producto" — matches ANY product in
  -- category_id dynamically at pick/checkout time, no curation needed.
  -- true: "producto específico" — matches ONLY products the admin has
  -- explicitly curated into collection_products for this category (up to
  -- required_qty), tracked via the "faltan por agregar" guidance.
  is_specific TINYINT(1) NOT NULL DEFAULT 0,
  required_qty INT NOT NULL,
  -- Only meaningful for pricing_mode = 'bundle': lets each part act as its
  -- own independent "N unidades de esta categoría por $X" tier (rendered as
  -- tier-cards, like wholesale, when a bundle has more than one priced
  -- part) instead of pooling every part toward the collection's single
  -- bundle_qty/bundle_price. NULL keeps the old flat pooled-price behavior.
  price DECIMAL(10,2) NULL,
  is_gift TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  -- Only set for pricing_mode = 'combo': which combo tier (variant) this
  -- part belongs to — every combo part belongs to exactly one tier. NULL
  -- for 'bundle'/'unit' parts, which don't use tiers.
  combo_tier_id INT NULL,
  CONSTRAINT fk_cbp_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  CONSTRAINT fk_cbp_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cbp_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_cbp_combo_tier FOREIGN KEY (combo_tier_id) REFERENCES collection_combo_tiers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Every promotional banner in the storefront — the home page's main
-- carousel ('hero' kind) AND the simpler image+title+subtitle strips like
-- "Arma tu paquete" ('promo' kind, formerly their own single-row
-- package_promo_banner table) now live here as one unified, orderable list.
-- `placement` decides which section of the site actually renders it: a
-- 'hero' banner is always the home carousel; a 'promo' banner can go on the
-- home promo strip, the Paquetes page, or one specific category's page
-- (placement_category_id) — see banners.controller.js's listBanners.
CREATE TABLE IF NOT EXISTS banners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('hero','promo') NOT NULL DEFAULT 'hero',
  placement ENUM('home_hero','home_promo','packages','category') NOT NULL DEFAULT 'home_hero',
  -- Only meaningful when placement = 'category' — which category's page
  -- shows this banner. Unrelated to the CTA's own collection_id below.
  placement_category_id INT NULL,
  image_url VARCHAR(500) NOT NULL,
  badge_text VARCHAR(60),
  title VARCHAR(180),
  subtitle VARCHAR(300),
  cta_text VARCHAR(60),
  cta_link VARCHAR(300),
  -- When set, the CTA scrolls to/loads this collection instead of using cta_link.
  collection_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  -- Optional custom banner layout from the admin's visual banner editor: a
  -- JSON array of positioned/styled text elements (badge/title/subtitle/
  -- button/free text boxes), each with xPct/yPct position and its own
  -- color/font/size. NULL means "no custom layout" — the frontend falls
  -- back to the plain fixed badge/title/subtitle/cta_text rendering above.
  -- Only ever set for kind = 'hero'.
  layout_json JSON NULL,
  -- Where the background photo is anchored within its box (CSS
  -- background-position, in percent) — lets the admin re-center/pan a photo
  -- whose important part isn't in the middle, instead of always cropping
  -- from the center. 50/50 (the SQL default) is the original centered look.
  image_focus_x TINYINT UNSIGNED NOT NULL DEFAULT 50,
  image_focus_y TINYINT UNSIGNED NOT NULL DEFAULT 50,
  -- NULL = background-size: cover (fills the box, cropping whatever doesn't
  -- fit its aspect ratio). Set = an explicit background-size percent instead,
  -- letting the admin shrink the photo to show the whole thing (revealing
  -- the box's own black background around it) instead of always cropping.
  image_zoom TINYINT UNSIGNED NULL,
  -- NULL = each placement's own default dark gradient over the photo (for
  -- text legibility). Set = a 0-150 percent multiplier scaling that same
  -- gradient's opacity stops, so an admin whose photo looks too "washed out"
  -- (or too dark) under the default scrim can dial it down (or up) per
  -- banner instead of it being a fixed, non-adjustable look.
  scrim_opacity TINYINT UNSIGNED NULL,
  -- Optional separate photo shown only below the tablet breakpoint (see
  -- resolveBannerDevice — under 640px). NULL falls back to image_url, same
  -- as before this existed. A single image's aspect ratio can only ever be
  -- exactly right for one box shape (mobile's tall/narrow box is nothing
  -- like desktop's wide one) — this is how real sites handle that: a
  -- distinct crop/composition per breakpoint instead of one photo forced to
  -- fit both, which either crops content out or shrinks it down small.
  -- Reuses the same image_focus_x/y and image_zoom as image_url (its own
  -- position/size within its own box) rather than doubling every control.
  image_url_mobile VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_banners_collection FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL,
  CONSTRAINT fk_banners_placement_category FOREIGN KEY (placement_category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- One row per page ('home' or 'packages') holding that page's own section
-- order and membership — which home_promo/packages banners and which
-- collections actually show there, and in what order, all curated together
-- in the admin instead of each having its own independent, overlapping
-- control (a collection's own "mostrar en inicio" toggle, a banner's own
-- per-placement sort_order, etc). order_json is
-- {order: {type, id?}[], removed: {type, id?}[]} — pageLayouts.controller.js's
-- resolvePageLayout() is the single source of truth for turning this (plus
-- whatever banners/collections currently actually exist) into the final
-- render order: a stale reference is dropped, a brand new banner/collection
-- is appended automatically UNLESS it's in `removed` (so removing something
-- actually sticks instead of it reappearing on the next read).
CREATE TABLE IF NOT EXISTS page_layouts (
  page VARCHAR(20) PRIMARY KEY,
  order_json JSON NOT NULL
) ENGINE=InnoDB;

-- Wholesale/bulk pricing tiers. When a customer's cart holds `min_qty`..`max_qty`
-- units of the SAME product, that product's line price becomes `price_per_unit`.
-- A NULL category_id is a fallback tier list that applies to every category
-- that doesn't have its own tiers configured.
CREATE TABLE IF NOT EXISTS wholesale_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NULL,
  min_qty INT NOT NULL,
  max_qty INT NULL,
  price_per_unit DECIMAL(10,2) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  -- Manually pins this tier's "Más elegido" ribbon on the storefront
  -- (Catalog.tsx's isTierFeatured), taking priority over both the
  -- sales-data-derived pick (collections.most_chosen_tier_key) and the
  -- positional fallback. Left off (0) by default so most tiers keep using
  -- the automatic behavior; the admin only sets this to call out one
  -- specific range by hand. wholesale.controller.js keeps at most one tier
  -- per category_id group (including the shared fallback group,
  -- category_id NULL) flagged, unsetting any other in the same group
  -- whenever one is marked.
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wholesale_tiers_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Every image ever uploaded through the admin's ImageUploader — lets the
-- "elegir de la galería" picker reuse a photo already in R2 (for a category
-- tile, a banner, etc.) instead of uploading a duplicate copy of the same
-- file. Populated automatically inside uploadImage(); a row is removed when
-- deleteR2ObjectByUrl() cleans up that same URL elsewhere.
CREATE TABLE IF NOT EXISTS media_library (
  id INT AUTO_INCREMENT PRIMARY KEY,
  url VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- One row per "Enviar pedido por WhatsApp" click (Cart/CartDrawer/quick-order
-- on ProductDetail) — recorded automatically so the admin's Pedidos page has
-- something to show up without the seller re-typing it by hand. Starts
-- 'pending' (just sent to WhatsApp, not yet a confirmed sale); becomes
-- 'confirmed' from the admin panel, which is also when stock is deducted
-- (see orders.controller.js) — a phantom/never-followed-up chat never
-- touches inventory. 'cancelled' just hides a pending order that went
-- nowhere, without ever having touched stock.
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NULL,
  notes TEXT NULL,
  status ENUM('pending','confirmed','cancelled') NOT NULL DEFAULT 'pending',
  -- 'whatsapp' = customer-sent order (Enviar pedido/Avisarme); 'pos' = rung
  -- up in-person from Punto de venta, already 'confirmed' the moment it's
  -- created (see createPosSale).
  source ENUM('whatsapp','pos') NOT NULL DEFAULT 'whatsapp',
  -- A flat currency amount subtracted from the order's total ("descuento
  -- total") — set from the admin panel, separate from any per-item discount
  -- (order_items.discount_amount, "descuento por producto").
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Set from Punto de venta (see createPosSale) and, since confirming a
  -- WhatsApp order now also asks for a payment method, from confirmOrder too.
  payment_method ENUM('cash','debit','credit','transfer') NULL,
  -- Manually typed in by an admin after seeing the incoming WhatsApp chat —
  -- a guest order has no automatic way to learn the customer's number (the
  -- wa.me link only carries the shop's own number). NULL until someone adds
  -- it; independent of a logged-in customer's own `customers.phone`.
  guest_phone VARCHAR(30) NULL,
  -- Tracked separately from `status` — packaging happens after confirming
  -- (or even while still pending), and isn't a state the order transitions
  -- out of, just a checklist flag an admin ticks off.
  is_packaged TINYINT(1) NOT NULL DEFAULT 0,
  packed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- product_name/size/color_name/main_image_url/unit_price are a SNAPSHOT at
-- order time (not a live join) — the product/variant can change or be
-- deleted later without corrupting historical order data or sales reports.
CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NULL,
  variant_id INT NULL,
  product_name VARCHAR(200) NOT NULL,
  size VARCHAR(30) NULL,
  color_name VARCHAR(60) NULL,
  main_image_url VARCHAR(500) NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL,
  -- Snapshot of the package/collection this line's price came from (unit,
  -- bundle, wholesale, combo pricing — see useCartPricing on the frontend),
  -- NULL for a plain retail-priced item. Lets Pedidos group an order's
  -- lines by "qué tipo de paquete se acopló" instead of one flat list.
  collection_id INT NULL,
  collection_name VARCHAR(150) NULL,
  -- Which specific tier of the collection actually applied —
  -- 'bundle:<partId>', 'combo:<tierId>' or 'wholesale:<wholesaleTierId>' —
  -- NULL for 'unit'/flat pricing or a plain retail line. Real sales data
  -- lets a collection's tier cards show the genuinely most-picked one
  -- instead of guessing by position (see Catalog.tsx's featuredTierIndex).
  tier_key VARCHAR(40) NULL,
  -- Flat currency amount subtracted per unit ("descuento por producto").
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Human-readable label for WHY discount_amount is set — e.g. 'Cliente
  -- frecuente' when applied automatically from customers.discount_amount at
  -- order creation. NULL for a plain manual discount (or none at all).
  discount_reason VARCHAR(60) NULL,
  -- Added from the admin panel ("añadir producto de regalo") — still
  -- deducts stock like any other line (a gift is a real unit leaving
  -- inventory), just excluded from revenue totals.
  is_gift TINYINT(1) NOT NULL DEFAULT 0,
  -- Set when this line was out of stock at the moment the customer sent
  -- it — a "¿me avisan cuando haya stock?" ask, not a confirmed sale yet.
  -- Shown distinctly in Pedidos; naturally can't be confirmed (deducts
  -- stock) until the product is actually restocked.
  is_preorder TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- A return (customer gives the item back) or exchange (given back for a
-- different product/size/color) against one line of an already-confirmed
-- order — see returns.controller.js. Processed immediately on creation:
-- stock goes back for the original variant, and for an exchange also comes
-- back out for the replacement. Kept as its own ledger rather than mutating
-- the original order_items row, so "qué se vendió" stays an accurate
-- historical record of the original sale.
CREATE TABLE IF NOT EXISTS returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  order_item_id INT NOT NULL,
  type ENUM('return','exchange') NOT NULL,
  quantity INT NOT NULL,
  reason VARCHAR(255) NULL,
  -- Only set for type = 'exchange' — a snapshot of the replacement given,
  -- same reasoning as order_items' own snapshot fields.
  new_product_id INT NULL,
  new_variant_id INT NULL,
  new_product_name VARCHAR(200) NULL,
  new_size VARCHAR(30) NULL,
  new_color_name VARCHAR(60) NULL,
  new_main_image_url VARCHAR(500) NULL,
  -- Snapshotted at creation so the money side of a return/exchange never
  -- has to be recomputed (and never drifts) later from prices that may have
  -- since changed. refunded_amount is what the original line was actually
  -- worth (unit_price - discount_amount, matching order_items' own revenue
  -- math) — always set, even for an exchange, since the old item still
  -- leaves the sale. charged_amount is the replacement's own value — only
  -- ever nonzero for type = 'exchange'. charged_amount - refunded_amount is
  -- the net money difference: positive means the customer owes more,
  -- negative means they're owed a refund, zero means an even swap.
  refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  charged_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- NULL = recorded but not yet confirmed as actually handed over/collected
  -- in person (a return/exchange can be logged the moment it happens, before
  -- the cash or replacement item physically changes hands) — set the moment
  -- an admin confirms "sí, ya se le entregó/cobró la diferencia", answering
  -- "¿cómo confirmo que se hizo la devolución y se entregó el dinero?".
  settled_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_returns_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_returns_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_returns_new_product FOREIGN KEY (new_product_id) REFERENCES products(id) ON DELETE SET NULL,
  CONSTRAINT fk_returns_new_variant FOREIGN KEY (new_variant_id) REFERENCES product_variants(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- A "corte de caja" snapshot — closes out every confirmed Punto de venta
-- (mostrador) sale between the previous cut's period_to and the moment this
-- one is made, then becomes the next cut's own starting point. WhatsApp
-- orders never touch the physical register, so they're excluded on purpose.
CREATE TABLE IF NOT EXISTS cash_cuts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  period_from TIMESTAMP NOT NULL,
  period_to TIMESTAMP NOT NULL,
  sales_count INT NOT NULL DEFAULT 0,
  items_sold INT NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- {"whatsapp": {salesCount, itemsSold, totalAmount}, "pos": {...}} — the
  -- totals above already include both channels; this is just the split.
  by_source JSON NULL,
  admin_email VARCHAR(190) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Singleton row (id always 1) configuring an unattended "corte de caja" —
-- since a cut here is purely computed from confirmed sales (no physical
-- cash count step exists in this app), it's safe to generate one on a timer
-- with nobody clicking anything. Manual cuts via the "Realizar corte"
-- button keep working exactly as before in between automatic ones.
CREATE TABLE IF NOT EXISTS cash_cut_settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  frequency ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
  hour TINYINT UNSIGNED NOT NULL DEFAULT 22,
  -- Only meaningful when frequency = 'weekly'. 0 = Sunday .. 6 = Saturday.
  weekday TINYINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_cash_cut_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB;

-- Singleton row (id always 1) for whatever used to be a fixed constant in
-- the code but is really a business call the shop should be able to tune
-- without a redeploy — label print size, the low-stock alert threshold, and
-- the "más vendido" badge's qualifying thresholds.
CREATE TABLE IF NOT EXISTS app_settings (
  id TINYINT PRIMARY KEY DEFAULT 1,
  label_width_mm SMALLINT UNSIGNED NOT NULL DEFAULT 56,
  label_height_mm SMALLINT UNSIGNED NOT NULL DEFAULT 40,
  -- A variant at or below this stock count shows "Bajo stock" in the admin
  -- and (see notificationScheduler.js) triggers a low-stock notification.
  low_stock_threshold SMALLINT UNSIGNED NOT NULL DEFAULT 5,
  -- A product needs at least this many confirmed, non-gift units sold
  -- all-time to qualify as "Más vendido"; only the top bestseller_limit
  -- products beyond that floor actually get the badge.
  bestseller_min_qty SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  bestseller_limit SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_app_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB;

-- One row per browser/device that opted into push notifications from the
-- admin (see admin/public/sw.js) — the raw subscription object the Push API
-- hands back, needed as-is to send anything to it later via web-push.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_email VARCHAR(190) NULL,
  endpoint VARCHAR(500) NOT NULL UNIQUE,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- A small shared inbox (not per-admin read state — this is a single/few-
-- admin shop) for low-stock/agotado alerts and automatic cash-cut runs, so
-- the admin bell has something to list even for whoever wasn't looking at
-- their screen when the push itself fired.
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('low_stock','out_of_stock','cash_cut','whatsapp_order') NOT NULL,
  title VARCHAR(190) NOT NULL,
  body VARCHAR(500) NOT NULL,
  product_id INT NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Admin-saved banner layouts (badge/title/subtitle/button style+position),
-- built from whatever a real banner's visual editor currently has — lets an
-- admin reuse a look they already arranged instead of picking from a fixed
-- set of designer-authored presets. See BannerEditor.tsx's applyTemplate.
CREATE TABLE IF NOT EXISTS banner_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  preset_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_discount ON products(discount_type);
CREATE INDEX idx_banners_collection ON banners(collection_id);
CREATE INDEX idx_banners_placement ON banners(placement, placement_category_id);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_movements_variant ON stock_movements(variant_id);
CREATE INDEX idx_movements_created ON stock_movements(created_at);
CREATE INDEX idx_wholesale_tiers_category ON wholesale_tiers(category_id);
CREATE INDEX idx_collection_products_product ON collection_products(product_id);
CREATE INDEX idx_collection_bundle_parts_collection ON collection_bundle_parts(collection_id);
CREATE INDEX idx_collection_bundle_parts_combo_tier ON collection_bundle_parts(combo_tier_id);
CREATE INDEX idx_collection_combo_tiers_collection ON collection_combo_tiers(collection_id);
CREATE INDEX idx_orders_status_created ON orders(status, created_at);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_returns_order ON returns(order_id);
CREATE INDEX idx_returns_order_item ON returns(order_item_id);
CREATE INDEX idx_returns_created ON returns(created_at);
CREATE INDEX idx_cash_cuts_created ON cash_cuts(created_at);
