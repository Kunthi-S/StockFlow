// controllers/orders.controller.js
const pool = require('../db');

// GET /api/orders   newest first, with the company's name (JOIN, Lab 8)
// and its shipment's tracking number / dates (LEFT JOIN: not every order has one)
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_date, o.status, o.direction, o.total_amount,
              o.company_id, c.name AS company_name,
              s.tracking_number, s.expected_date, s.actual_date
         FROM orders o
         JOIN company c ON c.company_id = o.company_id
         LEFT JOIN shipment s ON s.order_id = o.order_id
        ORDER BY o.order_date DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/orders/:id   one order with a nested items array and its shipment (or null)
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT o.order_id, o.order_date, o.status, o.direction, o.total_amount,
              o.company_id, c.name AS company_name, c.street, c.city, c.postal_code
         FROM orders o JOIN company c ON c.company_id = o.company_id
        WHERE o.order_id = ?`, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'order not found' });

    const [items] = await pool.execute(
      `SELECT oi.product_id, p.sku, p.name, oi.quantity, oi.unit_price, oi.line_total
         FROM order_item oi JOIN product p ON p.product_id = oi.product_id
        WHERE oi.order_id = ?`, [req.params.id]);
    const [shipments] = await pool.execute(
      `SELECT shipment_id, tracking_number, freight_date, expected_date, actual_date, destination_address
         FROM shipment WHERE order_id = ?`, [req.params.id]);
    const order = rows[0];
    order.items = items;
    order.shipment = shipments[0] ?? null;
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/orders
// body: { company_id, direction: 'IN' | 'OUT', items: [{ product_id, quantity, unit_price }] }
// The order and its items are saved in ONE transaction (Lab 9): if any item
// fails, the order is rolled back too. total_amount is filled in by the
// order_item triggers (Lab 11), so it is not set here.
exports.create = async (req, res) => {
  const { company_id, direction, items } = req.body;
  if (!company_id || (direction !== 'IN' && direction !== 'OUT')) {
    return res.status(400).json({ error: "company_id and direction ('IN' or 'OUT') are required" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'an order needs at least one item' });
  }
  for (const it of items) {
    if (!it.product_id || !(it.quantity > 0) || !(it.unit_price >= 0)) {
      return res.status(400).json({ error: 'each item needs product_id, quantity > 0 and unit_price >= 0' });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      'INSERT INTO orders (company_id, direction) VALUES (?, ?)', [company_id, direction]);
    for (const it of items) {
      await conn.execute(
        'INSERT INTO order_item (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [r.insertId, it.product_id, it.quantity, it.unit_price]);
    }
    await conn.commit();
    res.status(201).json({ order_id: r.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'company or product not found' });
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'the same product is listed twice' });
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

const STATUSES = ['DRAFT', 'CONFIRMED', 'IN_TRANSIT', 'RECEIVED', 'SHIPPED', 'CANCELLED'];

// An order's items are in stock once it is done: an IN order adds them when
// it is RECEIVED, an OUT order takes them out when it is SHIPPED.
const movesStock = (direction, status) =>
  (direction === 'IN' && status === 'RECEIVED') || (direction === 'OUT' && status === 'SHIPPED');

// Add (sign 1) or take out (sign -1) every item of the order in stored_at.
// Stock is added to the location holding the most of the product and taken
// from the fullest locations first. quantity_on_hand follows via the
// stored_at triggers. Returns an error message, or null.
async function moveStock(conn, orderId, sign) {
  const [items] = await conn.execute(
    `SELECT oi.product_id, oi.quantity, p.sku
       FROM order_item oi JOIN product p ON p.product_id = oi.product_id
      WHERE oi.order_id = ?`, [orderId]);
  for (const it of items) {
    const [locs] = await conn.execute(
      'SELECT location_id, quantity_at_location FROM stored_at WHERE product_id = ? ORDER BY quantity_at_location DESC',
      [it.product_id]);
    if (locs.length === 0) return it.sku + ' has no storage location';

    let left = Number(it.quantity);
    for (const loc of locs) {
      const amount = sign > 0 ? left : Math.min(left, Number(loc.quantity_at_location));
      await conn.execute(
        'UPDATE stored_at SET quantity_at_location = quantity_at_location + ? WHERE location_id = ? AND product_id = ?',
        [sign * amount, loc.location_id, it.product_id]);
      left = Math.round((left - amount) * 1000) / 1000;   // quantities have 3 decimals
      if (left === 0) break;
    }
    if (left > 0) return 'not enough stock of ' + it.sku;
  }
  return null;
}

// DELETE /api/orders/:id
// The order's items are removed by ON DELETE CASCADE. An order that already
// has a shipment cannot be deleted (ON DELETE RESTRICT), so check that first.
// Neither can an order whose stock has moved, or the stock would be wrong.
exports.remove = async (req, res) => {
  try {
    const [shipments] = await pool.execute('SELECT shipment_id FROM shipment WHERE order_id = ?', [req.params.id]);
    if (shipments.length > 0) return res.status(409).json({ error: 'order already has a shipment' });
    const [rows] = await pool.execute('SELECT direction, status FROM orders WHERE order_id = ?', [req.params.id]);
    if (rows.length > 0 && movesStock(rows[0].direction, rows[0].status)) {
      return res.status(409).json({ error: 'its stock has moved - change its status first' });
    }

    const [r] = await pool.execute('DELETE FROM orders WHERE order_id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'order not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/orders/:id/status   body: { status }
// The status and the stock it moves are saved in ONE transaction (Lab 9).
// Changing the status back (e.g. SHIPPED -> CONFIRMED) moves the stock back.
exports.updateStatus = async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'status must be one of ' + STATUSES.join(', ') });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute(
      'SELECT direction, status FROM orders WHERE order_id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'order not found' });
    }
    const { direction } = rows[0];
    const wasMoved = movesStock(direction, rows[0].status);
    const isMoved = movesStock(direction, status);
    if (wasMoved !== isMoved) {
      // IN adds stock, OUT takes it out; undoing does the opposite
      const error = await moveStock(conn, req.params.id, (direction === 'IN') === isMoved ? 1 : -1);
      if (error) {
        await conn.rollback();
        return res.status(409).json({ error });
      }
    }
    await conn.execute('UPDATE orders SET status = ? WHERE order_id = ?', [status, req.params.id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// PUT /api/orders/:id/shipment
// body: { tracking_number, freight_date, expected_date, actual_date, destination_address }
// Creates the order's shipment if it has none (1:1), otherwise updates it.
// Empty strings are saved as NULL; only destination_address is required.
exports.saveShipment = async (req, res) => {
  const value = (v) => (v === '' || v === undefined ? null : v);
  const { destination_address } = req.body;
  if (!destination_address) return res.status(400).json({ error: 'destination_address is required' });
  const fields = [value(req.body.tracking_number), value(req.body.freight_date),
                  value(req.body.expected_date), value(req.body.actual_date), destination_address];
  try {
    const [found] = await pool.execute('SELECT shipment_id FROM shipment WHERE order_id = ?', [req.params.id]);
    if (found.length > 0) {
      await pool.execute(
        `UPDATE shipment
            SET tracking_number = ?, freight_date = ?, expected_date = ?, actual_date = ?, destination_address = ?
          WHERE order_id = ?`, [...fields, req.params.id]);
      return res.json({ ok: true });
    }
    await pool.execute(
      `INSERT INTO shipment (tracking_number, freight_date, expected_date, actual_date, destination_address, order_id)
       VALUES (?, ?, ?, ?, ?, ?)`, [...fields, req.params.id]);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'order not found' });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'that tracking number is already used' });
    if (err.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      return res.status(400).json({ error: 'expected and delivered dates cannot be before the freight date' });
    }
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/orders/:id/shipment
exports.removeShipment = async (req, res) => {
  try {
    const [r] = await pool.execute('DELETE FROM shipment WHERE order_id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'shipment not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
