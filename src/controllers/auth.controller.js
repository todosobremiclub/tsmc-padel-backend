const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/jwt');

async function register(req, res) {
  const { email, password, full_name } = req.body;

  const hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `insert into users (email, password_hash, full_name)
     values ($1, $2, $3)
     returning id, email, full_name`,
    [email, hash, full_name]
  );

  const user = result.rows[0];
  const token = generateToken(user);

  res.json({ user, token });
}

async function login(req, res) {
  const { email, password } = req.body;

  const result = await pool.query(
    'select * from users where email = $1',
    [email]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = generateToken(user);

  res.json({
    user: { id: user.id, email: user.email, full_name: user.full_name },
    token,
  });
}

module.exports = { register, login };
