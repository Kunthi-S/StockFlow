// routes/dashboard.routes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');

router.get('/stats', dashboardController.getStats);                  // GET /api/dashboard/stats
router.get('/low-stock', dashboardController.getLowStock);           // GET /api/dashboard/low-stock
router.get('/recent-orders', dashboardController.getRecentOrders);   // GET /api/dashboard/recent-orders

module.exports = router;
