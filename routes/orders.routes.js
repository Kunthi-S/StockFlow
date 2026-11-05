const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/orders.controller');

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.delete('/:id', ctrl.remove);
router.patch('/:id/status', ctrl.updateStatus);
router.put('/:id/shipment', ctrl.saveShipment);
router.delete('/:id/shipment', ctrl.removeShipment);

module.exports = router;
