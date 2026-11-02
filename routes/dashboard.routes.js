// routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');

// GET /api/dashboard/stats          -> numbers for the four stat cards
// GET /api/dashboard/low-stock      -> products at or below their reorder level
// GET /api/dashboard/recent-orders  -> the 5 newest orders
router.get('/stats', ctrl.getStats);
router.get('/low-stock', ctrl.getLowStock);
router.get('/recent-orders', ctrl.getRecentOrders);

module.exports = router;
