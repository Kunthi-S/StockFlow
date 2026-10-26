// controllers/orders.controller.js
const pool = require('../db');

// ---------- helpers (order_item / shipment) ----------

// items: [{ product_id, quantity, unit_price }]  -> error string or null
function checkItems(items) {
  if (!Array.isArray(items)) return 'items must be an array';
  for (const it of items) {
    if (!it || !it.product_id || it.quantity == null || it.unit_price == null) {
      return 'each item needs product_id, quantity, unit_price';
    }
  }
  const ids = items.map((it) => String(it.product_id));
  if (new Set(ids).size !== ids.length) return 'duplicate product_id in items';
  return null;
}

// line_total is a generated column, so it is not set here
async function insertItems(conn, orderId, items) {
  for (const it of items) {
    await conn.execute(
      'INSERT INTO order_item (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
      [orderId, it.product_id, it.quantity, it.unit_price]
    );
  }
}

// shipment: { tracking_number, freight_date, expected_date, actual_date, destination_address }
// insert or update the order's single shipment (1:1 via uq_shipment_order);
// destination_address defaults to a snapshot of the company address
async function saveShipment(conn, orderId, s) {
  const [result] = await conn.execute(
    `INSERT INTO shipment (order_id, tracking_number, freight_date, expected_date, actual_date, destination_address)
     SELECT o.order_id, ?, ?, ?, ?, COALESCE(?, CONCAT_WS(', ', c.street, c.city, c.postal_code))
     FROM orders o JOIN company c ON c.company_id = o.company_id
     WHERE o.order_id = ?
     ON DUPLICATE KEY UPDATE
       tracking_number = VALUES(tracking_number),
       freight_date = VALUES(freight_date),
       expected_date = VALUES(expected_date),
       actual_date = VALUES(actual_date),
       destination_address = VALUES(destination_address)`,
    [
      s.tracking_number ?? null,
      s.freight_date ?? null,
      s.expected_date ?? null,
      s.actual_date ?? null,
      s.destination_address ?? null,
      orderId,
    ]
  );
  return result.affectedRows;
}

// ---------- orders ----------

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

// GET /api/orders/:id  (order with its items and shipment)
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.*, c.name AS company_name
       FROM orders o JOIN company c ON c.company_id = o.company_id
       WHERE o.order_id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'order not found' });
    const [items] = await pool.execute(
      `SELECT oi.product_id, p.sku, p.name, oi.quantity, oi.unit_price, oi.line_total
       FROM order_item oi JOIN product p ON p.product_id = oi.product_id
       WHERE oi.order_id = ?`,
      [req.params.id]
    );
    const [shipment] = await pool.execute('SELECT * FROM shipment WHERE order_id = ?', [req.params.id]);
    res.json({ ...rows[0], items, shipment: shipment[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/orders  { company_id, direction, items?: [...], shipment?: {...} }
// new orders start as DRAFT; total_amount is trigger-maintained from order_item
// order, items and shipment are written in one transaction
exports.create = async (req, res) => {
  const { company_id, direction, items = [], shipment } = req.body || {};
  if (!company_id || !direction) {
    return res.status(400).json({ error: 'missing fields' });
  }
  const itemError = checkItems(items);
  if (itemError) return res.status(400).json({ error: itemError });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      "INSERT INTO orders (order_date, status, total_amount, direction, company_id) VALUES (NOW(), 'DRAFT', 0, ?, ?)",
      [direction, company_id]
    );
    const orderId = result.insertId;
    await insertItems(conn, orderId, items);
    if (shipment) await saveShipment(conn, orderId, shipment);
    await conn.commit();
    res.status(201).json({ order_id: orderId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message, sql: err.sql });
  } finally {
    conn.release();
  }
};

// PUT /api/orders/:id  { company_id, direction, status, items?: [...], shipment?: {...} | null }
// items, when sent, replace all existing lines; shipment {...} upserts, null removes it
exports.update = async (req, res) => {
  const { company_id, direction, status, items, shipment } = req.body || {};
  if (!company_id || !direction || !status) {
    return res.status(400).json({ error: 'missing fields' });
  }
  if (items !== undefined) {
    const itemError = checkItems(items);
    if (itemError) return res.status(400).json({ error: itemError });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      'UPDATE orders SET company_id = ?, direction = ?, status = ? WHERE order_id = ?',
      [company_id, direction, status, req.params.id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'order not found' });
    }
    if (items !== undefined) {
      await conn.execute('DELETE FROM order_item WHERE order_id = ?', [req.params.id]);
      await insertItems(conn, req.params.id, items);
    }
    if (shipment === null) {
      await conn.execute('DELETE FROM shipment WHERE order_id = ?', [req.params.id]);
    } else if (shipment !== undefined) {
      await saveShipment(conn, req.params.id, shipment);
    }
    await conn.commit();
    res.json({ message: 'order updated' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message, sql: err.sql });
  } finally {
    conn.release();
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

// ---------- order items ----------

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
exports.addItem = async (req, res) => {
  try {
    const { product_id, quantity, unit_price } = req.body || {};
    if (!product_id || quantity == null || unit_price == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    await insertItems(pool, req.params.id, [{ product_id, quantity, unit_price }]);
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

// ---------- shipment (1:1) ----------

// GET /api/orders/:id/shipment
exports.getShipment = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM shipment WHERE order_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'shipment not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/orders/:id/shipment  { tracking_number, freight_date, expected_date, actual_date, destination_address }
// creates the shipment if the order has none, otherwise updates it
exports.saveShipment = async (req, res) => {
  try {
    const affected = await saveShipment(pool, req.params.id, req.body || {});
    if (affected === 0) return res.status(404).json({ error: 'order not found' });
    res.json({ message: 'shipment saved' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/orders/:id/shipment
exports.removeShipment = async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM shipment WHERE order_id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'shipment not found' });
    res.json({ message: 'shipment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
