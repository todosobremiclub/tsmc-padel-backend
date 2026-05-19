const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const {
  getDashboard,
  getSummary,
  getSummaryByYear,
  getSummaryByMonth,
  getVsPlayer,
  getVsPair,
  getWithPartner,
} = require('../controllers/reports.controller');

router.use(authMiddleware);

router.get('/dashboard', getDashboard);

/**
 * Reportes generales
 */
router.get('/summary', getSummary);            // PJ/PG/PP (general o filtrado)
router.get('/by-year', getSummaryByYear);      // PJ/PG/PP agrupado por año
router.get('/by-month', getSummaryByMonth);    // PJ/PG/PP agrupado por mes (con filtro de año opcional)

/**
 * Reportes "VS"
 */
router.get('/vs/player/:playerId', getVsPlayer);     // vs persona
router.get('/vs/pair', getVsPair);                   // vs pareja rival (opp1 + opp2)
router.get('/with-partner/:partnerId', getWithPartner); // con compañero



module.exports = router;