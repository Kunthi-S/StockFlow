-- 01_stockflow_schema.sql: tables, keys, indexes and CHECKs (run first)

DROP DATABASE IF EXISTS stockflow;
CREATE DATABASE stockflow;
USE stockflow;

-- COMPANY  (trading partner: customer or supplier)
CREATE TABLE company (
    company_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(150) NOT NULL,
    street        VARCHAR(150) NOT NULL,  -- Component of 'address'
    city          VARCHAR(100) NOT NULL,  -- Component of 'address'
    postal_code   CHAR(5)      NOT NULL,  -- Component of 'address'
    email         VARCHAR(254) NOT NULL,
    CONSTRAINT pk_company        PRIMARY KEY (company_id)
);

-- Multivalued Attribute Table
CREATE TABLE company_phone (
    company_id     INT UNSIGNED NOT NULL,
    contact_phone  VARCHAR(20)  NOT NULL,
    CONSTRAINT pk_company_phone PRIMARY KEY (company_id, contact_phone),
    CONSTRAINT fk_phone_company FOREIGN KEY (company_id)
        REFERENCES company (company_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- ORDERS  (COMPANY 1 : N ORDERS via "places")
CREATE TABLE orders (
    order_id      INT UNSIGNED           NOT NULL AUTO_INCREMENT,
    order_date    DATETIME               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('DRAFT','CONFIRMED','IN_TRANSIT','RECEIVED','SHIPPED','CANCELLED')
                                         NOT NULL DEFAULT 'DRAFT',
    total_amount  DECIMAL(14,2)          NOT NULL DEFAULT 0.00,   -- trigger-maintained
    direction     ENUM('IN','OUT')       NOT NULL,                -- IN = purchase, OUT = sale
    company_id    INT UNSIGNED           NOT NULL,
    CONSTRAINT pk_orders          PRIMARY KEY (order_id),
    CONSTRAINT fk_orders_company  FOREIGN KEY (company_id)
        REFERENCES company (company_id)
        ON UPDATE CASCADE ON DELETE RESTRICT, -- no deleting a company that has orders
    CONSTRAINT ck_orders_total    CHECK (total_amount >= 0),
    INDEX idx_orders_company (company_id),
    INDEX idx_orders_status_date (status, order_date)
);

-- SHIPMENT  (SHIPMENT 1 : 1 ORDERS via "fulfills")
CREATE TABLE shipment (
    shipment_id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    order_id             INT UNSIGNED NOT NULL,
    tracking_number      VARCHAR(60)  UNIQUE,
    freight_date         DATE,
    expected_date        DATE,
    actual_date          DATE,
    destination_address  VARCHAR(255) NOT NULL,          -- snapshot at shipping time
    CONSTRAINT pk_shipment           PRIMARY KEY (shipment_id),
    CONSTRAINT uq_shipment_order     UNIQUE (order_id),  -- enforces 1:1
    CONSTRAINT fk_shipment_order     FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_shipment_expected  CHECK (expected_date >= freight_date),
    CONSTRAINT ck_shipment_actual    CHECK (actual_date   >= freight_date)
);

-- PRODUCT  (one type per product; its fields are in type_data JSON)
CREATE TABLE product (
    product_id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    sku               VARCHAR(30)   UNIQUE NOT NULL,
    name              VARCHAR(150)  NOT NULL,
    category          VARCHAR(60)   NOT NULL,
    standard_cost     DECIMAL(12,4) NOT NULL,
    reorder_level     DECIMAL(12,3) NULL,
    quantity_on_hand  DECIMAL(12,3) NOT NULL DEFAULT 0,   -- trigger-maintained
    product_type      ENUM('PACKAGED','WEIGHED','COUNTED') NOT NULL,
    type_data        JSON          NOT NULL,             -- fields depend on product_type
    CONSTRAINT pk_product          PRIMARY KEY (product_id),
    CONSTRAINT ck_product_cost     CHECK (standard_cost    >= 0),
    CONSTRAINT ck_product_reorder  CHECK (reorder_level    >= 0),
    CONSTRAINT ck_product_qoh      CHECK (quantity_on_hand >= 0),
    INDEX idx_product_category (category)
);

-- ORDER_ITEM  (weak entity; ORDERS 1:N ORDER_ITEM, ORDER_ITEM N:1 PRODUCT)
CREATE TABLE order_item (
    order_id    INT UNSIGNED  NOT NULL,
    product_id  INT UNSIGNED  NOT NULL,
    quantity    DECIMAL(12,3) NOT NULL,
    unit_price  DECIMAL(10,2) NOT NULL,
    line_total  DECIMAL(12,2) AS (ROUND(quantity * unit_price, 2)) STORED,
    CONSTRAINT pk_order_item          PRIMARY KEY (order_id, product_id),
    CONSTRAINT fk_order_item_order    FOREIGN KEY (order_id)
        REFERENCES orders (order_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_order_item_product  FOREIGN KEY (product_id)
        REFERENCES product (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_order_item_qty      CHECK (quantity   > 0),
    CONSTRAINT ck_order_item_price    CHECK (unit_price >= 0),
    INDEX idx_order_item_product (product_id)
);

-- LOCATION
CREATE TABLE location (
    location_id     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    code            VARCHAR(15)   NOT NULL,              -- e.g. A-03-2
    capacity_slots  INT UNSIGNED  NOT NULL,
    aisle           VARCHAR(10)   NOT NULL,
    CONSTRAINT pk_location        PRIMARY KEY (location_id),
    CONSTRAINT uq_location_code   UNIQUE (code),
    CONSTRAINT ck_location_cap    CHECK (capacity_slots > 0)
);

-- STORED_AT  (PRODUCT M : N LOCATION, with relationship attribute)
CREATE TABLE stored_at (
    location_id           INT UNSIGNED  NOT NULL,
    product_id            INT UNSIGNED  NOT NULL,
    quantity_at_location  DECIMAL(12,3) NOT NULL DEFAULT 0,
    CONSTRAINT pk_stored_at           PRIMARY KEY (location_id, product_id),
    CONSTRAINT fk_stored_at_location  FOREIGN KEY (location_id)
        REFERENCES location (location_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_stored_at_product   FOREIGN KEY (product_id)
        REFERENCES product (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT ck_stored_at_qty       CHECK (quantity_at_location >= 0),
    INDEX idx_stored_at_product (product_id)
);
