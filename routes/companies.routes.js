// routes/companies.routes.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/companies.controller');

// GET    /api/companies                    -> every company
// GET    /api/companies/:id                -> one company
// POST   /api/companies                    -> add   (CALL p_insert_company)
// PUT    /api/companies/:id                -> edit  (CALL p_update_company)
// DELETE /api/companies/:id                -> delete (409 if it still has orders)
// GET    /api/companies/:id/phones         -> its phone numbers
// POST   /api/companies/:id/phones         -> add a phone (CALL p_add_company_phone)
// DELETE /api/companies/:id/phones/:phone  -> remove a phone
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/:id/phones', ctrl.getPhones);
router.post('/:id/phones', ctrl.addPhone);
router.delete('/:id/phones/:phone', ctrl.removePhone);

module.exports = router;
