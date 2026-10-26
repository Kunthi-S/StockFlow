-- =====================================================================
--  StockFlow: sample data
--  Run AFTER 01_stockflow_schema.sql and 02_stockflow_triggers.sql
--  Everything goes through the procedures, so the triggers fill in
--  orders.total_amount and product.quantity_on_hand.
--  Stock levels are the current count per bin; orders do not move stock.
-- =====================================================================
USE stockflow;

START TRANSACTION;

-- ---------------------------------------------------------------------
-- COMPANY + COMPANY_PHONE  (suppliers 1-3, customers 4-6)
-- ---------------------------------------------------------------------
CALL p_insert_company('Siam Fresh Distribution Co., Ltd.', '88 Rama IV Rd, Khlong Toei', 'Bangkok', '10110',
                      'orders@siamfresh.example', '["021234567","0812345678"]', @c_siam);
CALL p_insert_company('Chiang Mai Hardware Supply', '15 Chang Klan Rd', 'Chiang Mai', '50200',
                      'sales@cmhardware.example', '["053123456"]', @c_cmhw);
CALL p_insert_company('Eastern Packaging Industries', '201 Sukhumvit Rd, Mueang', 'Chonburi', '20000',
                      'contact@easternpack.example', '["038765432","0898765432"]', @c_east);
CALL p_insert_company('Lotus Mart Retail', '9 Phahonyothin Rd, Phaya Thai', 'Bangkok', '10400',
                      'purchasing@lotusmart.example', '["026543210"]', @c_lotus);
CALL p_insert_company('Phuket Island Resorts', '45 Patong Beach Rd, Kathu', 'Phuket', '83150',
                      'fnb@phuketresorts.example', '["076345678"]', @c_phuket);
CALL p_insert_company('Khon Kaen Builders Co.', '120 Mittraphap Rd, Mueang', 'Khon Kaen', '40000',
                      'procure@kkbuilders.example', NULL, @c_kk);

-- ---------------------------------------------------------------------
-- LOCATION  (A = beverages/snacks, B = tools & weighed goods, C = bulk)
-- ---------------------------------------------------------------------
CALL p_insert_location('A-01-1', 600,  'A', @l_a011);
CALL p_insert_location('A-01-2', 600,  'A', @l_a012);
CALL p_insert_location('A-02-1', 400,  'A', @l_a021);
CALL p_insert_location('B-01-1', 300,  'B', @l_b011);
CALL p_insert_location('B-01-2', 100,  'B', @l_b012);
CALL p_insert_location('B-02-1', 800,  'B', @l_b021);
CALL p_insert_location('C-01-1', 2000, 'C', @l_c011);
CALL p_insert_location('C-01-2', 5000, 'C', @l_c012);

-- ---------------------------------------------------------------------
-- PRODUCT -> PACKAGED / WEIGHED / COUNTED  (disjoint, total)
-- (sku, name, category, standard_cost, reorder_level, <type fields>, OUT id)
-- ---------------------------------------------------------------------
CALL p_insert_packaged_product('BEV-001', 'Drinking Water 600ml', 'Beverage', 3.5000, 200,
                               24, 'CASE', '8850999000011', @p_water);
CALL p_insert_packaged_product('BEV-002', 'Green Tea 500ml', 'Beverage', 12.0000, 120,
                               12, 'CASE', '8850999000028', @p_tea);
CALL p_insert_packaged_product('SNK-001', 'Rice Crackers 100g', 'Snack', 18.0000, 90,
                               30, 'BOX', '8850999000035', @p_cracker);
CALL p_insert_packaged_product('PKG-001', 'Zip Bag 6x9 in', 'Packaging', 0.8000, 500,
                               50, 'BAG', '12345670', @p_zipbag);

CALL p_insert_weighed_product('RICE-001', 'Jasmine Rice', 'Dry Goods', 32.0000, 300,
                              0.200, 5.000, 'KG', @p_rice);
