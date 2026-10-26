-- =====================================================================
--  StockFlow: COMPANY / ORDER / SHIPMENT / PRODUCT / LOCATION routines
--  (triggers, procedures)
--  Run AFTER 01_stockflow_schema.sql, BEFORE 03_stockflow_sample_data.sql
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
DROP PROCEDURE IF EXISTS p_insert_shipment;
DROP PROCEDURE IF EXISTS p_update_shipment;
DROP PROCEDURE IF EXISTS p_delete_shipment;
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
-- PROCEDURE: Add shipment (SHIPMENT 1 : 1 ORDERS via "fulfills")
-- p_destination_address NULL -> snapshot of the company address
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_shipment(
    IN p_order_id             INT UNSIGNED,
    IN p_tracking_number      VARCHAR(60),
    IN p_freight_date         DATE,
    IN p_expected_date        DATE,
    IN p_actual_date          DATE,
    IN p_destination_address  VARCHAR(255)
)
BEGIN
    INSERT INTO shipment (order_id, tracking_number, freight_date, expected_date,
                          actual_date, destination_address)
    SELECT o.order_id, p_tracking_number, p_freight_date, p_expected_date, p_actual_date,
           COALESCE(p_destination_address, CONCAT_WS(', ', c.street, c.city, c.postal_code))
      FROM orders o
      JOIN company c ON c.company_id = o.company_id
     WHERE o.order_id = p_order_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit shipment (tracking / dates / destination)
-- p_destination_address NULL -> keep the current snapshot
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_shipment(
    IN p_order_id             INT UNSIGNED,
    IN p_tracking_number      VARCHAR(60),
    IN p_freight_date         DATE,
    IN p_expected_date        DATE,
    IN p_actual_date          DATE,
    IN p_destination_address  VARCHAR(255)
)
BEGIN
    UPDATE shipment
       SET tracking_number = p_tracking_number,
           freight_date = p_freight_date,
           expected_date = p_expected_date,
           actual_date = p_actual_date,
           destination_address = COALESCE(p_destination_address, destination_address)
     WHERE order_id = p_order_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Delete shipment (the order itself is kept)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_shipment(
    IN p_order_id INT UNSIGNED
)
BEGIN
    DELETE FROM shipment WHERE order_id = p_order_id;
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





