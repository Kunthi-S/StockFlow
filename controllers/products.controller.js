// controllers/products.controller.js
const pool = require('../db');

// ---------- subtype tables ----------

// Specialization: disjoint, total -> every product has exactly one of these
// fields are in the order the insert / update procedures take them
// insert: (sku, name, category, standard_cost, reorder_level, ...fields, @out)
// update: (product_id, ...fields) -> also switches the product to this type
const TYPES = {
  packaged: {
    table: 'packaged_product',
    fields: ['units_per_pack', 'package_type', 'pack_barcode'],
    required: ['units_per_pack', 'package_type'],
    insert: 'CALL p_insert_packaged_product(?, ?, ?, ?, ?, ?, ?, ?, @out)',
    update: 'CALL p_update_packaged_product(?, ?, ?, ?)',
  },
  weighed: {
    table: 'weighed_product',
    fields: ['tare_weight_kg', 'avg_net_weight_kg', 'unit_of_measure'],
    required: ['tare_weight_kg', 'avg_net_weight_kg', 'unit_of_measure'],
    insert: 'CALL p_insert_weighed_product(?, ?, ?, ?, ?, ?, ?, ?, @out)',
    update: 'CALL p_update_weighed_product(?, ?, ?, ?)',
  },
  counted: {
    table: 'counted_product',
    fields: ['unit_label', 'is_serialized'],
    required: ['unit_label'],
    insert: 'CALL p_insert_counted_product(?, ?, ?, ?, ?, ?, ?, @out)',
    update: 'CALL p_update_counted_product(?, ?, ?)',
  },
};

const BASE_FIELDS = ['sku', 'name', 'category', 'standard_cost', 'reorder_level'];

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

// validates the type and locations parts of the body
function checkChildren(body, typeRequired) {
  const { type, error } = pickType(body, typeRequired);
  if (error) return { error };
  if (type) {
    const e = checkFields(type, TYPES[type], body[type]);
    if (e) return { error: e };
  }
  if (body.locations !== undefined) {
    const e = checkLocations(body.locations);
    if (e) return { error: e };
  }
  return { type };
}

const baseArgs = (body) => BASE_FIELDS.map((f) => body[f]);
const typeArgs = (type, body) => TYPES[type].fields.map((f) => body[type][f] ?? null);

// there is no locations page, so a location given by code is created here if it does not exist yet
async function resolveLocationId(conn, l) {
  if (l.location_id) return l.location_id;
  const [rows] = await conn.execute('SELECT location_id FROM location WHERE code = ?', [l.code]);
  if (rows.length > 0) return rows[0].location_id;
  if (!l.aisle || l.capacity_units == null) {
    throw Object.assign(new Error(`new location ${l.code} needs aisle, capacity_units`), { status: 400 });
  }
  await conn.query('CALL p_insert_location(?, ?, ?, @out)', [l.code, l.capacity_units, l.aisle]);
  const [[{ id }]] = await conn.query('SELECT @out AS id');
  return id;
}

// make the product's stored_at rows match locations: update existing, insert new, delete missing
// (quantity_on_hand follows via the stored_at triggers)
async function syncLocations(conn, productId, locations) {
  const [rows] = await conn.execute('SELECT location_id FROM stored_at WHERE product_id = ?', [productId]);
  const existing = new Set(rows.map((r) => String(r.location_id)));
  const wanted = [];
  for (const l of locations) {
    wanted.push({ locationId: String(await resolveLocationId(conn, l)), quantity: l.quantity_at_location ?? 0 });
  }
  const wantedIds = new Set(wanted.map((w) => w.locationId));
  if (wantedIds.size !== wanted.length) {
    throw Object.assign(new Error('duplicate location in locations'), { status: 400 });
  }
  for (const locationId of existing) {
    if (!wantedIds.has(locationId)) await conn.query('CALL p_delete_product_location(?, ?)', [productId, locationId]);
  }
  for (const w of wanted) {
    const sql = existing.has(w.locationId)
      ? 'CALL p_update_product_location(?, ?, ?)'
      : 'CALL p_add_product_location(?, ?, ?)';
    await conn.query(sql, [productId, w.locationId, w.quantity]);
  }
}

