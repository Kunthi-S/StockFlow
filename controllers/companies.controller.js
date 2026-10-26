// controllers/companies.controller.js
const pool = require('../db');

// GET /api/companies
exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM company ORDER BY company_id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/companies/:id
exports.getById = async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM company WHERE company_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'company not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/companies  { name, email, street, city, postal_code, phones?: ["021234567", ...] }
exports.create = async (req, res) => {
  try {
    const { name, email, street, city, postal_code, phones } = req.body || {};
    if (!name || !email || !street || !city || !postal_code) {
      return res.status(400).json({ error: 'missing fields' });
    }
    if (phones !== undefined && (!Array.isArray(phones) || phones.some((p) => !p))) {
      return res.status(400).json({ error: 'phones must be an array of phone numbers' });
    }
    // @out lives on one connection, so the CALL and the SELECT share one
    const companyId = await pool.transaction(async (conn) => {
      await conn.query('CALL p_insert_company(?, ?, ?, ?, ?, ?, @out)',
        [name, street, city, postal_code, email, phones ? JSON.stringify(phones) : null]);
      const [[{ id }]] = await conn.query('SELECT @out AS id');
      return id;
    });
    res.status(201).json({ company_id: companyId });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// PUT /api/companies/:id  { name, email, street, city, postal_code }
exports.update = async (req, res) => {
  try {
    const { name, email, street, city, postal_code } = req.body || {};
    if (!name || !email || !street || !city || !postal_code) {
      return res.status(400).json({ error: 'missing fields' });
    }
    const [rows] = await pool.execute('SELECT 1 FROM company WHERE company_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'company not found' });
    await pool.query('CALL p_update_company(?, ?, ?, ?, ?, ?)', [req.params.id, name, street, city, postal_code, email]);
    res.json({ message: 'company updated' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/companies/:id  (phones go via ON DELETE CASCADE)
exports.remove = async (req, res) => {
  try {
    const [orders] = await pool.execute('SELECT 1 FROM orders WHERE company_id = ? LIMIT 1', [req.params.id]);
    if (orders.length > 0) return res.status(409).json({ error: 'company still has orders' });
    const [rows] = await pool.execute('SELECT 1 FROM company WHERE company_id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'company not found' });
    await pool.query('CALL p_delete_company(?)', [req.params.id]);
    res.json({ message: 'company deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// GET /api/companies/:id/phones
exports.getPhones = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT contact_phone FROM company_phone WHERE company_id = ?',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// POST /api/companies/:id/phones  { contact_phone }
exports.addPhone = async (req, res) => {
  try {
    const { contact_phone } = req.body || {};
    if (!contact_phone) return res.status(400).json({ error: 'missing fields' });
    await pool.query('CALL p_add_company_phone(?, ?)', [req.params.id, contact_phone]);
    res.status(201).json({ message: 'phone added' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};

// DELETE /api/companies/:id/phones/:phone
exports.removePhone = async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT 1 FROM company_phone WHERE company_id = ? AND contact_phone = ?',
      [req.params.id, req.params.phone]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'phone not found' });
    await pool.query('CALL p_delete_company_phone(?, ?)', [req.params.id, req.params.phone]);
    res.json({ message: 'phone deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message, sql: err.sql });
  }
};
