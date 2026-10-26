// controllers/products.controller.js
const pool = require('../db');

// GET /api/products
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM product ORDER BY product_id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/products/:id
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM product WHERE product_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'product not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/products  { sku, name, category, standard_cost, reorder_level }
// quantity_on_hand is trigger-maintained, so it is not set here
exports.create = async (req, res) => {
  try {
    const { sku, name, category, standard_cost, reorder_level } = req.body || {};
    if (!sku || !name || !category || standard_cost == null || reorder_level == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const [result] = await pool.execute(
      'INSERT INTO product (sku, name, category, standard_cost, reorder_level) VALUES (?, ?, ?, ?, ?)',
      [sku, name, category, standard_cost, reorder_level]
    );
    res.status(201).json({ product_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/products/:id  { sku, name, category, standard_cost, reorder_level }
exports.update = async (req, res) => {
  try {
    const { sku, name, category, standard_cost, reorder_level } = req.body || {};
    if (!sku || !name || !category || standard_cost == null || reorder_level == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const [result] = await pool.execute(
      'UPDATE product SET sku = ?, name = ?, category = ?, standard_cost = ?, reorder_level = ? WHERE product_id = ?',
      [sku, name, category, standard_cost, reorder_level, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'product not found' });
    res.json({ message: 'product updated' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/products/:id
exports.remove = async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM product WHERE product_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'product not found' });
    res.json({ message: 'product deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
