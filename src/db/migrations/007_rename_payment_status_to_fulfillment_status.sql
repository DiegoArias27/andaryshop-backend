-- Grew from a plain "¿ya pagó?" flag into a full post-sale progress
-- tracker (pago faltante → pedido pendiente → empaquetando → entregado),
-- so the column is renamed to match what it actually tracks now. Widens
-- the enum first so existing 'partial'/'paid' rows stay valid while they're
-- remapped, then narrows it to the final set in the same statement as the
-- rename — a direct jump would either reject those rows outright or
-- silently blank them under strict mode.
ALTER TABLE orders
  MODIFY COLUMN payment_status ENUM('missing','partial','paid','pending','packaging','delivered') NULL;

UPDATE orders SET payment_status = 'pending' WHERE payment_status IN ('partial', 'paid');

ALTER TABLE orders
  CHANGE COLUMN payment_status fulfillment_status ENUM('missing','pending','packaging','delivered') NULL;