DROP PROCEDURE IF EXISTS p_insert_product_base;
DROP PROCEDURE IF EXISTS p_insert_packaged_product;
DROP PROCEDURE IF EXISTS p_insert_weighed_product;
DROP PROCEDURE IF EXISTS p_insert_counted_product;
DROP PROCEDURE IF EXISTS p_update_product;
DROP PROCEDURE IF EXISTS p_update_packaged_product;
DROP PROCEDURE IF EXISTS p_update_weighed_product;
DROP PROCEDURE IF EXISTS p_update_counted_product;
DROP PROCEDURE IF EXISTS p_delete_product;
DROP PROCEDURE IF EXISTS p_insert_location;
DROP PROCEDURE IF EXISTS p_add_product_location;
DROP PROCEDURE IF EXISTS p_update_product_location;
DROP PROCEDURE IF EXISTS p_delete_product_location;
DROP TRIGGER IF EXISTS trg_stored_at_insert;
DROP TRIGGER IF EXISTS trg_stored_at_update;
DROP TRIGGER IF EXISTS trg_stored_at_delete;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add product (base row, called by the three typed procedures)
-- quantity_on_hand is trigger-maintained (stored_at), so it is not set here
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_product_base(
    IN  p_sku            VARCHAR(30),
    IN  p_name           VARCHAR(150),
    IN  p_category       VARCHAR(60),
    IN  p_standard_cost  DECIMAL(12,4),
    IN  p_reorder_level  DECIMAL(12,3),
    OUT p_product_id     INT UNSIGNED
)
BEGIN
    INSERT INTO product (sku, name, category, standard_cost, reorder_level)
    VALUES (p_sku, p_name, p_category, p_standard_cost, p_reorder_level);

    SET p_product_id = LAST_INSERT_ID();
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add product -> packaged (disjoint, total)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_packaged_product(
    IN  p_sku             VARCHAR(30),
    IN  p_name            VARCHAR(150),
    IN  p_category        VARCHAR(60),
    IN  p_standard_cost   DECIMAL(12,4),
    IN  p_reorder_level   DECIMAL(12,3),
    IN  p_units_per_pack  INT,
    IN  p_package_type    ENUM('BOX','CASE','BAG','PALLET'),
    IN  p_pack_barcode    VARCHAR(14),
    OUT p_product_id      INT UNSIGNED
)
BEGIN
    CALL p_insert_product_base(p_sku, p_name, p_category, p_standard_cost,
                               p_reorder_level, p_product_id);

    INSERT INTO packaged_product (product_id, units_per_pack, package_type, pack_barcode)
    VALUES (p_product_id, p_units_per_pack, p_package_type, p_pack_barcode);
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add product -> weighed (disjoint, total)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_weighed_product(
    IN  p_sku                VARCHAR(30),
    IN  p_name               VARCHAR(150),
    IN  p_category           VARCHAR(60),
    IN  p_standard_cost      DECIMAL(12,4),
    IN  p_reorder_level      DECIMAL(12,3),
    IN  p_tare_weight_kg     DECIMAL(8,3),
    IN  p_avg_net_weight_kg  DECIMAL(8,3),
    IN  p_unit_of_measure    ENUM('KG','G','L','ML'),
    OUT p_product_id         INT UNSIGNED
)
BEGIN
    CALL p_insert_product_base(p_sku, p_name, p_category, p_standard_cost,
                               p_reorder_level, p_product_id);

    INSERT INTO weighed_product (product_id, tare_weight_kg, avg_net_weight_kg, unit_of_measure)
    VALUES (p_product_id, p_tare_weight_kg, p_avg_net_weight_kg, p_unit_of_measure);
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add product -> counted (disjoint, total)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_counted_product(
    IN  p_sku            VARCHAR(30),
    IN  p_name           VARCHAR(150),
    IN  p_category       VARCHAR(60),
    IN  p_standard_cost  DECIMAL(12,4),
    IN  p_reorder_level  DECIMAL(12,3),
    IN  p_unit_label     VARCHAR(20),
    IN  p_is_serialized  BOOLEAN,
    OUT p_product_id     INT UNSIGNED
)
BEGIN
    CALL p_insert_product_base(p_sku, p_name, p_category, p_standard_cost,
                               p_reorder_level, p_product_id);

    INSERT INTO counted_product (product_id, unit_label, is_serialized)
    VALUES (p_product_id, p_unit_label, COALESCE(p_is_serialized, FALSE));
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product (sku / name / category / cost / reorder level)
-- quantity_on_hand is trigger-maintained (stored_at), so it is not set here
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_product(
    IN p_product_id     INT UNSIGNED,
    IN p_sku            VARCHAR(30),
    IN p_name           VARCHAR(150),
    IN p_category       VARCHAR(60),
    IN p_standard_cost  DECIMAL(12,4),
    IN p_reorder_level  DECIMAL(12,3)
)
BEGIN
    UPDATE product
       SET sku = p_sku, name = p_name, category = p_category,
           standard_cost = p_standard_cost, reorder_level = p_reorder_level
     WHERE product_id = p_product_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product -> packaged details