CALL p_insert_weighed_product('SUG-001', 'White Sugar', 'Dry Goods', 24.0000, 200,
                              0.100, 1.000, 'KG', @p_sugar);
CALL p_insert_weighed_product('OIL-001', 'Palm Cooking Oil', 'Dry Goods', 45.0000, 150,
                              0.150, 1.000, 'L', @p_oil);
CALL p_insert_weighed_product('SPC-001', 'Ground Black Pepper', 'Spice', 120.0000, 30,
                              0.020, 0.250, 'G', @p_pepper);

CALL p_insert_counted_product('HW-001', 'Hex Bolt M8x40', 'Hardware', 2.5000, 500,
                              'piece', FALSE, @p_bolt);
CALL p_insert_counted_product('HW-002', 'Safety Gloves', 'Hardware', 35.0000, 100,
                              'pair', FALSE, @p_gloves);
CALL p_insert_counted_product('TL-001', 'Cordless Drill 18V', 'Tools', 1890.0000, 10,
                              'unit', TRUE, @p_drill);
CALL p_insert_counted_product('TL-002', 'Socket Wrench Set', 'Tools', 650.0000, 15,
                              'set', FALSE, @p_wrench);

-- ---------------------------------------------------------------------
-- STORED_AT  (quantity_on_hand = sum per product, via trigger)
-- Low stock on purpose: Palm Cooking Oil, Safety Gloves, Cordless Drill
-- ---------------------------------------------------------------------
CALL p_add_product_location(@p_water,   @l_a011, 400);
CALL p_add_product_location(@p_water,   @l_a012, 100);   -- water total 500
CALL p_add_product_location(@p_tea,     @l_a011, 150);
CALL p_add_product_location(@p_cracker, @l_a012, 200);
CALL p_add_product_location(@p_cracker, @l_a021, 60);    -- crackers total 260
CALL p_add_product_location(@p_pepper,  @l_a021, 40);
CALL p_add_product_location(@p_gloves,  @l_b011, 80);    -- below reorder 100
CALL p_add_product_location(@p_wrench,  @l_b011, 25);
CALL p_add_product_location(@p_drill,   @l_b012, 6);     -- below reorder 10
CALL p_add_product_location(@p_wrench,  @l_b012, 10);    -- wrench total 35
CALL p_add_product_location(@p_oil,     @l_b021, 120);   -- below reorder 150
CALL p_add_product_location(@p_sugar,   @l_b021, 350);
CALL p_add_product_location(@p_rice,    @l_c011, 900);
CALL p_add_product_location(@p_sugar,   @l_c011, 250);   -- sugar total 600
CALL p_add_product_location(@p_bolt,    @l_c012, 2400);
CALL p_add_product_location(@p_zipbag,  @l_c012, 1500);

-- ---------------------------------------------------------------------
-- ORDERS + ORDER_ITEM + SHIPMENT  (total_amount via trigger)
-- IN = purchase from a supplier, OUT = sale to a customer
-- order_date is backdated after each insert so the dashboard has a history
-- ---------------------------------------------------------------------
SET @warehouse = 'StockFlow Warehouse, 99 Bang Na-Trat Rd, Bang Phli, Samut Prakan, 10540';

-- 1. purchase, received
CALL p_insert_order(@c_siam, 'IN', 'RECEIVED', @o1);
UPDATE orders SET order_date = '2026-10-01 09:15:00' WHERE order_id = @o1;
CALL p_insert_order_item(@o1, @p_water, 600, 3.40);
CALL p_insert_order_item(@o1, @p_tea,   200, 11.50);
CALL p_insert_shipment(@o1, 'TH-KRY-260001', '2026-10-02', '2026-10-04', '2026-10-04', @warehouse);

-- 2. purchase, received (one day late)
CALL p_insert_order(@c_cmhw, 'IN', 'RECEIVED', @o2);
UPDATE orders SET order_date = '2026-10-05 10:30:00' WHERE order_id = @o2;
CALL p_insert_order_item(@o2, @p_bolt,   2500, 2.40);
CALL p_insert_order_item(@o2, @p_gloves, 120,  34.00);
CALL p_insert_order_item(@o2, @p_drill,  10,   1850.00);
CALL p_insert_shipment(@o2, 'TH-FLS-260002', '2026-10-06', '2026-10-09', '2026-10-10', @warehouse);

