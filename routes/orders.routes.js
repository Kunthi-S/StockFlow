// routes/orders.routes.js
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orders.controller');

router.get('/', orderController.getAll);                    // GET    /api/orders
router.get('/:id', orderController.getById);                // GET    /api/orders/:id
router.post('/', orderController.create);                   // POST   /api/orders
router.put('/:id', orderController.update);                 // PUT    /api/orders/:id
router.delete('/:id', orderController.remove);              // DELETE /api/orders/:id
router.get('/:id/items', orderController.getItems);         // GET    /api/orders/:id/items
router.post('/:id/items', orderController.addItem);         // POST   /api/orders/:id/items
router.delete('/:id/items/:productId', orderController.removeItem);   // DELETE /api/orders/:id/items/:productId
router.get('/:id/shipment', orderController.getShipment);           // GET    /api/orders/:id/shipment
router.put('/:id/shipment', orderController.saveShipment);          // PUT    /api/orders/:id/shipment
router.delete('/:id/shipment', orderController.removeShipment);     // DELETE /api/orders/:id/shipment

module.exports = router;
