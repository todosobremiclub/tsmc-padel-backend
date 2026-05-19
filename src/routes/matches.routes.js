const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const {
  createMatch,
  listMatches,
  getMatchById,
  updateMatch,
  deleteMatch,
} = require('../controllers/matches.controller');

// Todas las rutas de partidos requieren login
router.use(authMiddleware);

// CRUD
router.post('/', createMatch);        // CREATE
router.get('/', listMatches);         // READ (list)
router.get('/:id', getMatchById);     // READ (detail)
router.put('/:id', updateMatch);      // UPDATE
router.delete('/:id', deleteMatch);   // DELETE

module.exports = router;