-- 3. sale, shipped (destination NULL -> company address snapshot)
CALL p_insert_order(@c_lotus, 'OUT', 'SHIPPED', @o3);
UPDATE orders SET order_date = '2026-10-08 14:00:00' WHERE order_id = @o3;
CALL p_insert_order_item(@o3, @p_water,   200, 5.00);
CALL p_insert_order_item(@o3, @p_cracker, 60,  25.00);
CALL p_insert_order_item(@o3, @p_rice,    100, 42.00);
CALL p_insert_shipment(@o3, 'TH-KRY-260003', '2026-10-09', '2026-10-10', '2026-10-10', NULL);

-- 4. sale, shipped
CALL p_insert_order(@c_phuket, 'OUT', 'SHIPPED', @o4);
UPDATE orders SET order_date = '2026-10-12 11:45:00' WHERE order_id = @o4;
CALL p_insert_order_item(@o4, @p_tea, 50, 16.00);
CALL p_insert_order_item(@o4, @p_oil, 30, 58.00);
CALL p_insert_shipment(@o4, 'TH-JNT-260004', '2026-10-13', '2026-10-15', '2026-10-16', NULL);

-- 5. sale, cancelled before shipping
CALL p_insert_order(@c_phuket, 'OUT', 'CANCELLED', @o5);
UPDATE orders SET order_date = '2026-10-15 16:20:00' WHERE order_id = @o5;
CALL p_insert_order_item(@o5, @p_cracker, 30, 25.00);

-- 6. sale, in transit (not delivered yet)
CALL p_insert_order(@c_kk, 'OUT', 'IN_TRANSIT', @o6);
UPDATE orders SET order_date = '2026-10-20 08:50:00' WHERE order_id = @o6;
CALL p_insert_order_item(@o6, @p_drill,  4,  2490.00);
CALL p_insert_order_item(@o6, @p_gloves, 40, 49.00);
CALL p_insert_order_item(@o6, @p_wrench, 5,  890.00);
CALL p_insert_shipment(@o6, 'TH-FLS-260006', '2026-10-24', '2026-10-28', NULL, NULL);

-- 7. purchase, in transit
CALL p_insert_order(@c_east, 'IN', 'IN_TRANSIT', @o7);
UPDATE orders SET order_date = '2026-10-22 13:10:00' WHERE order_id = @o7;
CALL p_insert_order_item(@o7, @p_zipbag, 2000, 0.75);
CALL p_insert_shipment(@o7, 'TH-KRY-260007', '2026-10-25', '2026-10-29', NULL, @warehouse);

-- 8. sale, confirmed (no shipment yet)
CALL p_insert_order(@c_lotus, 'OUT', 'CONFIRMED', @o8);
UPDATE orders SET order_date = '2026-10-25 09:40:00' WHERE order_id = @o8;
CALL p_insert_order_item(@o8, @p_sugar, 150, 30.00);
CALL p_insert_order_item(@o8, @p_rice,  200, 42.00);

-- 9. purchase, draft (restocking the low oil)
CALL p_insert_order(@c_siam, 'IN', 'DRAFT', @o9);
UPDATE orders SET order_date = '2026-10-26 15:05:00' WHERE order_id = @o9;
CALL p_insert_order_item(@o9, @p_oil,    200, 44.00);
CALL p_insert_order_item(@o9, @p_pepper, 20,  115.00);

-- 10. sale, draft (status NULL -> DRAFT)
CALL p_insert_order(@c_kk, 'OUT', NULL, @o10);
UPDATE orders SET order_date = '2026-10-27 10:00:00' WHERE order_id = @o10;
CALL p_insert_order_item(@o10, @p_bolt, 500, 3.20);

COMMIT;
