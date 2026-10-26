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

// make the order's lines match items: update existing, insert new, delete missing
// (total_amount follows via the order_item triggers)
async function syncItems(conn, orderId, items) {
  const [rows] = await conn.execute('SELECT product_id FROM order_item WHERE order_id = ?', [orderId]);
  const existing = new Set(rows.map((r) => String(r.product_id)));
  const wanted = new Set(items.map((it) => String(it.product_id)));
  for (const productId of existing) {
    if (!wanted.has(productId)) await conn.query('CALL p_delete_order_item(?, ?)', [orderId, productId]);
  }
  for (const it of items) {
    const sql = existing.has(String(it.product_id))
      ? 'CALL p_update_order_item(?, ?, ?, ?)'
      : 'CALL p_insert_order_item(?, ?, ?, ?)';
    await conn.query(sql, [orderId, it.product_id, it.quantity, it.unit_price]);
  }
}

// shipment: { tracking_number, freight_date, expected_date, actual_date, destination_address }
// inserts the order's single shipment (1:1) or updates it if there is one;
// destination_address defaults to a snapshot of the company address
async function saveShipment(conn, orderId, s) {
  const [rows] = await conn.execute('SELECT 1 FROM shipment WHERE order_id = ?', [orderId]);
  const sql = rows.length > 0
    ? 'CALL p_update_shipment(?, ?, ?, ?, ?, ?)'
    : 'CALL p_insert_shipment(?, ?, ?, ?, ?, ?)';
  await conn.query(sql, [
    orderId,
    s.tracking_number ?? null,
    s.freight_date ?? null,
    s.expected_date ?? null,
    s.actual_date ?? null,
    s.destination_address ?? null,
  ]);
}

async function orderExists(conn, orderId) {
  const [rows] = await conn.execute('SELECT 1 FROM orders WHERE order_id = ?', [orderId]);
  return rows.length > 0;
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

// POST /api/orders  { company_id, direction, status?, items?: [...], shipment?: {...} }
// status defaults to DRAFT; total_amount is trigger-maintained from order_item
// order, items and shipment are written in one transaction
exports.create = async (req, res) => {
  try {
    const { company_id, direction, status, items = [], shipment } = req.body || {};
    if (!company_id || !direction) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const itemError = checkItems(items);
    if (itemError) return res.status(400).json({ error: itemError });

    const orderId = await pool.transaction(async (conn) => {
      await conn.query('CALL p_insert_order(?, ?, ?, @out)', [company_id, direction, status ?? null]);
      const [[{ id }]] = await conn.query('SELECT @out AS id');
      for (const it of items) {
        await conn.query('CALL p_insert_order_item(?, ?, ?, ?)', [id, it.product_id, it.quantity, it.unit_price]);
      }
      if (shipment) await saveShipment(conn, id, shipment);
      return id;
    });
    res.status(201).json({ order_id: orderId });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/orders/:id  { company_id, direction, status, items?: [...], shipment?: {...} | null }
// items, when sent, become the order's lines; shipment {...} inserts/updates, null removes it
exports.update = async (req, res) => {
  try {
    const { company_id, direction, status, items, shipment } = req.body || {};
    if (!company_id || !direction || !status) {
      return res.status(400).json({ error: 'missing fields' });
    }
    if (items !== undefined) {
      const itemError = checkItems(items);
      if (itemError) return res.status(400).json({ error: itemError });
    }

    const found = await pool.transaction(async (conn) => {
      if (!(await orderExists(conn, req.params.id))) return false;
      await conn.query('CALL p_update_order(?, ?, ?, ?)', [req.params.id, company_id, direction, status]);
      if (items !== undefined) await syncItems(conn, req.params.id, items);
      if (shipment === null) {
        await conn.query('CALL p_delete_shipment(?)', [req.params.id]);
      } else if (shipment !== undefined) {
        await saveShipment(conn, req.params.id, shipment);
      }
      return true;
    });
    if (!found) return res.status(404).json({ error: 'order not found' });
    res.json({ message: 'order updated' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/orders/:id  (items go via ON DELETE CASCADE)
exports.remove = async (req, res) => {
  try {
    const [shipments] = await pool.execute('SELECT 1 FROM shipment WHERE order_id = ? LIMIT 1', [req.params.id]);
    if (shipments.length > 0) return res.status(409).json({ error: 'order already has a shipment' });
    if (!(await orderExists(pool, req.params.id))) return res.status(404).json({ error: 'order not found' });
    await pool.query('CALL p_delete_order(?)', [req.params.id]);
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
// line_total is a generated column, so it is not set here
exports.addItem = async (req, res) => {
  try {
    const { product_id, quantity, unit_price } = req.body || {};
    if (!product_id || quantity == null || unit_price == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    await pool.query('CALL p_insert_order_item(?, ?, ?, ?)', [req.params.id, product_id, quantity, unit_price]);
    res.status(201).json({ message: 'item added' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/orders/:id/items/:productId  { quantity, unit_price }
exports.updateItem = async (req, res) => {
  try {
    const { quantity, unit_price } = req.body || {};
    if (quantity == null || unit_price == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const [rows] = await pool.execute(
      'SELECT 1 FROM order_item WHERE order_id = ? AND product_id = ?',
      [req.params.id, req.params.productId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'item not found' });
    await pool.query('CALL p_update_order_item(?, ?, ?, ?)', [req.params.id, req.params.productId, quantity, unit_price]);
    res.json({ message: 'item updated' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/orders/:id/items/:productId
exports.removeItem = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT 1 FROM order_item WHERE order_id = ? AND product_id = ?',
      [req.params.id, req.params.productId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'item not found' });
    await pool.query('CALL p_delete_order_item(?, ?)', [req.params.id, req.params.productId]);
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
    const found = await pool.transaction(async (conn) => {
      if (!(await orderExists(conn, req.params.id))) return false;
      await saveShipment(conn, req.params.id, req.body || {});
      return true;
    });
    if (!found) return res.status(404).json({ error: 'order not found' });
    res.json({ message: 'shipment saved' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/orders/:id/shipment
exports.removeShipment = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT 1 FROM shipment WHERE order_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'shipment not found' });
    await pool.query('CALL p_delete_shipment(?)', [req.params.id]);
    res.json({ message: 'shipment deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
