-- Superseded by fulfillment_status's 'packaging' stage, which now also
-- gates "Confirmar venta" (see confirmOrder/updateFulfillmentStatus) —
-- having both a separate boolean and an enum stage for the same concept
-- was confusing, so this drops the boolean in favor of the single enum.
ALTER TABLE orders
  DROP COLUMN is_packaged,
  DROP COLUMN packed_at;
