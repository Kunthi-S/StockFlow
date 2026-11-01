// controllers/products.controller.js
const pool = require('../db');

// ---------- subtype tables ----------

// Specialization 1: disjoint, total -> every product has exactly one of these
const TYPES = {
  packaged: { table: 'packaged_product', required: ['units_per_pack', 'package_type'], optional: ['pack_barcode'] },
  weighed: { table: 'weighed_product', required: ['tare_weight_kg', 'avg_net_weight_kg', 'unit_of_measure'], optional: [] },
  counted: { table: 'counted_product', required: ['unit_label'], optional: ['is_serialized'] },
};

// Specialization 2: overlapping, partial -> a product may have none, one or both
const EXTRAS = {
  hazardous: { table: 'hazardous_product', required: ['un_number', 'hazard_class', 'msds_ref'], optional: [] },
  perishable: { table: 'perishable_product', required: ['shelf_life_days'], optional: [] },
};

// the one TYPES key present in body, or an error
function pickType(body, isRequired) {
  const keys = Object.keys(TYPES).filter((k) => body[k] != null);
  if (keys.length > 1) return { error: 'product can only be one of packaged, weighed, counted' };
  if (keys.length === 0 && isRequired) return { error: 'product needs one of packaged, weighed, counted' };
  return { type: keys[0] };
}

// error string or null
function checkFields(name, spec, data) {
  if (typeof data !== 'object') return `${name} must be an object`;
  const missing = spec.required.filter((col) => data[col] == null);
  return missing.length ? `${name} missing ${missing.join(', ')}` : null;
}

// locations: [{ location_id | code, aisle?, capacity_units?, quantity_at_location }]
// (aisle and capacity_units are only needed when code is a new location)
function checkLocations(locations) {
  if (!Array.isArray(locations)) return 'locations must be an array';
  for (const l of locations) {
    if (!l || (!l.location_id && !l.code)) return 'each location needs location_id or code';
  }
  const keys = locations.map((l) => (l.location_id ? `id:${l.location_id}` : `code:${l.code}`));
  if (new Set(keys).size !== keys.length) return 'duplicate location in locations';
  return null;
}

// lots: [{ lot_no, received_date, expiry_date?, quantity_remaining? }]
function checkLots(lots) {
  if (!Array.isArray(lots)) return 'perishable.lots must be an array';
  for (const lot of lots) {
    if (!lot || !lot.lot_no || !lot.received_date) return 'each lot needs lot_no, received_date';
  }
  return null;
}

