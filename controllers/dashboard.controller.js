// controllers/dashboard.controller.js
const pool = require('../db');

// GET /api/dashboard/stats  (numbers for the four stat cards)
exports.getStats = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         (SELECT COUNT(*) FROM product) AS products,
         (SELECT COUNT(*) FROM product WHERE quantity_on_hand <= reorder_level) AS low_stock,
         (SELECT COUNT(*) FROM orders WHERE status IN ('DRAFT', 'CONFIRMED', 'IN_TRANSIT')) AS open_orders,
         (SELECT COUNT(*) FROM company) AS companies`
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/dashboard/low-stock  (products at or below their reorder level)
exports.getLowStock = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT product_id, sku, name, quantity_on_hand, reorder_level
       FROM product
       WHERE quantity_on_hand <= reorder_level
       ORDER BY quantity_on_hand - reorder_level`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/dashboard/recent-orders  (latest 5 orders)
exports.getRecentOrders = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_date, o.status, o.direction, o.total_amount, c.name AS company_name
       FROM orders o JOIN company c ON c.company_id = o.company_id
       ORDER BY o.order_date DESC
       LIMIT 5`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