-- Also switches the product to packaged: the other subtype rows are
-- removed first so it stays in exactly one of them (disjoint, total)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_packaged_product(
    IN p_product_id      INT UNSIGNED,
    IN p_units_per_pack  INT,
    IN p_package_type    ENUM('BOX','CASE','BAG','PALLET'),
    IN p_pack_barcode    VARCHAR(14)
)
BEGIN
    DELETE FROM weighed_product WHERE product_id = p_product_id;
    DELETE FROM counted_product WHERE product_id = p_product_id;

    IF EXISTS (SELECT 1 FROM packaged_product WHERE product_id = p_product_id) THEN
        UPDATE packaged_product
           SET units_per_pack = p_units_per_pack,
               package_type = p_package_type,
               pack_barcode = p_pack_barcode
         WHERE product_id = p_product_id;
    ELSE
        INSERT INTO packaged_product (product_id, units_per_pack, package_type, pack_barcode)
        VALUES (p_product_id, p_units_per_pack, p_package_type, p_pack_barcode);
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product -> weighed details (also switches type, see above)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_weighed_product(
    IN p_product_id         INT UNSIGNED,
    IN p_tare_weight_kg     DECIMAL(8,3),
    IN p_avg_net_weight_kg  DECIMAL(8,3),
    IN p_unit_of_measure    ENUM('KG','G','L','ML')
)
BEGIN
    DELETE FROM packaged_product WHERE product_id = p_product_id;
    DELETE FROM counted_product WHERE product_id = p_product_id;

    IF EXISTS (SELECT 1 FROM weighed_product WHERE product_id = p_product_id) THEN
        UPDATE weighed_product
           SET tare_weight_kg = p_tare_weight_kg,
               avg_net_weight_kg = p_avg_net_weight_kg,
               unit_of_measure = p_unit_of_measure
         WHERE product_id = p_product_id;
    ELSE
        INSERT INTO weighed_product (product_id, tare_weight_kg, avg_net_weight_kg, unit_of_measure)
        VALUES (p_product_id, p_tare_weight_kg, p_avg_net_weight_kg, p_unit_of_measure);
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product -> counted details (also switches type, see above)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_counted_product(
    IN p_product_id     INT UNSIGNED,
    IN p_unit_label     VARCHAR(20),
    IN p_is_serialized  BOOLEAN
)
BEGIN
    DELETE FROM packaged_product WHERE product_id = p_product_id;
    DELETE FROM weighed_product WHERE product_id = p_product_id;

    IF EXISTS (SELECT 1 FROM counted_product WHERE product_id = p_product_id) THEN
        UPDATE counted_product
           SET unit_label = p_unit_label,
               is_serialized = COALESCE(p_is_serialized, FALSE)
         WHERE product_id = p_product_id;
    ELSE
        INSERT INTO counted_product (product_id, unit_label, is_serialized)
        VALUES (p_product_id, p_unit_label, COALESCE(p_is_serialized, FALSE));
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Delete product button
-- Subtype rows go via ON DELETE CASCADE;
-- stock (stored_at) and order lines (order_item) block it via ON DELETE RESTRICT
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_product(
    IN p_product_id INT UNSIGNED
)
BEGIN
    DELETE FROM product WHERE product_id = p_product_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Add location (from the product form, there is no locations page)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_insert_location(
    IN  p_code            VARCHAR(15),
    IN  p_capacity_units  INT,
    IN  p_aisle           VARCHAR(10),
    OUT p_location_id     INT UNSIGNED
)
BEGIN
    INSERT INTO location (code, capacity_units, aisle)
    VALUES (p_code, p_capacity_units, p_aisle);

    SET p_location_id = LAST_INSERT_ID();
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product -> store at a location (stored_at)
-- quantity_on_hand follows via trg_stored_at_insert
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_add_product_location(
    IN p_product_id            INT UNSIGNED,
    IN p_location_id           INT UNSIGNED,
    IN p_quantity_at_location  DECIMAL(12,3)
)
BEGIN
    INSERT INTO stored_at (location_id, product_id, quantity_at_location)
    VALUES (p_location_id, p_product_id, COALESCE(p_quantity_at_location, 0));
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product -> change quantity at a location
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_update_product_location(
    IN p_product_id            INT UNSIGNED,
    IN p_location_id           INT UNSIGNED,
    IN p_quantity_at_location  DECIMAL(12,3)
)
BEGIN
    UPDATE stored_at
       SET quantity_at_location = COALESCE(p_quantity_at_location, 0)
     WHERE product_id = p_product_id
       AND location_id = p_location_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- PROCEDURE: Edit product -> remove from a location (location itself is kept)
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE p_delete_product_location(
    IN p_product_id   INT UNSIGNED,
    IN p_location_id  INT UNSIGNED
)
BEGIN
    DELETE FROM stored_at
     WHERE product_id = p_product_id
       AND location_id = p_location_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGER: Update product quantity_on_hand after inserting stored_at
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
           WHERE product_id = NEW.product_id
       )
     WHERE product_id = NEW.product_id;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGER: Update product quantity_on_hand after editing stored_at
-- If the row moved to another product, the old product is recounted too
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_stored_at_update
AFTER UPDATE ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (
           SELECT COALESCE(SUM(quantity_at_location), 0)
           FROM stored_at
           WHERE product_id = NEW.product_id
       )
     WHERE product_id = NEW.product_id;

    IF NEW.product_id <> OLD.product_id THEN
        UPDATE product
           SET quantity_on_hand = (
               SELECT COALESCE(SUM(quantity_at_location), 0)
               FROM stored_at
               WHERE product_id = OLD.product_id
           )
         WHERE product_id = OLD.product_id;
    END IF;
END //
DELIMITER ;

-- ---------------------------------------------------------------------
-- TRIGGER: Update product quantity_on_hand after deleting stored_at
-- ---------------------------------------------------------------------
DELIMITER //
CREATE TRIGGER trg_stored_at_delete
AFTER DELETE ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (
           SELECT COALESCE(SUM(quantity_at_location), 0)
           FROM stored_at
           WHERE product_id = OLD.product_id
       )
     WHERE product_id = OLD.product_id;
END //
DELIMITER ;