// insert or update the product's row in a subtype table
async function saveSubtype(conn, productId, spec, data) {
  const cols = [...spec.required, ...spec.optional];
  await conn.execute(
    `INSERT INTO ${spec.table} (product_id, ${cols.join(', ')})
     VALUES (?, ${cols.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = VALUES(${c})`).join(', ')}`,
    [productId, ...cols.map((c) => data[c] ?? null)]
  );
}

// expiry_date defaults to received_date + shelf_life_days
async function insertLots(conn, productId, lots) {
  for (const lot of lots) {
    await conn.execute(
      `INSERT INTO lot (product_id, lot_no, received_date, expiry_date, quantity_remaining)
       SELECT product_id, ?, ?, COALESCE(?, DATE_ADD(?, INTERVAL shelf_life_days DAY)), ?
       FROM perishable_product WHERE product_id = ?`,
      [lot.lot_no, lot.received_date, lot.expiry_date ?? null, lot.received_date, lot.quantity_remaining ?? 0, productId]
    );
  }
}

// there is no locations page, so a location given by code is created here if it does not exist yet
async function resolveLocationId(conn, l) {
  if (l.location_id) return l.location_id;
  const [rows] = await conn.execute('SELECT location_id FROM location WHERE code = ?', [l.code]);
  if (rows.length > 0) return rows[0].location_id;
  if (!l.aisle || l.capacity_units == null) {
    throw Object.assign(new Error(`new location ${l.code} needs aisle, capacity_units`), { status: 400 });
  }
  const [result] = await conn.execute(
    'INSERT INTO location (code, capacity_units, aisle) VALUES (?, ?, ?)',
    [l.code, l.capacity_units, l.aisle]
  );
  return result.insertId;
}

async function insertLocations(conn, productId, locations) {
  for (const l of locations) {
    const locationId = await resolveLocationId(conn, l);
    await conn.execute(
      'INSERT INTO stored_at (location_id, product_id, quantity_at_location) VALUES (?, ?, ?)',
      [locationId, productId, l.quantity_at_location ?? 0]
    );
  }
}

// validates everything the body may carry besides the base product fields
function checkChildren(body, typeRequired) {
  const { type, error } = pickType(body, typeRequired);
  if (error) return { error };
  if (type) {
    const e = checkFields(type, TYPES[type], body[type]);
    if (e) return { error: e };
  }
  for (const name of Object.keys(EXTRAS)) {
    if (body[name] == null) continue;
    const e = checkFields(name, EXTRAS[name], body[name]);
    if (e) return { error: e };
  }
  if (body.perishable && body.perishable.lots !== undefined) {
    const e = checkLots(body.perishable.lots);
    if (e) return { error: e };
  }
  if (body.locations !== undefined) {
    const e = checkLocations(body.locations);
    if (e) return { error: e };
  }
  return { type };
}

// ---------- products ----------

// GET /api/products  (with subtype flags)
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*,
         CASE WHEN pk.product_id IS NOT NULL THEN 'packaged'
              WHEN w.product_id  IS NOT NULL THEN 'weighed'
              WHEN c.product_id  IS NOT NULL THEN 'counted' END AS type,
         h.product_id  IS NOT NULL AS is_hazardous,
         pe.product_id IS NOT NULL AS is_perishable
       FROM product p
       LEFT JOIN packaged_product pk  ON pk.product_id = p.product_id
       LEFT JOIN weighed_product w    ON w.product_id  = p.product_id
       LEFT JOIN counted_product c    ON c.product_id  = p.product_id
       LEFT JOIN hazardous_product h  ON h.product_id  = p.product_id
       LEFT JOIN perishable_product pe ON pe.product_id = p.product_id
       ORDER BY p.product_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/products/:id  (product with subtype rows, lots and locations, same shape as POST/PUT)
exports.getById = async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await pool.execute('SELECT * FROM product WHERE product_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'product not found' });
    const product = { ...rows[0], type: null };

    for (const [name, spec] of Object.entries({ ...TYPES, ...EXTRAS })) {
      const [sub] = await pool.execute(`SELECT * FROM ${spec.table} WHERE product_id = ?`, [id]);
      product[name] = sub[0] || null;
      if (sub[0] && TYPES[name]) product.type = name;
    }
    if (product.perishable) {
      const [lots] = await pool.execute('SELECT * FROM lot WHERE product_id = ? ORDER BY expiry_date', [id]);
      product.perishable.lots = lots;
    }
    const [locations] = await pool.execute(
      `SELECT s.location_id, l.code, l.aisle, l.capacity_units, s.quantity_at_location
       FROM stored_at s JOIN location l ON l.location_id = s.location_id
       WHERE s.product_id = ?
       ORDER BY l.code`,
      [id]
    );
    product.locations = locations;
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/products
// { sku, name, category, standard_cost, reorder_level,
//   packaged | weighed | counted: {...},              (exactly one, required)
//   hazardous?: {...}, perishable?: { shelf_life_days, lots?: [...] },
//   locations?: [{ location_id, quantity_at_location }] }
// quantity_on_hand is trigger-maintained, so it is not set here
// product, subtypes, lots and stored_at rows are written in one transaction
exports.create = async (req, res) => {
  const body = req.body || {};
  const { sku, name, category, standard_cost, reorder_level } = body;
  if (!sku || !name || !category || standard_cost == null || reorder_level == null) {
    return res.status(400).json({ error: 'missing fields' });
  }
  const { type, error } = checkChildren(body, true);
  if (error) return res.status(400).json({ error });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      'INSERT INTO product (sku, name, category, standard_cost, reorder_level) VALUES (?, ?, ?, ?, ?)',
      [sku, name, category, standard_cost, reorder_level]
    );
    const productId = result.insertId;
    await saveSubtype(conn, productId, TYPES[type], body[type]);
    for (const [extra, spec] of Object.entries(EXTRAS)) {
      if (body[extra]) await saveSubtype(conn, productId, spec, body[extra]);
    }
    if (body.perishable && body.perishable.lots) await insertLots(conn, productId, body.perishable.lots);
    if (body.locations) await insertLocations(conn, productId, body.locations);
    await conn.commit();
    res.status(201).json({ product_id: productId });
  } catch (err) {
    await conn.rollback();
    res.status(err.status || 500).json({ error: err.message, sql: err.sql });
  } finally {
    conn.release();
  }
};

// PUT /api/products/:id  same body as POST, but every child part is optional:
//   packaged | weighed | counted  -> replaces the product's type
//   hazardous / perishable {...}  -> upsert, null removes it (removing perishable also removes its lots)
//   perishable.lots [...]         -> replaces all lots
//   locations [...]               -> replaces all stored_at rows
exports.update = async (req, res) => {
  const body = req.body || {};
  const { sku, name, category, standard_cost, reorder_level } = body;
  if (!sku || !name || !category || standard_cost == null || reorder_level == null) {
    return res.status(400).json({ error: 'missing fields' });
  }
  const { type, error } = checkChildren(body, false);
  if (error) return res.status(400).json({ error });

  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      'UPDATE product SET sku = ?, name = ?, category = ?, standard_cost = ?, reorder_level = ? WHERE product_id = ?',
      [sku, name, category, standard_cost, reorder_level, id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'product not found' });
    }
    if (type) {
      // disjoint: clear the other subtype tables before writing the new one
      for (const [other, spec] of Object.entries(TYPES)) {
        if (other !== type) await conn.execute(`DELETE FROM ${spec.table} WHERE product_id = ?`, [id]);
      }
      await saveSubtype(conn, id, TYPES[type], body[type]);
    }
    for (const [extra, spec] of Object.entries(EXTRAS)) {
      if (body[extra] === null) {
        await conn.execute(`DELETE FROM ${spec.table} WHERE product_id = ?`, [id]);
      } else if (body[extra] !== undefined) {
        await saveSubtype(conn, id, spec, body[extra]);
      }
    }
    if (body.perishable && body.perishable.lots) {
      await conn.execute('DELETE FROM lot WHERE product_id = ?', [id]);
      await insertLots(conn, id, body.perishable.lots);
    }
    if (body.locations) {
      await conn.execute('DELETE FROM stored_at WHERE product_id = ?', [id]);
      await insertLocations(conn, id, body.locations);
    }
    await conn.commit();
    res.json({ message: 'product updated' });
  } catch (err) {
    await conn.rollback();
    res.status(err.status || 500).json({ error: err.message, sql: err.sql });
  } finally {
    conn.release();
  }
};

// DELETE /api/products/:id
// subtype rows and lots cascade; stored_at rows are deleted first so the FK does not block it
exports.remove = async (req, res) => {
  const id = req.params.id;
  const conn = await pool.getConnection();
  try {
    const [items] = await conn.execute('SELECT 1 FROM order_item WHERE product_id = ? LIMIT 1', [id]);
    if (items.length > 0) return res.status(409).json({ error: 'product is used in orders' });
    await conn.beginTransaction();
    await conn.execute('DELETE FROM stored_at WHERE product_id = ?', [id]);
    const [result] = await conn.execute('DELETE FROM product WHERE product_id = ?', [id]);
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'product not found' });
    }
    await conn.commit();
    res.json({ message: 'product deleted' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message, sql: err.sql });
  } finally {
    conn.release();
  }
};

// ---------- lots (perishable products only) ----------

// GET /api/products/:id/lots
exports.getLots = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM lot WHERE product_id = ? ORDER BY expiry_date', [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/products/:id/lots  { lot_no, received_date, expiry_date?, quantity_remaining? }
exports.addLot = async (req, res) => {
  try {
    const lot = req.body || {};
    if (!lot.lot_no || !lot.received_date) return res.status(400).json({ error: 'missing fields' });
    const [perishable] = await pool.execute('SELECT 1 FROM perishable_product WHERE product_id = ?', [req.params.id]);
    if (perishable.length === 0) return res.status(404).json({ error: 'perishable product not found' });
    await insertLots(pool, req.params.id, [lot]);
    res.status(201).json({ message: 'lot added' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/products/:id/lots/:lotNo
exports.removeLot = async (req, res) => {
  try {
    const [result] = await pool.execute(
      'DELETE FROM lot WHERE product_id = ? AND lot_no = ?',
      [req.params.id, req.params.lotNo]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'lot not found' });
    res.json({ message: 'lot deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// ---------- locations (picker for the products page) ----------

// GET /api/products/locations  (all locations with units currently stored)
exports.getLocations = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT l.*, COALESCE(SUM(s.quantity_at_location), 0) AS units_stored
       FROM location l LEFT JOIN stored_at s ON s.location_id = l.location_id
       GROUP BY l.location_id
       ORDER BY l.code`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
