
--  StockFlow: sample data
--  Run order: 01_stockflow_schema.sql -> stockflow_routines.sql -> this file
--
--  orders.total_amount and product.quantity_on_hand are NOT inserted here:
--  the triggers calculate them from order_item and stored_at.
--
--  Demo rows on purpose:
--    * low stock            : Drinking Water, Instant Noodles, Cooking Oil,
--                             Cordless Drill, Measuring Tape (0 in stock)
--    * no reorder level     : Safety Gloves (reorder_level NULL -> never low)
--    * stock in 2 locations : Drinking Water, Jasmine Rice
--    * can delete           : company 7 (no orders), product 10 (no stock/orders),
--                             location 6 (empty)
--    * delete is blocked    : company 1 (has orders), product 1 (has stock),
--                             order 1 (has a shipment)
-- =====================================================================
USE stockflow;
 
-- ---------------------------------------------------------------------
-- COMPANY  (1-3 suppliers, 4-6 customers, 7 no orders yet)
-- ---------------------------------------------------------------------
INSERT INTO company (company_id, name, street, city, postal_code, email) VALUES
 (1, 'Siam Fresh Supply Co.',    '99 Rama IV Rd',          'Bangkok',      '10500', 'sales@siamfresh.co.th'),
 (2, 'Chao Phraya Trading',      '45 Charoen Krung Rd',    'Bangkok',      '10100', 'order@cptrading.co.th'),
 (3, 'Northern Tools Ltd.',      '12 Huay Kaew Rd',        'Chiang Mai',   '50200', 'contact@northerntools.co.th'),
 (4, 'Happy Mart Rangsit',       '88/1 Phahonyothin Rd',   'Pathum Thani', '12120', 'buyer@happymart.co.th'),
 (5, 'Green Cafe Silom',         '23 Silom Soi 4',         'Bangkok',      '10500', 'greencafe@gmail.com'),
 (6, 'BuildPro Construction',    '7 Sukhumvit Rd',         'Chon Buri',    '20000', 'purchase@buildpro.co.th'),
 (7, 'Lotus Minimart',           '150 Ngamwongwan Rd',     'Nonthaburi',   '11000', 'lotusmini@gmail.com');
 
-- multivalued: company 1 has 2 phones, company 7 has none
INSERT INTO company_phone (company_id, contact_phone) VALUES
 (1, '021234567'), (1, '0812345678'),
 (2, '022233344'),
 (3, '053211000'), (3, '0898765432'),
 (4, '025550101'),
 (5, '0861112222'),
 (6, '038123456');
 
-- ---------------------------------------------------------------------
-- PRODUCT  (3 of each type; quantity_on_hand filled by triggers)
-- ---------------------------------------------------------------------
INSERT INTO product (product_id, sku, name, category, standard_cost, reorder_level,
                     product_type, attributes) VALUES
 (1,  'PK-WAT-600', 'Drinking Water 600ml',   'Beverages',  4.5000,  100,  'PACKAGED',
      JSON_OBJECT('units_per_pack', 12, 'package_type', 'CASE', 'pack_barcode', '08850999100012')),
 (2,  'PK-NOD-MAMA','Instant Noodles Tom Yum','Food',       5.0000,  200,  'PACKAGED',
      JSON_OBJECT('units_per_pack', 30, 'package_type', 'BOX')),
 (3,  'PK-TIS-ROLL','Tissue Roll 6-pack',     'Household',  45.0000, 40,   'PACKAGED',
      JSON_OBJECT('units_per_pack', 6, 'package_type', 'BAG')),
 (4,  'WG-RCE-JAS', 'Jasmine Rice',           'Food',       32.0000, 150,  'WEIGHED',
      JSON_OBJECT('tare_weight_kg', 0.05, 'avg_net_weight_kg', 5, 'unit_of_measure', 'KG')),
 (5,  'WG-OIL-PLM', 'Palm Cooking Oil',       'Food',       48.0000, 60,   'WEIGHED',
      JSON_OBJECT('tare_weight_kg', 0.08, 'avg_net_weight_kg', 1, 'unit_of_measure', 'L')),
 (6,  'WG-SUG-WHT', 'White Sugar',            'Food',       25.0000, 80,   'WEIGHED',
      JSON_OBJECT('tare_weight_kg', 0.02, 'avg_net_weight_kg', 1, 'unit_of_measure', 'KG')),
 (7,  'CT-DRL-18V', 'Cordless Drill 18V',     'Tools',      1850.0000, 5,  'COUNTED',
      JSON_OBJECT('unit_label', 'PIECE', 'is_serialized', TRUE)),
 (8,  'CT-GLV-SAF', 'Safety Gloves',          'Tools',      35.0000, NULL, 'COUNTED',
      JSON_OBJECT('unit_label', 'PAIR', 'is_serialized', FALSE)),
 (9,  'CT-SCR-SET', 'Screwdriver Set',        'Tools',      320.0000, 10,  'COUNTED',
      JSON_OBJECT('unit_label', 'SET', 'is_serialized', FALSE)),
 (10, 'CT-TAP-MSR', 'Measuring Tape 5m',      'Tools',      89.0000, 15,   'COUNTED',
      JSON_OBJECT('unit_label', 'PIECE'));
 
-- ---------------------------------------------------------------------
-- LOCATION  (location 6 stays empty)
-- ---------------------------------------------------------------------
INSERT INTO location (location_id, code, capacity_slots, aisle) VALUES
 (1, 'A-01-1', 50, 'A'),
 (2, 'A-01-2', 50, 'A'),
 (3, 'B-02-1', 40, 'B'),
 (4, 'B-02-2', 40, 'B'),
 (5, 'C-03-1', 20, 'C'),
 (6, 'C-03-2', 20, 'C');
 
