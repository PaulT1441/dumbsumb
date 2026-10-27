'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { pool, init } = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_SCORE = 99999999;           // same cap as the in-game HUD (8 digits)
const NAME_RE = /^[\p{L}\p{N} _.\-]{1,16}$/u;

const app = express();

// The API sits behind two proxies (nginx-proxy -> mario-app nginx). Trust the
// private Docker addresses so req.ip is the real client IP for rate limiting.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');
app.use(express.json({ limit: '2kb' }));

// --- Helpers -----------------------------------------------------------------

function toInt(value, { min, max }) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function validateScore(body) {
  const errors = [];
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!NAME_RE.test(name)) {
    errors.push('name: 1 à 16 caractères (lettres, chiffres, espace, _ . -)');
  }

  const score = toInt(body.score, { min: 0, max: MAX_SCORE });
  const world = toInt(body.world, { min: 1, max: 8 });
  const levels = toInt(body.levels ?? 0, { min: 0, max: 200 });
  const coins = toInt(body.coins ?? 0, { min: 0, max: 100000 });
  const kills = toInt(body.kills ?? 0, { min: 0, max: 100000 });
  const outcome = body.outcome === 'win' || body.outcome === 'lose' ? body.outcome : null;

  if (score === null) errors.push(`score: entier entre 0 et ${MAX_SCORE}`);
  if (world === null) errors.push('world: entier entre 1 et 8');
  if (levels === null) errors.push('levels: entier entre 0 et 200');
  if (coins === null) errors.push('coins: entier positif');
  if (kills === null) errors.push('kills: entier positif');
  if (outcome === null) errors.push("outcome: 'win' ou 'lose'");

  return { errors, value: { name, score, world, levels, coins, kills, outcome } };
}

// --- Routes ------------------------------------------------------------------

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});

// Top N scores (default 10, max 50)
app.get('/api/scores', async (req, res, next) => {
  try {
    const limit = toInt(req.query.limit ?? 10, { min: 1, max: 50 }) ?? 10;
    const { rows } = await pool.query(
      `SELECT id,
              RANK() OVER (ORDER BY score DESC) AS rank,
              player_name AS name, score, world, levels_cleared AS levels,
              coins, kills, outcome, created_at
         FROM scores
        ORDER BY score DESC, created_at ASC
        LIMIT $1`,
      [limit]
    );
    res.json(rows.map((r) => ({ ...r, rank: Number(r.rank) })));
  } catch (err) {
    next(err);
  }
});

// Global stats for the leaderboard header
app.get('/api/stats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int                    AS games,
              COUNT(DISTINCT player_name)::int AS players,
              COALESCE(MAX(score), 0)::int     AS best,
              COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins
         FROM scores`
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

const postLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,                 // 10 submissions per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Trop de scores envoyés, réessayez dans une minute.' },
});

app.post('/api/scores', postLimiter, async (req, res, next) => {
  const { errors, value } = validateScore(req.body || {});
  if (errors.length) {
    return res.status(400).json({ error: 'Données invalides', details: errors });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO scores (player_name, score, world, levels_cleared, coins, kills, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [value.name, value.score, value.world, value.levels, value.coins, value.kills, value.outcome]
    );
    const rank = await pool.query('SELECT COUNT(*)::int + 1 AS rank FROM scores WHERE score > $1', [value.score]);

    res.status(201).json({
      id: rows[0].id,
      rank: rank.rows[0].rank,
      name: value.name,
      score: value.score,
      created_at: rows[0].created_at,
    });
  } catch (err) {
    next(err);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalide' });
  }
  console.error('[api] error:', err.message);
  res.status(500).json({ error: 'Erreur interne' });
});

// --- Startup / shutdown ------------------------------------------------------

let server;

init()
  .then(() => {
    server = app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('[api] cannot reach the database, exiting:', err.message);
    process.exit(1);
  });

function shutdown(signal) {
  console.log(`[api] ${signal} received, shutting down`);
  const done = () => pool.end().finally(() => process.exit(0));
  if (server) server.close(done);
  else done();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
