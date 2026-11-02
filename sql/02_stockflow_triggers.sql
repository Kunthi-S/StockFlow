-- =====================================================================
--  StockFlow: COMPANY / ORDER / PRODUCT routines (triggers, procedures)
--  Run AFTER 01_stockflow_schema.sql
--  No validation / error handling here: done in the JS layer.
--  Triggers only clean data so it is stored in one consistent format.
-- =====================================================================
USE stockflow;

DROP PROCEDURE IF EXISTS p_insert_company;
DROP PROCEDURE IF EXISTS p_update_company;
DROP PROCEDURE IF EXISTS p_add_company_phone;
DROP PROCEDURE IF EXISTS p_delete_company_phone;
DROP PROCEDURE IF EXISTS p_delete_company;
DROP PROCEDURE IF EXISTS p_insert_order;
DROP PROCEDURE IF EXISTS p_update_order;
DROP PROCEDURE IF EXISTS p_delete_order;
DROP PROCEDURE IF EXISTS p_insert_order_item;
DROP PROCEDURE IF EXISTS p_update_order_item;
DROP PROCEDURE IF EXISTS p_delete_order_item;
DROP TRIGGER IF EXISTS trg_order_item_insert;
DROP TRIGGER IF EXISTS trg_order_item_update;
DROP TRIGGER IF EXISTS trg_order_item_delete;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add company
-- p_phones: JSON array, e.g. '["021234567","081-234-5678"]', or NULL
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_company(
    IN  p_name         VARCHAR(150),
    IN  p_street       VARCHAR(150),
    IN  p_city         VARCHAR(100),
    IN  p_postal_code  CHAR(5),
    IN  p_email        VARCHAR(254),
    IN  p_phones       JSON,
    OUT p_company_id   INT UNSIGNED
)
BEGIN
    INSERT INTO company (name, street, city, postal_code, email)
    VALUES (p_name, p_street, p_city, p_postal_code, p_email);
 
    SET p_company_id = LAST_INSERT_ID();
 
    INSERT INTO company_phone (company_id, contact_phone)
    SELECT p_company_id, jt.phone
        FROM JSON_TABLE(p_phones, '$[*]' COLUMNS (phone VARCHAR(20) PATH '$')) AS jt;
END //
DELIMITER ;
-- ---------------------------------------------------------------------
-- PROCEDURE: Edit company (name / address / email)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_company(
    IN p_company_id   INT UNSIGNED,
    IN p_name         VARCHAR(150),
    IN p_street       VARCHAR(150),
    IN p_city         VARCHAR(100),
    IN p_postal_code  CHAR(5),
    IN p_email        VARCHAR(254)
)
BEGIN
    UPDATE company
       SET name = p_name, street = p_street, city = p_city,
           postal_code = p_postal_code, email = p_email
     WHERE company_id = p_company_id;
END //
DELIMITER ;
-- ---------------------------------------------------------------------
-- PROCEDURE: Edit company -> add phone
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_add_company_phone(
    IN p_company_id     INT UNSIGNED,
    IN p_contact_phone  VARCHAR(20)
)
BEGIN
    INSERT INTO company_phone (company_id, contact_phone)
    VALUES (p_company_id, p_contact_phone);
END //
DELIMITER ;
-- ---------------------------------------------------------------------
-- PROCEDURE: Edit company -> delete phone
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_company_phone(
    IN p_company_id     INT UNSIGNED,
    IN p_contact_phone  VARCHAR(20)
)
BEGIN
    DELETE FROM company_phone
     WHERE company_id = p_company_id
       AND contact_phone = p_contact_phone;
