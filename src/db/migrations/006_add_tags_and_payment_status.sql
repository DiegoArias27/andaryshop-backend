-- Reusable product tags ("Oferta", "Edición limitada"...) — see
-- products.controller.js's attachRelations and admin's ProductEditor
-- "Etiquetas" section.
CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_tags (
  product_id INT NOT NULL,
  tag_id INT NOT NULL,
  PRIMARY KEY (product_id, tag_id),
  CONSTRAINT fk_product_tags_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CONSTRAINT fk_product_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Admin-tracked payment follow-up for a WhatsApp order while it's pending
-- — see orders.controller.js's updatePaymentStatus.
ALTER TABLE orders
  ADD COLUMN payment_status ENUM('missing','partial','paid') NULL AFTER guest_phone;

UPDATE orders SET payment_status = 'missing' WHERE source = 'whatsapp' AND status = 'pending' AND payment_status IS NULL;
UPDATE orders SET payment_status = 'paid' WHERE status = 'confirmed' AND payment_status IS NULL;
