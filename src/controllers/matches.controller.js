const pool = require('../config/db');

/**
 * Validaciones básicas del payload del partido
 */
function validateMatchPayload(body) {
  const errors = [];

  const played_at = body.played_at; // 'YYYY-MM-DD' (opcional)
  const best_of = body.best_of ?? 3;

  const partner_id = body.partner_id;
  const opponent1_id = body.opponent1_id;
  const opponent2_id = body.opponent2_id;

  const sets = Array.isArray(body.sets) ? body.sets : [];

  if (![3, 5].includes(best_of)) errors.push('best_of debe ser 3 o 5.');
  if (!partner_id) errors.push('partner_id es requerido.');
  if (!opponent1_id) errors.push('opponent1_id es requerido.');
  if (!opponent2_id) errors.push('opponent2_id es requerido.');

  if (opponent1_id && opponent2_id && Number(opponent1_id) === Number(opponent2_id)) {
    errors.push('opponent1_id y opponent2_id no pueden ser iguales.');
  }
  if (partner_id && opponent1_id && Number(partner_id) === Number(opponent1_id)) {
    errors.push('partner_id no puede ser igual a opponent1_id.');
  }
  if (partner_id && opponent2_id && Number(partner_id) === Number(opponent2_id)) {
    errors.push('partner_id no puede ser igual a opponent2_id.');
  }

  if (sets.length < 1) errors.push('Debés cargar al menos 1 set.');
  if (sets.length > best_of) errors.push(`No podés cargar más de ${best_of} sets.`);

  // ✅ Validación de sets (SIN límite superior de games)
  const seen = new Set();
  for (const s of sets) {
    const set_number = Number(s.set_number);
    const my_games = Number(s.my_games);
    const their_games = Number(s.their_games);

    if (!Number.isInteger(set_number) || set_number < 1 || set_number > 5) {
      errors.push('set_number inválido (1..5).');
      continue;
    }
    if (seen.has(set_number)) {
      errors.push(`set_number repetido: ${set_number}`);
      continue;
    }
    seen.add(set_number);

    if (!Number.isInteger(my_games) || my_games < 0) {
      errors.push(`my_games inválido en set ${set_number}.`);
    }
    if (!Number.isInteger(their_games) || their_games < 0) {
      errors.push(`their_games inválido en set ${set_number}.`);
    }
    if (my_games === their_games) {
      errors.push(`No puede haber empate en un set (set ${set_number}).`);
    }
  }

  return { errors, played_at, best_of, partner_id, opponent1_id, opponent2_id, sets };
}

/**
 * Calcula si se ganó el partido según sets
 * (gana quien tenga más sets ganados)
 */
function computeIsWin(sets) {
  let mySets = 0;
  let theirSets = 0;
  for (const s of sets) {
    if (Number(s.my_games) > Number(s.their_games)) mySets++;
    else theirSets++;
  }
  return mySets > theirSets;
}

/**
 * Verifica que los player_id enviados pertenezcan al usuario (seguridad)
 */
async function assertPlayersBelongToUser(client, userId, playerIds) {
  const unique = [...new Set(playerIds.map(Number))];

  const { rows } = await client.query(
    `select id
     from players
     where user_id = $1 and id = any($2::bigint[])`,
    [userId, unique]
  );

  if (rows.length !== unique.length) {
    throw new Error('Algún jugador no existe o no pertenece al usuario.');
  }
}

/**
 * CREATE - Crear partido con sets
 * POST /api/matches
 */
