const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/jwt');
const { OAuth2Client } = require('google-auth-library');

// ===============================
// Google OAuth setup
// ===============================
const googleClientIds = (process.env.GOOGLE_CLIENT_IDS || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);

const googleClient = new OAuth2Client();

// ===============================
// REGISTER (login tradicional)
// ===============================
async function register(req, res) {
  const { email, password, full_name } = req.body;

  if (!email || !password || !full_name) {
    return res.status(400).json({ message: 'Datos incompletos' });
  }

  const hash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `
    INSERT INTO users (email, password_hash, full_name, provider)
    VALUES ($1, $2, $3, 'local')
    RETURNING id, email, full_name
    `,
    [email, hash, full_name]
  );

  const user = result.rows[0];
  const token = generateToken(user);

  res.json({ user, token });
}

// ===============================
// LOGIN (email + password)
// ===============================
async function login(req, res) {
  const { email, password } = req.body;

  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const user = result.rows[0];

  // ⚠️ Evita login local si es cuenta Google
  if (user.provider === 'google') {
    return res.status(401).json({
      message: 'Usá Ingresar con Google para esta cuenta',
    });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ message: 'Invalid credentials' });
  }

  const token = generateToken(user);

  res.json({
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
    },
    token,
  });
}

// ===============================
// GOOGLE LOGIN
// ===============================
async function googleLogin(req, res) {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ message: 'idToken requerido' });
  }

  try {
    // ✅ Validar token con Google
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: googleClientIds,
    });

    const payload = ticket.getPayload();

    const email = payload.email;
    const fullName = payload.name || '';
    const googleSub = payload.sub;
    const avatarUrl = payload.picture || null;

    if (!email || !googleSub) {
      return res.status(400).json({ message: 'Token Google inválido' });
    }

    // ✅ Buscar usuario por email
    const existing = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    let user;

    if (existing.rows.length > 0) {
      user = existing.rows[0];

      // ✅ Actualizar datos Google si hacía login local antes
      await pool.query(
        `
        UPDATE users
        SET
          provider = 'google',
          google_sub = COALESCE(google_sub, $1),
          avatar_url = COALESCE(avatar_url, $2)
        WHERE id = $3
        `,
        [googleSub, avatarUrl, user.id]
      );
    } else {
      // ✅ Crear usuario nuevo con Google
      const created = await pool.query(
        `
        INSERT INTO users (email, full_name, provider, google_sub, avatar_url)
        VALUES ($1, $2, 'google', $3, $4)
        RETURNING *
        `,
        [email, fullName, googleSub, avatarUrl]
      );

      user = created.rows[0];
    }

    // ✅ JWT propio
    const token = generateToken(user);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        avatar_url: user.avatar_url,
      },
      token,
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(401).json({ message: 'Google token inválido' });
  }
}

module.exports = {
  register,
  login,
  googleLogin,
};