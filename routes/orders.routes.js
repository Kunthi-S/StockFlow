// routes/orders.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/orders.controller');

// GET    /api/orders       -> every order, newest first (+ shipment tracking)
// GET    /api/orders/:id   -> one order with its items and shipment
// POST   /api/orders       -> new order + items in one transaction
//        body: { "company_id": 1, "direction": "OUT", "items": [{ "product_id": 1, "quantity": 2, "unit_price": 10 }] }
// DELETE /api/orders/:id   -> delete (409 if it already has a shipment)
// PATCH  /api/orders/:id/status    -> change status   body: { "status": "CONFIRMED" }
//        IN orders add their items to stock when RECEIVED, OUT orders take them out when SHIPPED
// PUT    /api/orders/:id/shipment  -> add or edit its shipment
//        body: { "tracking_number", "freight_date", "expected_date", "actual_date", "destination_address" }
// DELETE /api/orders/:id/shipment  -> remove its shipment
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);
router.patch('/:id/status', ctrl.updateStatus);
router.put('/:id/shipment', ctrl.saveShipment);
router.delete('/:id/shipment', ctrl.removeShipment);

module.exports = router;
