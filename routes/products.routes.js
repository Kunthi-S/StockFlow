// routes/products.routes.js
const express = require('express');
const router = express.Router();
const productController = require('../controllers/products.controller');

router.get('/', productController.getAll);                 // GET    /api/products
router.get('/locations', productController.getLocations);   // GET    /api/products/locations  (before /:id)
router.get('/:id', productController.getById);             // GET    /api/products/:id
router.post('/', productController.create);                // POST   /api/products
router.put('/:id', productController.update);              // PUT    /api/products/:id
router.delete('/:id', productController.remove);           // DELETE /api/products/:id

module.exports = router;
