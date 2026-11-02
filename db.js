// db.js - one shared connection pool for the whole app (Lab 6 pattern)
// The login comes from the .env file (Lab 10), not from this file.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,   // DATE/DATETIME come back as '2026-09-06', not shifted to UTC
});

module.exports = pool;
