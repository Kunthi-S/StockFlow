const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const { fail } = require('./utils/http');
const companiesRouter = require('./routes/companies.routes');
const productsRouter = require('./routes/products.routes');
const locationsRouter = require('./routes/locations.routes');
const ordersRouter = require('./routes/orders.routes');
const dashboardRouter = require('./routes/dashboard.routes');

// READ_ONLY=true: for workers who may only look (with the stockflow_readonly account)
const READ_ONLY = process.env.READ_ONLY === 'true';

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));   // front-end: http://localhost:3000

// Lets the page hide its edit buttons
app.get('/api/config', (req, res) => res.json({ readOnly: READ_ONLY }));

// Read-only: refuse every change before it reaches MySQL
app.use('/api', (req, res, next) => {
  if (READ_ONLY && req.method !== 'GET') {
    return res.status(403).json({ error: 'View-only access: you cannot change data.' });
  }
  next();
});

app.use('/api/companies', companiesRouter);
app.use('/api/products', productsRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/dashboard', dashboardRouter);

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// Uncaught errors, e.g. a bad JSON body
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  fail(res, err);
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`StockFlow server on http://localhost:${PORT}${READ_ONLY ? ' (read-only)' : ''}`));
