// server.js - entry point
const path = require('path');
const express = require('express');
const companiesRouter = require('./routes/companies.routes');
const productsRouter = require('./routes/products.routes');
const ordersRouter = require('./routes/orders.routes');
const dashboardRouter = require('./routes/dashboard.routes');

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));   // front-end: http://localhost:3000

app.use('/api/companies', companiesRouter);
app.use('/api/products', productsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/dashboard', dashboardRouter);

app.use((req, res) => res.status(404).json({ error: 'not found' }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`StockFlow server on http://localhost:${PORT}`));
