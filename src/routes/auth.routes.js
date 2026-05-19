const express = require('express');
const router = express.Router();

const {
  register,
  login,
  googleLogin,
} = require('../controllers/auth.controller');

// Login tradicional
router.post('/register', register);
router.post('/login', login);

// Login con Google
router.post('/google', googleLogin);

module.exports = router;