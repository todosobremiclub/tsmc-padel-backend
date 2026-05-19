const pool = require('../config/db');

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

/**
 * 1) SUMMARY (general / por año / por mes opcional)
 * GET /api/reports/summary?year=2026&month=5
 */
async function getSummary(req, res) {
  const userId = req.user.id;

  const year = toInt(req.query.year);
  const month = toInt(req.query.month);

  const filters = ['user_id = $1'];
  const params = [userId];
  let idx = 2;

  if (year) {
    filters.push(`extract(year from played_at) = $${idx++}`);
    params.push(year);
  }
  if (month) {
    filters.push(`extract(month from played_at) = $${idx++}`);
    params.push(month);
  }

  const where = `where ${filters.join(' and ')}`;

  try {
    const { rows } = await pool.query(
      `
      select
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      ${where}
      `,
      params
    );

    return res.json({
      scope: { year: year ?? null, month: month ?? null },
      ...rows[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * 2) SUMMARY BY YEAR
 * GET /api/reports/by-year
 */
async function getSummaryByYear(req, res) {
  const userId = req.user.id;

  try {
    const { rows } = await pool.query(
      `
      select
        extract(year from played_at)::int as year,
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      where user_id = $1
      group by 1
      order by 1 desc
      `,
      [userId]
    );

    return res.json({ items: rows });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * 3) SUMMARY BY MONTH
 * GET /api/reports/by-month?year=2026
 *
 * Si pasás year, devuelve los meses de ese año.
 * Si NO pasás year, devuelve por mes para todos los años.
 */
async function getSummaryByMonth(req, res) {
  const userId = req.user.id;
  const year = toInt(req.query.year);

  const filters = ['user_id = $1'];
  const params = [userId];
  let idx = 2;

  if (year) {
    filters.push(`extract(year from played_at) = $${idx++}`);
    params.push(year);
  }

  const where = `where ${filters.join(' and ')}`;

  try {
    const { rows } = await pool.query(
      `
      select
        date_trunc('month', played_at)::date as month,
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      ${where}
      group by 1
      order by 1 desc
      `,
      params
    );

    return res.json({ scope: { year: year ?? null }, items: rows });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * 4) VS PLAYER
 * GET /api/reports/vs/player/:playerId?year=2026&month=5&role=opponent|any
 *
 * role:
 * - opponent (default): cuenta solo cuando el jugador fue rival (opponent1/2)
 * - any: cuenta también si fue compañero (partner)
 */
async function getVsPlayer(req, res) {
  const userId = req.user.id;
  const playerId = toInt(req.params.playerId);

  if (!playerId) return res.status(400).json({ message: 'playerId inválido.' });

  const year = toInt(req.query.year);
  const month = toInt(req.query.month);
  const role = (req.query.role || 'opponent').toString();

  const filters = ['user_id = $1'];
  const params = [userId];
  let idx = 2;

  if (role === 'any') {
    filters.push(`($${idx}::bigint in (partner_id, opponent1_id, opponent2_id))`);
  } else {
    filters.push(`($${idx}::bigint in (opponent1_id, opponent2_id))`);
  }

  params.push(playerId);
  idx++;

  if (year) {
    filters.push(`extract(year from played_at) = $${idx++}`);
    params.push(year);
  }
  if (month) {
    filters.push(`extract(month from played_at) = $${idx++}`);
    params.push(month);
  }

  const where = `where ${filters.join(' and ')}`;

  try {
    const { rows } = await pool.query(
      `
      select
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      ${where}
      `,
      params
    );

    return res.json({
      scope: { playerId, role, year: year ?? null, month: month ?? null },
      ...rows[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * 5) VS PAIR (pareja rival)
 * GET /api/reports/vs/pair?opp1=2&opp2=3&year=2026&month=5
 *
 * Nota: contempla ambos órdenes (opp1/opp2 o opp2/opp1)
 */
async function getVsPair(req, res) {
  const userId = req.user.id;
  const opp1 = toInt(req.query.opp1);
  const opp2 = toInt(req.query.opp2);

  if (!opp1 || !opp2) {
    return res.status(400).json({ message: 'opp1 y opp2 son requeridos.' });
  }
  if (opp1 === opp2) {
    return res.status(400).json({ message: 'opp1 y opp2 no pueden ser iguales.' });
  }

  const year = toInt(req.query.year);
  const month = toInt(req.query.month);

  const filters = ['user_id = $1'];
  const params = [userId];
  let idx = 2;

  filters.push(
    `(
      (opponent1_id = $${idx} and opponent2_id = $${idx + 1})
      or
      (opponent1_id = $${idx + 1} and opponent2_id = $${idx})
    )`
  );
  params.push(opp1, opp2);
  idx += 2;

  if (year) {
    filters.push(`extract(year from played_at) = $${idx++}`);
    params.push(year);
  }
  if (month) {
    filters.push(`extract(month from played_at) = $${idx++}`);
    params.push(month);
  }

  const where = `where ${filters.join(' and ')}`;

  try {
    const { rows } = await pool.query(
      `
      select
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      ${where}
      `,
      params
    );

    return res.json({
      scope: { opp1, opp2, year: year ?? null, month: month ?? null },
      ...rows[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * 6) WITH PARTNER
 * GET /api/reports/with-partner/:partnerId?year=2026&month=5
 */
async function getWithPartner(req, res) {
  const userId = req.user.id;
  const partnerId = toInt(req.params.partnerId);

  if (!partnerId) return res.status(400).json({ message: 'partnerId inválido.' });

  const year = toInt(req.query.year);
  const month = toInt(req.query.month);

  const filters = ['user_id = $1', `partner_id = $2`];
  const params = [userId, partnerId];
  let idx = 3;

  if (year) {
    filters.push(`extract(year from played_at) = $${idx++}`);
    params.push(year);
  }
  if (month) {
    filters.push(`extract(month from played_at) = $${idx++}`);
    params.push(month);
  }

  const where = `where ${filters.join(' and ')}`;

  try {
    const { rows } = await pool.query(
      `
      select
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      ${where}
      `,
      params
    );

    return res.json({
      scope: { partnerId, year: year ?? null, month: month ?? null },
      ...rows[0],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * DASHBOARD
 * GET /api/reports/dashboard?year=2026&monthsBack=12&top=8&recent=10
 */
async function getDashboard(req, res) {
  const userId = req.user.id;

  const now = new Date();
  const currentYear = now.getFullYear();

  const year = toInt(req.query.year, currentYear);
  const monthsBack = Math.min(toInt(req.query.monthsBack, 12), 36);
  const top = Math.min(toInt(req.query.top, 8), 25);
  const recent = Math.min(toInt(req.query.recent, 10), 30);

  try {
    const qSummary = pool.query(
      `
      select
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      where user_id = $1
      `,
      [userId]
    );

    const qSummaryYear = pool.query(
      `
      select
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      where user_id = $1
        and extract(year from played_at) = $2
      `,
      [userId, year]
    );

    const qLastMonths = pool.query(
      `
      select
        date_trunc('month', played_at)::date as month,
        count(*)::int as pj,
        sum(case when is_win then 1 else 0 end)::int as pg,
        sum(case when not is_win then 1 else 0 end)::int as pp
      from matches
      where user_id = $1
        and played_at >= (date_trunc('month', current_date) - (($2::int - 1) * interval '1 month'))
      group by 1
      order by 1 desc
      `,
      [userId, monthsBack]
    );

    const qTopOpponents = pool.query(
      `
      with opp as (
        select opponent1_id as player_id, played_at, is_win
        from matches
        where user_id = $1
        union all
        select opponent2_id as player_id, played_at, is_win
        from matches
        where user_id = $1
      ),
      agg as (
        select
          player_id,
          count(*)::int as pj,
          sum(case when is_win then 1 else 0 end)::int as pg,
          sum(case when not is_win then 1 else 0 end)::int as pp,
          max(played_at) as last_played_at
        from opp
        group by player_id
      )
      select
        a.player_id as id,
        p.first_name,
        p.last_name,
        a.pj,
        a.pg,
        a.pp,
        a.last_played_at
      from agg a
      join players p on p.id = a.player_id
      where p.user_id = $1
      order by a.pj desc, a.last_played_at desc
      limit $2
      `,
      [userId, top]
    );

    const qTopPartners = pool.query(
      `
      with agg as (
        select
          partner_id as player_id,
          count(*)::int as pj,
          sum(case when is_win then 1 else 0 end)::int as pg,
          sum(case when not is_win then 1 else 0 end)::int as pp,
          max(played_at) as last_played_at
        from matches
        where user_id = $1
        group by partner_id
      )
      select
        a.player_id as id,
        p.first_name,
        p.last_name,
        a.pj,
        a.pg,
        a.pp,
        a.last_played_at
      from agg a
      join players p on p.id = a.player_id
      where p.user_id = $1
      order by a.pj desc, a.last_played_at desc
      limit $2
      `,
      [userId, top]
    );

    const qRecentMatches = pool.query(
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
      limit $2
      `,
      [userId, recent]
    );

    const [
      summary,
      summaryYear,
      lastMonths,
      topOpponents,
      topPartners,
      recentMatches,
    ] = await Promise.all([
      qSummary,
      qSummaryYear,
      qLastMonths,
      qTopOpponents,
      qTopPartners,
      qRecentMatches,
    ]);

    return res.json({
      generated_at: new Date().toISOString(),
      params: { year, monthsBack, top, recent },

      summary: summary.rows[0],
      summary_year: { year, ...summaryYear.rows[0] },

      last_months: lastMonths.rows,
      top_opponents: topOpponents.rows,
      top_partners: topPartners.rows,
      recent_matches: recentMatches.rows,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

module.exports = {
  getDashboard,
  getSummary,
  getSummaryByYear,
  getSummaryByMonth,
  getVsPlayer,
  getVsPair,
  getWithPartner,
};