-- ---------------------------------------------------------------------
-- STORED_AT  (triggers set product.quantity_on_hand)
-- ---------------------------------------------------------------------
INSERT INTO stored_at (location_id, product_id, quantity_at_location) VALUES
 (1, 1,  60),     -- Drinking Water   60 + 20 = 80   (reorder 100 -> LOW)
 (2, 1,  20),
 (1, 2, 150),     -- Instant Noodles  150            (reorder 200 -> LOW)
 (2, 3,  75),     -- Tissue           75             (reorder 40  -> ok)
 (3, 4, 300),     -- Jasmine Rice     300 + 120 = 420 (reorder 150 -> ok)
 (4, 4, 120),
 (3, 5,  45),     -- Cooking Oil      45             (reorder 60  -> LOW)
 (4, 6, 200),     -- Sugar            200            (reorder 80  -> ok)
 (5, 7,   3),     -- Drill            3              (reorder 5   -> LOW)
 (5, 8, 250),     -- Gloves           250            (no reorder level)
 (5, 9,  18);     -- Screwdriver Set  18             (reorder 10  -> ok)
                  -- Measuring Tape (10) has no stock row -> can be deleted
 
-- ---------------------------------------------------------------------
-- ORDERS  (IN = purchase from supplier, OUT = sale to customer)
-- total_amount filled by triggers
-- ---------------------------------------------------------------------
INSERT INTO orders (order_id, order_date, status, direction, company_id) VALUES
 (1,  '2026-09-05 09:30:00', 'RECEIVED',   'IN',  1),
 (2,  '2026-09-12 14:00:00', 'RECEIVED',   'IN',  2),
 (3,  '2026-09-20 10:15:00', 'RECEIVED',   'IN',  3),
 (4,  '2026-10-02 11:00:00', 'SHIPPED',    'OUT', 4),
 (5,  '2026-10-08 16:45:00', 'SHIPPED',    'OUT', 5),
 (6,  '2026-10-15 08:20:00', 'SHIPPED',    'OUT', 6),
 (7,  '2026-10-22 13:10:00', 'IN_TRANSIT', 'IN',  1),
 (8,  '2026-10-28 10:00:00', 'CONFIRMED',  'OUT', 4),
 (9,  '2026-10-30 15:30:00', 'CANCELLED',  'OUT', 5),
 (10, '2026-11-01 09:00:00', 'DRAFT',      'OUT', 6);
 
-- ---------------------------------------------------------------------
-- ORDER_ITEM  (line_total is generated; triggers set orders.total_amount)
-- ---------------------------------------------------------------------
INSERT INTO order_item (order_id, product_id, quantity, unit_price) VALUES
 (1, 1, 200,   4.50), (1, 2, 300,   5.00), (1, 4, 400,  32.00),
 (2, 5,  80,  48.00), (2, 6, 250,  25.00), (2, 3, 100,  45.00),
 (3, 7,  10, 1850.00),(3, 8, 300,  35.00), (3, 9,  25, 320.00),
 (4, 1, 120,   7.00), (4, 2, 150,   7.50), (4, 3,  25,  65.00),
 (5, 4, 100,  45.00), (5, 5,  35,  65.00),
 (6, 7,   7, 2490.00),(6, 8,  50,  55.00), (6, 9,   7, 450.00),
 (7, 1, 150,   4.50), (7, 2, 200,   5.00),
 (8, 6,  50,  35.00), (8, 3,  10,  65.00),
 (9, 4,  20,  45.00),
 (10, 7,  2, 2490.00);
 
-- ---------------------------------------------------------------------
-- SHIPMENT  (1:1 with orders; only orders that have been sent)
-- ---------------------------------------------------------------------
INSERT INTO shipment (shipment_id, order_id, tracking_number, freight_date,
                      expected_date, actual_date, destination_address) VALUES
 (1, 1, 'TH0905000101', '2026-09-06', '2026-09-09', '2026-09-08',
     'StockFlow Warehouse, 1 Rangsit-Nakhon Nayok Rd, Pathum Thani 12120'),
 (2, 2, 'TH0912000202', '2026-09-13', '2026-09-16', '2026-09-17',
     'StockFlow Warehouse, 1 Rangsit-Nakhon Nayok Rd, Pathum Thani 12120'),
 (3, 3, 'TH0920000303', '2026-09-21', '2026-09-25', '2026-09-24',
     'StockFlow Warehouse, 1 Rangsit-Nakhon Nayok Rd, Pathum Thani 12120'),
 (4, 4, 'TH1002000404', '2026-10-03', '2026-10-04', '2026-10-04',
     '88/1 Phahonyothin Rd, Pathum Thani 12120'),
 (5, 5, 'TH1008000505', '2026-10-09', '2026-10-10', '2026-10-10',
     '23 Silom Soi 4, Bangkok 10500'),
 (6, 6, 'TH1015000606', '2026-10-16', '2026-10-18', '2026-10-19',
     '7 Sukhumvit Rd, Chon Buri 20000'),
 (7, 7, 'TH1022000707', '2026-10-23', '2026-11-05', NULL,
     'StockFlow Warehouse, 1 Rangsit-Nakhon Nayok Rd, Pathum Thani 12120');
 
-- ---------------------------------------------------------------------
-- Quick check
-- ---------------------------------------------------------------------
-- SELECT order_id, direction, status, total_amount FROM orders;
-- SELECT sku, name, quantity_on_hand, reorder_level,
--        is_low_stock(product_id) AS low_stock FROM product;
 