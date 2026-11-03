const pool = require('../db');
const { fail, like } = require('../utils/http');

// GET /api/companies?q=name
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM company WHERE name LIKE ? ORDER BY company_id', [like(req.query.q)]);
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/companies/:id
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM company WHERE company_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'company not found' });
    res.json(rows[0]);
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/companies - the OUT @id must be read on the same connection
exports.create = async (req, res) => {
  const { name, email, street, city, postal_code } = req.body;
  if (!name || !email || !street || !city || !postal_code) {
    return res.status(400).json({ error: 'name, email, street, city and postal_code are required' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.query('CALL p_insert_company(?, ?, ?, ?, ?, NULL, @id)', [name, street, city, postal_code, email]);
    const [rows] = await conn.query('SELECT @id AS company_id');
    res.status(201).json(rows[0]);
  } catch (err) {
    fail(res, err);
  } finally {
    conn.release();
  }
};

// PUT /api/companies/:id - phones are kept (NULL)
exports.update = async (req, res) => {
  const { name, email, street, city, postal_code } = req.body;
  if (!name || !email || !street || !city || !postal_code) {
    return res.status(400).json({ error: 'name, email, street, city and postal_code are required' });
  }
  try {
    await pool.execute('CALL p_update_company(?, ?, ?, ?, ?, ?, NULL)',
      [req.params.id, name, street, city, postal_code, email]);
    res.json({ ok: true });
  } catch (err) {
    if (err.sqlState === '45000') return res.status(404).json({ error: err.sqlMessage });
    fail(res, err);
  }
};

// DELETE /api/companies/:id - refused while it has orders
exports.remove = async (req, res) => {
  try {
    const [orders] = await pool.execute('SELECT order_id FROM orders WHERE company_id = ?', [req.params.id]);
    if (orders.length > 0) return res.status(409).json({ error: 'company still has orders' });

    const [r] = await pool.execute('DELETE FROM company WHERE company_id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'company not found' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/companies/:id/phones
exports.getPhones = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT contact_phone FROM company_phone WHERE company_id = ?', [req.params.id]);
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/companies/:id/phones
exports.addPhone = async (req, res) => {
  const { contact_phone } = req.body;
  if (!contact_phone) return res.status(400).json({ error: 'contact_phone is required' });
  try {
    await pool.execute('CALL p_add_company_phone(?, ?)', [req.params.id, contact_phone]);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'company not found' });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'phone already added' });
    fail(res, err);
  }
};

// DELETE /api/companies/:id/phones/:phone
exports.removePhone = async (req, res) => {
  try {
    const [r] = await pool.execute(
      'DELETE FROM company_phone WHERE company_id = ? AND contact_phone = ?',
      [req.params.id, req.params.phone]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'phone not found' });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
};
