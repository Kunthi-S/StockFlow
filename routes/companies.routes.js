const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/companies.controller');

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/:id/phones', ctrl.getPhones);
router.post('/:id/phones', ctrl.addPhone);
router.delete('/:id/phones/:phone', ctrl.removePhone);

module.exports = router;
