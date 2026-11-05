USE stockflow;

-- Clean up (so this file can be run again)
DROP PROCEDURE IF EXISTS p_insert_company;
DROP PROCEDURE IF EXISTS p_update_company;
DROP PROCEDURE IF EXISTS p_add_company_phone;
DROP FUNCTION  IF EXISTS is_low_stock;
DROP TRIGGER   IF EXISTS after_order_item_insert;
DROP TRIGGER   IF EXISTS after_order_item_update;
DROP TRIGGER   IF EXISTS after_order_item_delete;
DROP TRIGGER   IF EXISTS after_stored_at_insert;
DROP TRIGGER   IF EXISTS after_stored_at_update;
DROP TRIGGER   IF EXISTS after_stored_at_delete;


-- 1. COMPANY <-> COMPANY_PHONE

-- PROCEDURE: Add company + phones in one call
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
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN ROLLBACK; RESIGNAL; END;

    START TRANSACTION;

    INSERT INTO company (name, street, city, postal_code, email)
    VALUES (p_name, p_street, p_city, p_postal_code, p_email);

    SET p_company_id = LAST_INSERT_ID();

    INSERT INTO company_phone (company_id, contact_phone)
    SELECT p_company_id, jt.phone
      FROM JSON_TABLE(p_phones, '$[*]' COLUMNS (phone VARCHAR(20) PATH '$')) AS jt;

    COMMIT;
END //
DELIMITER ;

-- PROCEDURE: Edit company + replace its whole phone list in one call
DELIMITER //
CREATE PROCEDURE p_update_company(
    IN p_company_id   INT UNSIGNED,
    IN p_name         VARCHAR(150),
    IN p_street       VARCHAR(150),
    IN p_city         VARCHAR(100),
    IN p_postal_code  CHAR(5),
    IN p_email        VARCHAR(254),
    IN p_phones       JSON
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
        BEGIN ROLLBACK; RESIGNAL; END;

    IF NOT EXISTS (SELECT 1 FROM company WHERE company_id = p_company_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'company not found';
    END IF;

    START TRANSACTION;

    UPDATE company
       SET name = p_name, street = p_street, city = p_city,
           postal_code = p_postal_code, email = p_email
     WHERE company_id = p_company_id;

    IF p_phones IS NOT NULL THEN
        DELETE FROM company_phone WHERE company_id = p_company_id;

        INSERT INTO company_phone (company_id, contact_phone)
        SELECT p_company_id, jt.phone
          FROM JSON_TABLE(p_phones, '$[*]' COLUMNS (phone VARCHAR(20) PATH '$')) AS jt;
    END IF;

    COMMIT;
END //
DELIMITER ;

-- PROCEDURE: Add one phone to an existing company
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


-- 2. ORDER_ITEM -> ORDERS.total_amount

-- TRIGGER: New item -> recount the order total
DELIMITER //
CREATE TRIGGER after_order_item_insert
AFTER INSERT ON order_item
FOR EACH ROW
BEGIN
    UPDATE orders
       SET total_amount = (SELECT COALESCE(SUM(line_total), 0)
                             FROM order_item
                            WHERE order_id = NEW.order_id)
     WHERE order_id = NEW.order_id;
END //
DELIMITER ;

-- TRIGGER: Item edited -> recount the order total
DELIMITER //
CREATE TRIGGER after_order_item_update
AFTER UPDATE ON order_item
FOR EACH ROW
BEGIN
    UPDATE orders
       SET total_amount = (SELECT COALESCE(SUM(line_total), 0)
                             FROM order_item
                            WHERE order_id = NEW.order_id)
     WHERE order_id = NEW.order_id;
END //
DELIMITER ;

-- TRIGGER: Item removed -> recount the order total
DELIMITER //
CREATE TRIGGER after_order_item_delete
AFTER DELETE ON order_item
FOR EACH ROW
BEGIN
    UPDATE orders
       SET total_amount = (SELECT COALESCE(SUM(line_total), 0)
                             FROM order_item
                            WHERE order_id = OLD.order_id)
     WHERE order_id = OLD.order_id;
END //
DELIMITER ;


-- 3. STORED_AT -> PRODUCT.quantity_on_hand

-- TRIGGER: Stock added at a location -> recount the product's total
DELIMITER //
CREATE TRIGGER after_stored_at_insert
AFTER INSERT ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (SELECT COALESCE(SUM(quantity_at_location), 0)
                                 FROM stored_at
                                WHERE product_id = NEW.product_id)
     WHERE product_id = NEW.product_id;
END //
DELIMITER ;

-- TRIGGER: Stock edited -> recount
DELIMITER //
CREATE TRIGGER after_stored_at_update
AFTER UPDATE ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (SELECT COALESCE(SUM(quantity_at_location), 0)
                                 FROM stored_at
                                WHERE product_id = NEW.product_id)
     WHERE product_id = NEW.product_id;
END //
DELIMITER ;

-- TRIGGER: Stock removed -> recount
DELIMITER //
CREATE TRIGGER after_stored_at_delete
AFTER DELETE ON stored_at
FOR EACH ROW
BEGIN
    UPDATE product
       SET quantity_on_hand = (SELECT COALESCE(SUM(quantity_at_location), 0)
                                 FROM stored_at
                                WHERE product_id = OLD.product_id)
     WHERE product_id = OLD.product_id;
END //
DELIMITER ;

DELIMITER //
CREATE FUNCTION is_low_stock(p_product_id INT UNSIGNED) RETURNS BOOLEAN
READS SQL DATA
BEGIN
    DECLARE low BOOLEAN;
    SELECT reorder_level IS NOT NULL
           AND quantity_on_hand <= reorder_level INTO low
      FROM product
     WHERE product_id = p_product_id;
    RETURN low;
END //
DELIMITER ;

-- VIEWS

-- One row per product, with is_low and its locations ("A-01-1: 60, A-01-2: 20")
CREATE OR REPLACE VIEW v_stock_summary AS
SELECT p.product_id, p.sku, p.name, p.category, p.product_type, p.type_data,
       p.standard_cost, p.reorder_level, p.quantity_on_hand,
       is_low_stock(p.product_id) AS is_low,
       (SELECT GROUP_CONCAT(CONCAT(l.code, ': ', s.quantity_at_location + 0e0) ORDER BY l.code SEPARATOR ', ')
          FROM stored_at s JOIN location l ON l.location_id = s.location_id
         WHERE s.product_id = p.product_id) AS locations
  FROM product p;

-- One row per order, with its company and shipment (if any)
CREATE OR REPLACE VIEW v_order_summary AS
SELECT o.order_id, o.order_date, o.status, o.direction, o.total_amount,
       o.company_id, c.name AS company_name,
       s.tracking_number, s.expected_date, s.actual_date
  FROM orders o
  JOIN company c ON c.company_id = o.company_id
  LEFT JOIN shipment s ON s.order_id = o.order_id;