END //
DELIMITER ;
-- ---------------------------------------------------------------------
-- PROCEDURE: Delete company button
-- Phones go via ON DELETE CASCADE; orders block it via ON DELETE RESTRICT
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_company(
    IN p_company_id INT UNSIGNED
)
BEGIN
    DELETE FROM company WHERE company_id = p_company_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add order
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_order(
    IN  p_company_id  INT UNSIGNED,
    IN  p_direction   ENUM('IN','OUT'),
    IN  p_status      ENUM('DRAFT','CONFIRMED','IN_TRANSIT',
                          'RECEIVED','SHIPPED','CANCELLED'),
    OUT p_order_id    INT UNSIGNED
)
BEGIN
    INSERT INTO orders (company_id, direction, status)
    VALUES (p_company_id, p_direction, COALESCE(p_status, 'DRAFT'));

    SET p_order_id = LAST_INSERT_ID();
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit order (company / direction / status)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_order(
    IN p_order_id    INT UNSIGNED,
    IN p_company_id  INT UNSIGNED,
    IN p_direction   ENUM('IN','OUT'),
    IN p_status      ENUM('DRAFT','CONFIRMED','IN_TRANSIT',
                          'RECEIVED','SHIPPED','CANCELLED')
)
BEGIN
    UPDATE orders
       SET company_id = p_company_id,
           direction = p_direction,
           status = p_status
     WHERE order_id = p_order_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Delete order
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_order(
    IN p_order_id INT UNSIGNED
)
BEGIN
    DELETE FROM orders
    WHERE order_id = p_order_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add order_item
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_order_item(
    IN p_order_id    INT UNSIGNED,
    IN p_product_id  INT UNSIGNED,
    IN p_quantity    DECIMAL(12,3),
    IN p_unit_price  DECIMAL(10,2)
)
BEGIN
    INSERT INTO order_item (order_id, product_id, quantity, unit_price)
    VALUES (p_order_id, p_product_id, p_quantity, p_unit_price);
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit order item (quantity / unit price)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_order_item(
    IN p_order_id    INT UNSIGNED,
    IN p_product_id  INT UNSIGNED,
    IN p_quantity    DECIMAL(12,3),
    IN p_unit_price  DECIMAL(10,2)
)
BEGIN
    UPDATE order_item
       SET quantity = p_quantity,
           unit_price = p_unit_price
     WHERE order_id = p_order_id
       AND product_id = p_product_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Delete order item
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_order_item(
    IN p_order_id    INT UNSIGNED,
    IN p_product_id  INT UNSIGNED
)
BEGIN
    DELETE FROM order_item
    WHERE order_id = p_order_id
      AND product_id = p_product_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGER: Update order total after inserting order item
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_order_item_insert
AFTER INSERT ON order_item
FOR EACH ROW
BEGIN
    UPDATE orders
       SET total_amount = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_item
           WHERE order_id = NEW.order_id
       )
     WHERE order_id = NEW.order_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGER: Update order total after editing order item
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_order_item_update
AFTER UPDATE ON order_item
FOR EACH ROW
BEGIN
    UPDATE orders
       SET total_amount = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_item
           WHERE order_id = NEW.order_id
       )
     WHERE order_id = NEW.order_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGER: Update order total after deleting order item
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_order_item_delete
AFTER DELETE ON order_item
FOR EACH ROW
BEGIN
    UPDATE orders
       SET total_amount = (
           SELECT COALESCE(SUM(line_total), 0)
           FROM order_item
           WHERE order_id = OLD.order_id
       )
     WHERE order_id = OLD.order_id;
END //
DELIMITER ;

