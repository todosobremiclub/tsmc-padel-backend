const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth.middleware');
const {
  createPlayer,
  listPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
  listRecentPlayers,
} = require('../controllers/players.controller');

router.use(authMiddleware);

router.get('/recent', listRecentPlayers);

// CRUD
router.post('/', createPlayer);       // CREATE
router.get('/', listPlayers);         // READ (list + search)
router.get('/:id', getPlayerById);    // READ (detail)
router.put('/:id', updatePlayer);     // UPDATE
router.delete('/:id', deletePlayer);  // DELETE

module.exports = router;