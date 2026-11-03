const pool = require('../db');
const { fail, like } = require('../utils/http');

// Validated { aisle, rack, level } (the database builds the code), or { error }
function readLocation(body) {
  const aisle = String(body.aisle ?? '').trim().toUpperCase();
  const rack = Number(body.rack), level = Number(body.level);
  if (!aisle || aisle.length > 10) return { error: 'aisle is required (at most 10 characters)' };
  if (!Number.isInteger(rack) || rack < 1 || rack > 99) return { error: 'rack must be a whole number from 1 to 99' };
  if (!Number.isInteger(level) || level < 1 || level > 9) return { error: 'level must be a whole number from 1 to 9' };
  return { aisle, rack, level };
}

// GET /api/locations?q=code - with how many products and units each one holds
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT l.location_id, l.code, l.aisle, l.rack, l.level,
              COUNT(s.product_id) AS products,
              COALESCE(SUM(s.quantity_at_location), 0) + 0e0 AS units,
              GROUP_CONCAT(p.sku ORDER BY p.sku SEPARATOR ', ') AS skus
         FROM location l
         LEFT JOIN stored_at s ON s.location_id = l.location_id
         LEFT JOIN product p ON p.product_id = s.product_id
        WHERE l.code LIKE ?
        GROUP BY l.location_id
        ORDER BY l.code`, [like(req.query.q)]);
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/locations
exports.create = async (req, res) => {
  const loc = readLocation(req.body);
  if (loc.error) return res.status(400).json({ error: loc.error });
  try {
    const [r] = await pool.execute(
      'INSERT INTO location (aisle, rack, level) VALUES (?, ?, ?)', [loc.aisle, loc.rack, loc.level]);
    res.status(201).json({ location_id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'that location already exists' });
    fail(res, err);
  }
};

// PUT /api/locations/:id
exports.update = async (req, res) => {
  const loc = readLocation(req.body);
  if (loc.error) return res.status(400).json({ error: loc.error });
  try {
    const [r] = await pool.execute(
      'UPDATE location SET aisle = ?, rack = ?, level = ? WHERE location_id = ?',
      [loc.aisle, loc.rack, loc.level, req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'location not found' });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'that location already exists' });
    fail(res, err);
  }
};

// DELETE /api/locations/:id - refused while it holds stock
exports.remove = async (req, res) => {
  try {
    const [stock] = await pool.execute('SELECT product_id FROM stored_at WHERE location_id = ?', [req.params.id]);
    if (stock.length > 0) return res.status(409).json({ error: 'location still holds stock' });

    const [r] = await pool.execute('DELETE FROM location WHERE location_id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'location not found' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
};
