const pool = require('../db');
const { fail } = require('../utils/http');

// GET /api/dashboard/stats
exports.getStats = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT (SELECT COUNT(*) FROM product) AS products,
              (SELECT COUNT(*) FROM v_stock_summary WHERE is_low) AS low_stock,
              (SELECT COUNT(*) FROM orders WHERE status IN ('DRAFT', 'CONFIRMED', 'IN_TRANSIT')) AS open_orders,
              (SELECT COUNT(*) FROM company) AS companies`);
    res.json(rows[0]);
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/dashboard/low-stock
exports.getLowStock = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT product_id, sku, name, quantity_on_hand, reorder_level
         FROM v_stock_summary
        WHERE is_low
        ORDER BY sku`);
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/dashboard/recent-orders
exports.getRecentOrders = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT order_id, order_date, status, direction, company_name
         FROM v_order_summary
        ORDER BY order_date DESC
        LIMIT 5`);
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};
