const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');

router.get('/stats', ctrl.getStats);
router.get('/low-stock', ctrl.getLowStock);
router.get('/recent-orders', ctrl.getRecentOrders);

module.exports = router;
