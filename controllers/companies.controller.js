// controllers/companies.controller.js
const pool = require('../db');

// GET /api/companies
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM company ORDER BY company_id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/companies/:id
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM company WHERE company_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'company not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/companies   body: { name, email, street, city, postal_code }
// Uses the stored procedure p_insert_company (Lab 11). Its last argument is an
// OUT parameter, so the CALL and the SELECT @id must run on the same connection.
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
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

// PUT /api/companies/:id   body: { name, email, street, city, postal_code }
// p_update_company signals 45000 'company not found' for an unknown id.
// The last argument (phones) is NULL, so the company's phones are kept.
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
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/companies/:id
// Its phones are removed by ON DELETE CASCADE. A company that still has
// orders cannot be deleted (ON DELETE RESTRICT), so check that first.
exports.remove = async (req, res) => {
  try {
    const [orders] = await pool.execute('SELECT order_id FROM orders WHERE company_id = ?', [req.params.id]);
    if (orders.length > 0) return res.status(409).json({ error: 'company still has orders' });

    const [r] = await pool.execute('DELETE FROM company WHERE company_id = ?', [req.params.id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'company not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/companies/:id/phones
exports.getPhones = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT contact_phone FROM company_phone WHERE company_id = ?', [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/companies/:id/phones   body: { contact_phone }
exports.addPhone = async (req, res) => {
  const { contact_phone } = req.body;
  if (!contact_phone) return res.status(400).json({ error: 'contact_phone is required' });
  try {
    await pool.execute('CALL p_add_company_phone(?, ?)', [req.params.id, contact_phone]);
    res.status(201).json({ ok: true });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') return res.status(404).json({ error: 'company not found' });
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'phone already added' });
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
};
