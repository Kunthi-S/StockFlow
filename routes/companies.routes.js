// routes/companies.routes.js
const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companies.controller');

router.get('/', companyController.getAll);                 // GET    /api/companies
router.get('/:id', companyController.getById);             // GET    /api/companies/:id
router.post('/', companyController.create);                // POST   /api/companies
router.put('/:id', companyController.update);              // PUT    /api/companies/:id
router.delete('/:id', companyController.remove);           // DELETE /api/companies/:id
router.get('/:id/phones', companyController.getPhones);    // GET    /api/companies/:id/phones
router.post('/:id/phones', companyController.addPhone);    // POST   /api/companies/:id/phones
router.delete('/:id/phones/:phone', companyController.removePhone);   // DELETE /api/companies/:id/phones/:phone

module.exports = router;
