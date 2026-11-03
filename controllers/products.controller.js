const pool = require('../db');
const { fail } = require('../utils/http');

// The type_data fields each product type needs
const REQUIRED_TYPE_FIELDS = {
  PACKAGED: ['units_per_pack', 'package_type'],
  WEIGHED: ['tare_weight_kg', 'avg_net_weight_kg', 'unit_of_measure'],
  COUNTED: ['unit_label'],
};

// Returns an error message, or null
function checkProduct(body) {
  const { sku, name, category, standard_cost, product_type, type_data } = body;
  if (!sku || !name || !category || standard_cost == null) {
    return 'sku, name, category and standard_cost are required';
  }
  const required = REQUIRED_TYPE_FIELDS[product_type];
  if (!required) return 'product_type must be PACKAGED, WEIGHED or COUNTED';
  if (!type_data) return 'type_data is required';
  for (const field of required) {
    if (type_data[field] == null || type_data[field] === '') return 'type_data needs ' + field;
  }
  return null;
}

// Save the locations; a new code becomes a new location. Returns an error, or null
async function saveLocations(conn, productId, locations) {
  for (const loc of locations) {
    const [found] = await conn.execute('SELECT location_id FROM location WHERE code = ?', [loc.code]);
    let locationId;
    if (found.length > 0) {
      locationId = found[0].location_id;
    } else {
      if (!loc.aisle || !loc.capacity_slots) return 'new location ' + loc.code + ' needs an aisle and capacity_slots';
      const [r] = await conn.execute(
        'INSERT INTO location (code, capacity_slots, aisle) VALUES (?, ?, ?)',
        [loc.code, loc.capacity_slots, loc.aisle]);
      locationId = r.insertId;
    }
    await conn.execute(
      'INSERT INTO stored_at (location_id, product_id, quantity_at_location) VALUES (?, ?, ?)',
      [locationId, productId, loc.quantity_at_location ?? 0]);
  }
  return null;
}

// GET /api/products
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM v_stock_summary ORDER BY product_id');
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/products/:id - with its locations
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM product WHERE product_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'product not found' });

    const [locations] = await pool.execute(
      `SELECT l.code, l.aisle, l.capacity_slots, s.quantity_at_location
         FROM stored_at s JOIN location l ON l.location_id = s.location_id
        WHERE s.product_id = ?
        ORDER BY l.code`, [req.params.id]);
    const product = rows[0];
    product.locations = locations;
    res.json(product);
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/products/locations
exports.getLocations = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM location ORDER BY code');
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/products - product + locations in one transaction
exports.create = async (req, res) => {
  const error = checkProduct(req.body);
  if (error) return res.status(400).json({ error });
  const { sku, name, category, standard_cost, reorder_level, product_type, type_data } = req.body;
  const locations = req.body.locations ?? [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `INSERT INTO product (sku, name, category, standard_cost, reorder_level, product_type, type_data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [sku, name, category, standard_cost, reorder_level ?? null, product_type, JSON.stringify(type_data)]);

    const locError = await saveLocations(conn, r.insertId, locations);
    if (locError) {
      await conn.rollback();
      return res.status(400).json({ error: locError });
    }
    await conn.commit();
    res.status(201).json({ product_id: r.insertId });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'that SKU or location is already used' });
    fail(res, err);
  } finally {
    conn.release();
  }
};

// PUT /api/products/:id - replaces its locations, in one transaction
exports.update = async (req, res) => {
  const error = checkProduct(req.body);
  if (error) return res.status(400).json({ error });
  const { sku, name, category, standard_cost, reorder_level, product_type, type_data } = req.body;
  const locations = req.body.locations ?? [];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `UPDATE product
          SET sku = ?, name = ?, category = ?, standard_cost = ?, reorder_level = ?,
              product_type = ?, type_data = ?
        WHERE product_id = ?`,
      [sku, name, category, standard_cost, reorder_level ?? null, product_type, JSON.stringify(type_data), req.params.id]);
    if (r.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'product not found' });
    }

    await conn.execute('DELETE FROM stored_at WHERE product_id = ?', [req.params.id]);
    const locError = await saveLocations(conn, req.params.id, locations);
    if (locError) {
      await conn.rollback();
      return res.status(400).json({ error: locError });
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'that SKU or location is already used' });
    fail(res, err);
  } finally {
    conn.release();
  }
};

// DELETE /api/products/:id - refused while in orders or in stock
exports.remove = async (req, res) => {
  try {
    const [items] = await pool.execute('SELECT order_id FROM order_item WHERE product_id = ?', [req.params.id]);
    if (items.length > 0) return res.status(409).json({ error: 'product is used in orders' });

    const [stock] = await pool.execute('SELECT location_id FROM stored_at WHERE product_id = ?', [req.params.id]);
    if (stock.length > 0) return res.status(409).json({ error: 'product still has stock - remove its locations first' });

    const [r] = await pool.execute('DELETE FROM product WHERE product_id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'product not found' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
};