async function createMatch(req, res) {
  const userId = req.user.id;

  const { errors, played_at, best_of, partner_id, opponent1_id, opponent2_id, sets } =
    validateMatchPayload(req.body);

  if (errors.length) return res.status(400).json({ message: 'Validation error', errors });

  const is_win = computeIsWin(sets);

  const client = await pool.connect();
  try {
    await client.query('begin');

    await assertPlayersBelongToUser(client, userId, [
      partner_id,
      opponent1_id,
      opponent2_id,
    ]);

    const matchInsert = await client.query(
      `insert into matches (user_id, played_at, best_of, partner_id, opponent1_id, opponent2_id, is_win)
       values ($1, coalesce($2::date, now()::date), $3, $4, $5, $6, $7)
       returning id, user_id, played_at, best_of, partner_id, opponent1_id, opponent2_id, is_win`,
      [userId, played_at ?? null, best_of, partner_id, opponent1_id, opponent2_id, is_win]
    );

    const match = matchInsert.rows[0];

    for (const s of sets) {
      await client.query(
        `insert into match_sets (match_id, set_number, my_games, their_games)
         values ($1, $2, $3, $4)`,
        [match.id, Number(s.set_number), Number(s.my_games), Number(s.their_games)]
      );
    }

    await client.query('commit');

    return res.status(201).json({
      match,
      sets: sets
        .map(s => ({
          set_number: Number(s.set_number),
          my_games: Number(s.my_games),
          their_games: Number(s.their_games),
        }))
        .sort((a, b) => a.set_number - b.set_number),
    });
  } catch (err) {
    await client.query('rollback');
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
}

/**
 * READ - Listar partidos
 */
async function listMatches(req, res) {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      select
        m.id,
        m.played_at,
        m.best_of,
        m.is_win,
        p_partner.first_name as partner_first_name,
        p_partner.last_name  as partner_last_name,
        p_o1.first_name as opp1_first_name,
        p_o1.last_name  as opp1_last_name,
        p_o2.first_name as opp2_first_name,
        p_o2.last_name  as opp2_last_name,
        coalesce(
          json_agg(
            json_build_object(
              'set_number', ms.set_number,
              'my_games', ms.my_games,
              'their_games', ms.their_games
            )
            order by ms.set_number
          ) filter (where ms.id is not null),
          '[]'::json
        ) as sets
      from matches m
      join players p_partner on p_partner.id = m.partner_id
      join players p_o1 on p_o1.id = m.opponent1_id
      join players p_o2 on p_o2.id = m.opponent2_id
      left join match_sets ms on ms.match_id = m.id
      where m.user_id = $1
      group by
        m.id, p_partner.first_name, p_partner.last_name,
        p_o1.first_name, p_o1.last_name,
        p_o2.first_name, p_o2.last_name
      order by m.played_at desc, m.id desc
      `,
      [userId]
    );

    return res.json({ items: rows });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * READ - Obtener partido por ID
 */
async function getMatchById(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);

  try {
    const { rows } = await pool.query(
      `
      select
        m.id,
        m.played_at,
        m.best_of,
        m.is_win,
        m.partner_id,
        m.opponent1_id,
        m.opponent2_id,
        p_partner.first_name as partner_first_name,
        p_partner.last_name  as partner_last_name,
        p_o1.first_name as opp1_first_name,
        p_o1.last_name  as opp1_last_name,
        p_o2.first_name as opp2_first_name,
        p_o2.last_name  as opp2_last_name,
        coalesce(
          json_agg(
            json_build_object(
              'set_number', ms.set_number,
              'my_games', ms.my_games,
              'their_games', ms.their_games
            )
            order by ms.set_number
          ) filter (where ms.id is not null),
          '[]'::json
        ) as sets
      from matches m
      join players p_partner on p_partner.id = m.partner_id
      join players p_o1 on p_o1.id = m.opponent1_id
      join players p_o2 on p_o2.id = m.opponent2_id
      left join match_sets ms on ms.match_id = m.id
      where m.user_id = $1 and m.id = $2
      group by
        m.id, p_partner.first_name, p_partner.last_name,
        p_o1.first_name, p_o1.last_name,
        p_o2.first_name, p_o2.last_name
      `,
      [userId, id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Match not found' });

    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * UPDATE - Editar partido
 */
async function updateMatch(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);

  const { errors, played_at, best_of, partner_id, opponent1_id, opponent2_id, sets } =
    validateMatchPayload(req.body);

  if (errors.length) return res.status(400).json({ message: 'Validation error', errors });

  const is_win = computeIsWin(sets);

  const client = await pool.connect();
  try {
    await client.query('begin');

    const exists = await client.query(
      `select id from matches where id = $1 and user_id = $2`,
      [id, userId]
    );
    if (!exists.rowCount) {
      await client.query('rollback');
      return res.status(404).json({ message: 'Match not found' });
    }

    await assertPlayersBelongToUser(client, userId, [
      partner_id,
      opponent1_id,
      opponent2_id,
    ]);

    const updated = await client.query(
      `
      update matches
      set
        played_at = coalesce($1::date, played_at),
        best_of = $2,
        partner_id = $3,
        opponent1_id = $4,
        opponent2_id = $5,
        is_win = $6,
        updated_at = now()
      where id = $7 and user_id = $8
      returning id, played_at, best_of, partner_id, opponent1_id, opponent2_id, is_win
      `,
      [played_at ?? null, best_of, partner_id, opponent1_id, opponent2_id, is_win, id, userId]
    );

    await client.query(`delete from match_sets where match_id = $1`, [id]);

    for (const s of sets) {
      await client.query(
        `insert into match_sets (match_id, set_number, my_games, their_games)
         values ($1, $2, $3, $4)`,
        [id, Number(s.set_number), Number(s.my_games), Number(s.their_games)]
      );
    }

    await client.query('commit');

    return res.json({
      match: updated.rows[0],
      sets: sets
        .map(s => ({
          set_number: Number(s.set_number),
          my_games: Number(s.my_games),
          their_games: Number(s.their_games),
        }))
        .sort((a, b) => a.set_number - b.set_number),
    });
  } catch (err) {
    await client.query('rollback');
    return res.status(500).json({ message: err.message });
  } finally {
    client.release();
  }
}

/**
 * DELETE - Eliminar partido
 */
async function deleteMatch(req, res) {
  const userId = req.user.id;
  const id = Number(req.params.id);

  try {
    const result = await pool.query(
      `delete from matches
       where id = $1 and user_id = $2
       returning id`,
      [id, userId]
    );

    if (!result.rowCount) return res.status(404).json({ message: 'Match not found' });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
  createMatch,
  listMatches,
  getMatchById,
  updateMatch,
  deleteMatch,
};