// ---------- products ----------

// GET /api/products  (with type)
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT p.*,
         CASE WHEN pk.product_id IS NOT NULL THEN 'packaged'
              WHEN w.product_id  IS NOT NULL THEN 'weighed'
              WHEN c.product_id  IS NOT NULL THEN 'counted' END AS type
       FROM product p
       LEFT JOIN packaged_product pk ON pk.product_id = p.product_id
       LEFT JOIN weighed_product w   ON w.product_id  = p.product_id
       LEFT JOIN counted_product c   ON c.product_id  = p.product_id
       ORDER BY p.product_id`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/products/:id  (product with its subtype row and locations, same shape as POST/PUT)
exports.getById = async (req, res) => {
  try {
    const id = req.params.id;
    const [rows] = await pool.execute('SELECT * FROM product WHERE product_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'product not found' });
    const product = { ...rows[0], type: null };

    for (const [name, spec] of Object.entries(TYPES)) {
      const [sub] = await pool.execute(`SELECT * FROM ${spec.table} WHERE product_id = ?`, [id]);
      product[name] = sub[0] || null;
      if (sub[0]) product.type = name;
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
//   locations?: [{ location_id | code, aisle?, capacity_units?, quantity_at_location }] }
// quantity_on_hand is trigger-maintained, so it is not set here
// product, subtype and stored_at rows are written in one transaction
exports.create = async (req, res) => {
  try {
    const body = req.body || {};
    const { sku, name, category, standard_cost, reorder_level } = body;
    if (!sku || !name || !category || standard_cost == null || reorder_level == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const { type, error } = checkChildren(body, true);
    if (error) return res.status(400).json({ error });

    const productId = await pool.transaction(async (conn) => {
      await conn.query(TYPES[type].insert, [...baseArgs(body), ...typeArgs(type, body)]);
      const [[{ id }]] = await conn.query('SELECT @out AS id');
      if (body.locations) await syncLocations(conn, id, body.locations);
      return id;
    });
    res.status(201).json({ product_id: productId });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/products/:id  same body as POST, but the child parts are optional:
//   packaged | weighed | counted  -> updates the details, or switches the product to that type
//   locations [...]               -> become the product's stored_at rows
exports.update = async (req, res) => {
  try {
    const body = req.body || {};
    const { sku, name, category, standard_cost, reorder_level } = body;
    if (!sku || !name || !category || standard_cost == null || reorder_level == null) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const { type, error } = checkChildren(body, false);
    if (error) return res.status(400).json({ error });

    const id = req.params.id;
    const found = await pool.transaction(async (conn) => {
      const [rows] = await conn.execute('SELECT 1 FROM product WHERE product_id = ?', [id]);
      if (rows.length === 0) return false;
      await conn.query('CALL p_update_product(?, ?, ?, ?, ?, ?)', [id, ...baseArgs(body)]);
      if (type) await conn.query(TYPES[type].update, [id, ...typeArgs(type, body)]);
      if (body.locations) await syncLocations(conn, id, body.locations);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'product not found' });
    res.json({ message: 'product updated' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/products/:id
// subtype rows cascade; stock and order lines block it (clear locations via PUT first)
exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    const [items] = await pool.execute('SELECT 1 FROM order_item WHERE product_id = ? LIMIT 1', [id]);
    if (items.length > 0) return res.status(409).json({ error: 'product is used in orders' });
    const [stock] = await pool.execute('SELECT 1 FROM stored_at WHERE product_id = ? LIMIT 1', [id]);
    if (stock.length > 0) return res.status(409).json({ error: 'product still has stock' });
    const [rows] = await pool.execute('SELECT 1 FROM product WHERE product_id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'product not found' });
    await pool.query('CALL p_delete_product(?)', [id]);
    res.json({ message: 'product deleted' });
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
