const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/products.controller');

router.get('/', ctrl.getAll);
router.get('/locations', ctrl.getLocations);   // before /:id
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
