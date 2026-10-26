// controllers/orders.controller.js
const pool = require('../db');

// GET /api/orders
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.*, c.name AS company_name
       FROM orders o JOIN company c ON c.company_id = o.company_id
       ORDER BY o.order_date DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/orders/:id
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM orders WHERE order_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/orders  { company_id, direction }
// new orders start as DRAFT; total_amount is trigger-maintained from order_item
exports.create = async (req, res) => {
  try {
    const { company_id, direction } = req.body || {};
    if (!company_id || !direction) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const [result] = await pool.execute(
      "INSERT INTO orders (order_date, status, total_amount, direction, company_id) VALUES (NOW(), 'DRAFT', 0, ?, ?)",
      [direction, company_id]
    );
    res.status(201).json({ order_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/orders/:id  { company_id, direction, status }
exports.update = async (req, res) => {
  try {
    const { company_id, direction, status } = req.body || {};
    if (!company_id || !direction || !status) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const [result] = await pool.execute(
      'UPDATE orders SET company_id = ?, direction = ?, status = ? WHERE order_id = ?',
      [company_id, direction, status, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'order not found' });
    res.json({ message: 'order updated' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/orders/:id  (items are deleted first so the FK does not block it)
exports.remove = async (req, res) => {
  try {
    const [shipments] = await pool.execute('SELECT 1 FROM shipment WHERE order_id = ? LIMIT 1', [req.params.id]);
    if (shipments.length > 0) return res.status(409).json({ error: 'order already has a shipment' });
    await pool.execute('DELETE FROM order_item WHERE order_id = ?', [req.params.id]);
    const [result] = await pool.execute('DELETE FROM orders WHERE order_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'order not found' });
    res.json({ message: 'order deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/orders/:id/items
exports.getItems = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT oi.product_id, p.sku, p.name, oi.quantity, oi.unit_price, oi.line_total
       FROM order_item oi JOIN product p ON p.product_id = oi.product_id
       WHERE oi.order_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/orders/:id/items  { product_id, quantity, unit_price }
// line_total is a generated column, so it is not set here
exports.addItem = async (req, res) => {
  try {
    const { product_id, quantity, unit_price } = req.body || {};
    if (!product_id || quantity == null || unit_price == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    await pool.execute(
      'INSERT INTO order_item (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
      [req.params.id, product_id, quantity, unit_price]
    );
    res.status(201).json({ message: 'item added' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/orders/:id/items/:productId
exports.removeItem = async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM order_item WHERE order_id = ? AND product_id = ?',
      [req.params.id, req.params.productId]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'item not found' });
    res.json({ message: 'item deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
