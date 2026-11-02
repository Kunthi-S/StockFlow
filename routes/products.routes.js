// routes/products.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/products.controller');

// GET    /api/products             -> every product (+ is_low from is_low_stock())
// GET    /api/products/locations   -> every location  (must come before /:id)
// GET    /api/products/:id         -> one product with its locations
// POST   /api/products             -> add product + locations in one transaction
// PUT    /api/products/:id         -> edit product, replace its locations
// DELETE /api/products/:id         -> delete (409 if used in orders or still has stock)
router.get('/', ctrl.getAll);
router.get('/locations', ctrl.getLocations);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
