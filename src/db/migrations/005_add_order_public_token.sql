-- Lets a customer (guest or logged in) open their own order's status from a
-- plain link, without an account — see orders.controller.js's
-- getOrderByToken. The WhatsApp message now includes it, the admin's
-- Pedidos page can copy/resend it. Random and unguessable (never the
-- sequential order id) since it's the only thing standing between this and
-- letting anyone read anyone else's order by changing a number in the URL.

ALTER TABLE orders
  ADD COLUMN public_token VARCHAR(40) NULL AFTER id;

-- Backfilled so every existing order gets one too, not just new ones —
-- MySQL's own UUID() is fine for this (just needs to be hard to guess, not
-- cryptographically secure); new orders going forward generate theirs in
-- app code with crypto.randomBytes instead (see createOrder).
UPDATE orders SET public_token = REPLACE(UUID(), '-', '') WHERE public_token IS NULL;

ALTER TABLE orders
  MODIFY COLUMN public_token VARCHAR(40) NOT NULL,
  ADD UNIQUE INDEX idx_orders_public_token (public_token);