DROP PROCEDURE IF EXISTS p_insert_product;
DROP PROCEDURE IF EXISTS p_update_product;
DROP PROCEDURE IF EXISTS p_delete_product;
DROP TRIGGER   IF EXISTS trg_packaged_disjoint;
DROP TRIGGER   IF EXISTS trg_weighed_disjoint;
DROP TRIGGER   IF EXISTS trg_counted_disjoint;
DROP TRIGGER   IF EXISTS trg_stored_at_insert;
DROP TRIGGER   IF EXISTS trg_stored_at_update;
DROP TRIGGER   IF EXISTS trg_stored_at_delete;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add product (any type)
--   p_type  : 'PACKAGED' | 'WEIGHED' | 'COUNTED'
--   p_attrs : JSON with the subtype's attributes
--     PACKAGED {"units_per_pack":12, "package_type":"CASE", "pack_barcode":"12345678901234"}
--     WEIGHED  {"tare_weight_kg":0.1, "avg_net_weight_kg":5, "unit_of_measure":"KG"}
--     COUNTED  {"unit_label":"PIECE", "is_serialized":true}
--   pack_barcode and is_serialized are optional.
-- quantity_on_hand is trigger-maintained (stored_at), so it is not set here.
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_product(
    IN  p_sku            VARCHAR(30),
    IN  p_name           VARCHAR(150),
    IN  p_category       VARCHAR(60),
    IN  p_standard_cost  DECIMAL(12,4),
    IN  p_reorder_level  DECIMAL(12,3),
    IN  p_type           VARCHAR(10),
    IN  p_attrs          JSON,
    OUT p_product_id     INT UNSIGNED
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION;

    INSERT INTO product (sku, name, category, standard_cost, reorder_level)
    VALUES (p_sku, p_name, p_category, p_standard_cost, p_reorder_level);
    SET p_product_id = LAST_INSERT_ID();

    CASE UPPER(p_type)
        WHEN 'PACKAGED' THEN
            INSERT INTO packaged_product (product_id, units_per_pack, package_type, pack_barcode)
            VALUES (
                p_product_id,
                JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.units_per_pack')),
                JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.package_type')),
                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.pack_barcode')), 'null')
            );

        WHEN 'WEIGHED' THEN
            INSERT INTO weighed_product (product_id, tare_weight_kg, avg_net_weight_kg, unit_of_measure)
            VALUES (
                p_product_id,
                JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.tare_weight_kg')),
                JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.avg_net_weight_kg')),
                JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.unit_of_measure'))
            );

        WHEN 'COUNTED' THEN
            INSERT INTO counted_product (product_id, unit_label, is_serialized)
            VALUES (
                p_product_id,
                JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.unit_label')),
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.is_serialized')) IN ('true', '1'), FALSE)
            );

        ELSE
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'p_type must be PACKAGED, WEIGHED or COUNTED';
    END CASE;

    COMMIT;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product (base fields + subtype fields in one call)
--   Base fields: pass NULL to keep the current value.
--   p_attrs    : only the keys you want to change; missing keys keep their
--                value. Pass NULL or '{}' to leave subtype fields unchanged.
--                {"pack_barcode": null} clears the barcode.
--   The product's type is detected automatically (type cannot be changed).
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_product(
    IN p_product_id     INT UNSIGNED,
    IN p_sku            VARCHAR(30),
    IN p_name           VARCHAR(150),
    IN p_category       VARCHAR(60),
    IN p_standard_cost  DECIMAL(12,4),
    IN p_reorder_level  DECIMAL(12,3),
    IN p_attrs          JSON
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (SELECT 1 FROM product WHERE product_id = p_product_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Product not found';
    END IF;

    SET p_attrs = COALESCE(p_attrs, '{}');

    START TRANSACTION;

    UPDATE product
       SET sku           = COALESCE(p_sku,           sku),
           name          = COALESCE(p_name,          name),
           category      = COALESCE(p_category,      category),
           standard_cost = COALESCE(p_standard_cost, standard_cost),
           reorder_level = COALESCE(p_reorder_level, reorder_level)
     WHERE product_id = p_product_id;

    IF EXISTS (SELECT 1 FROM packaged_product WHERE product_id = p_product_id) THEN
        UPDATE packaged_product
           SET units_per_pack = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.units_per_pack')), units_per_pack),
               package_type   = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.package_type')),   package_type),
               pack_barcode   = IF(JSON_CONTAINS_PATH(p_attrs, 'one', '$.pack_barcode'),
                                   NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.pack_barcode')), 'null'),
                                   pack_barcode)
         WHERE product_id = p_product_id;

    ELSEIF EXISTS (SELECT 1 FROM weighed_product WHERE product_id = p_product_id) THEN
        UPDATE weighed_product
           SET tare_weight_kg    = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.tare_weight_kg')),    tare_weight_kg),
               avg_net_weight_kg = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.avg_net_weight_kg')), avg_net_weight_kg),
               unit_of_measure   = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.unit_of_measure')),   unit_of_measure)
         WHERE product_id = p_product_id;

    ELSEIF EXISTS (SELECT 1 FROM counted_product WHERE product_id = p_product_id) THEN
        UPDATE counted_product
           SET unit_label    = COALESCE(JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.unit_label')), unit_label),
               is_serialized = IF(JSON_CONTAINS_PATH(p_attrs, 'one', '$.is_serialized'),
                                  JSON_UNQUOTE(JSON_EXTRACT(p_attrs, '$.is_serialized')) IN ('true', '1'),
                                  is_serialized)
         WHERE product_id = p_product_id;
    END IF;

    COMMIT;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Delete product
-- Subtype rows go via ON DELETE CASCADE;
-- stock (stored_at) and order lines (order_item) block it via ON DELETE RESTRICT
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_product(
    IN p_product_id INT UNSIGNED
)
BEGIN
    DELETE FROM product WHERE product_id = p_product_id;

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Product not found';
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGERS: Disjoint specialization
-- A product may have a row in only ONE of the three subtype tables
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_packaged_disjoint
BEFORE INSERT ON packaged_product
FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM weighed_product WHERE product_id = NEW.product_id)
    OR EXISTS (SELECT 1 FROM counted_product WHERE product_id = NEW.product_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Product already has another subtype (disjoint)';
    END IF;
END //

CREATE TRIGGER trg_weighed_disjoint
BEFORE INSERT ON weighed_product
FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM packaged_product WHERE product_id = NEW.product_id)
    OR EXISTS (SELECT 1 FROM counted_product  WHERE product_id = NEW.product_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Product already has another subtype (disjoint)';
    END IF;
END //

CREATE TRIGGER trg_counted_disjoint
BEFORE INSERT ON counted_product
FOR EACH ROW
BEGIN
    IF EXISTS (SELECT 1 FROM packaged_product WHERE product_id = NEW.product_id)
    OR EXISTS (SELECT 1 FROM weighed_product  WHERE product_id = NEW.product_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Product already has another subtype (disjoint)';
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGERS: Keep product.quantity_on_hand = SUM(stored_at.quantity_at_location)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_stored_at_insert
AFTER INSERT ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (
           SELECT COALESCE(SUM(quantity_at_location), 0)
             FROM stored_at
            WHERE product_id = NEW.product_id)
     WHERE product_id = NEW.product_id;
END //

-- If the row moved to another product, the old product is recounted too
CREATE TRIGGER trg_stored_at_update
AFTER UPDATE ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (
           SELECT COALESCE(SUM(quantity_at_location), 0)
             FROM stored_at
            WHERE product_id = NEW.product_id)
     WHERE product_id = NEW.product_id;

    IF NEW.product_id <> OLD.product_id THEN
        UPDATE product
           SET quantity_on_hand = (
               SELECT COALESCE(SUM(quantity_at_location), 0)
                 FROM stored_at
                WHERE product_id = OLD.product_id)
         WHERE product_id = OLD.product_id;
    END IF;
END //

CREATE TRIGGER trg_stored_at_delete
AFTER DELETE ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (
           SELECT COALESCE(SUM(quantity_at_location), 0)
             FROM stored_at
            WHERE product_id = OLD.product_id)
     WHERE product_id = OLD.product_id;
END //
DELIMITER ;