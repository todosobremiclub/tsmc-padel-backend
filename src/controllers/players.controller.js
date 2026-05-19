const pool = require('../config/db');

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

function validatePlayerPayload(body) {
  const errors = [];
  const first_name = normalizeName(body.first_name);
  const last_name = normalizeName(body.last_name);

  if (!first_name) errors.push('first_name es requerido.');
  if (!last_name) errors.push('last_name es requerido.');

  if (first_name.length > 60) errors.push('first_name demasiado largo (máx 60).');
  if (last_name.length > 60) errors.push('last_name demasiado largo (máx 60).');

  return { errors, first_name, last_name };
}

function isUniqueViolation(err) {
  // Postgres unique_violation
  return err && err.code === '23505';
}

/**
 * CREATE
 * POST /api/players
 * body: { first_name, last_name }
 */
async function createPlayer(req, res) {
  const userId = req.user.id;

  const { errors, first_name, last_name } = validatePlayerPayload(req.body);
  if (errors.length) return res.status(400).json({ message: 'Validation error', errors });

  try {
    const result = await pool.query(
      `
      insert into players (user_id, first_name, last_name)
      values ($1, $2, $3)
      returning id, first_name, last_name, created_at
      `,
      [userId, first_name, last_name]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        message: 'Ya existe un jugador con ese nombre y apellido.',
      });
    }
    return res.status(500).json({ message: err.message });
  }
}

/**
 * READ LIST + SEARCH
 * GET /api/players?q=juan&limit=50&offset=0
 */
async function listPlayers(req, res) {
  const userId = req.user.id;

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 100;
  const offset = req.query.offset ? Number(req.query.offset) : 0;

  try {
    if (q) {
      // Búsqueda por nombre/apellido (ideal para autocomplete en Flutter)
      const result = await pool.query(
        `
        select id, first_name, last_name, created_at
        from players
        where user_id = $1
          and (first_name || ' ' || last_name) ilike $2
        order by last_name asc, first_name asc
        limit $3 offset $4
        `,
        [userId, `%${q}%`, limit, offset]
      );

      return res.json({ items: result.rows, q, limit, offset });
    }

    // Lista normal
    const result = await pool.query(
      `
      select id, first_name, last_name, created_at
      from players
      where user_id = $1
      order by last_name asc, first_name asc
      limit $2 offset $3
      `,
      [userId, limit, offset]
    );

    return res.json({ items: result.rows, limit, offset });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * READ ONE
 * GET /api/players/:id
 */
async function getPlayerById(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  try {
    const result = await pool.query(
      `
      select id, first_name, last_name, created_at
      from players
      where user_id = $1 and id = $2
      `,
      [userId, id]
    );

    if (!result.rowCount) return res.status(404).json({ message: 'Jugador no encontrado.' });

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * UPDATE
 * PUT /api/players/:id
 * body: { first_name, last_name }
 */
async function updatePlayer(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const { errors, first_name, last_name } = validatePlayerPayload(req.body);
  if (errors.length) return res.status(400).json({ message: 'Validation error', errors });

  try {
    const result = await pool.query(
      `
      update players
      set first_name = $1,
          last_name = $2
      where user_id = $3 and id = $4
      returning id, first_name, last_name, created_at
      `,
      [first_name, last_name, userId, id]
    );

    if (!result.rowCount) return res.status(404).json({ message: 'Jugador no encontrado.' });

    return res.json(result.rows[0]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return res.status(409).json({
        message: 'Ya existe un jugador con ese nombre y apellido.',
      });
    }
    return res.status(500).json({ message: err.message });
  }
}

/**
 * DELETE
 * DELETE /api/players/:id
 *
 * Protección:
 * - Si el jugador está usado en matches (partner/opponent1/opponent2),
 *   devolvemos 409 y no borramos.
 */
async function deletePlayer(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'ID inválido.' });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');

    // Verificar si existe y pertenece al usuario
    const exists = await client.query(
      `select id from players where user_id = $1 and id = $2`,
      [userId, id]
    );
    if (!exists.rowCount) {
      await client.query('rollback');
      return res.status(404).json({ message: 'Jugador no encontrado.' });
    }

    // Chequear referencias en matches
    const used = await client.query(
      `
      select count(*)::int as count
      from matches
      where user_id = $1
        and ($2 in (partner_id, opponent1_id, opponent2_id))
      `,
      [userId, id]
    );

    if (used.rows[0].count > 0) {
      await client.query('rollback');
      return res.status(409).json({
        message: 'No se puede borrar: el jugador ya fue usado en partidos.',
        matches_count: used.rows[0].count,
      });
    }

    // Borrar
    await client.query(
      `delete from players where user_id = $1 and id = $2`,
      [userId, id]
    );

    await client.query('commit');
    return res.status(204).send();
  } catch (err) {
    await client.query('rollback');
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
}

/**
 * RECENT PLAYERS
 * GET /api/players/recent?limit=10
 *
 * Devuelve los jugadores más recientes (compañeros y rivales)
 * según los últimos partidos del usuario.
 */
async function listRecentPlayers(req, res) {
  const userId = req.user.id;
  const limit = req.query.limit
    ? Math.min(Number(req.query.limit), 50)
    : 10;

  try {
    const result = await pool.query(
      `
      with recent_matches as (
        select
          partner_id as player_id,
          played_at
        from matches
        where user_id = $1

        union all

        select
          opponent1_id as player_id,
          played_at
        from matches
        where user_id = $1

        union all

        select
          opponent2_id as player_id,
          played_at
        from matches
        where user_id = $1
      ),
      ranked_players as (
        select
          player_id,
          max(played_at) as last_played_at
        from recent_matches
        group by player_id
      )
      select
        p.id,
        p.first_name,
        p.last_name,
        r.last_played_at
      from ranked_players r
      join players p on p.id = r.player_id
      where p.user_id = $1
      order by r.last_played_at desc
      limit $2
      `,
      [userId, limit]
    );

    return res.json({
      items: result.rows,
      limit,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
  createPlayer,
  listPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
listRecentPlayers,
};
