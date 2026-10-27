'use strict';

const { Pool } = require('pg');

// Connection settings come from the standard PG* environment variables
// (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE) or DATABASE_URL.
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {}
);

pool.on('error', (err) => {
  console.error('[db] unexpected error on idle client:', err.message);
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scores (
  id              SERIAL       PRIMARY KEY,
  player_name     VARCHAR(16)  NOT NULL,
  score           INTEGER      NOT NULL CHECK (score >= 0),
  world           SMALLINT     NOT NULL CHECK (world BETWEEN 1 AND 8),
  levels_cleared  SMALLINT     NOT NULL DEFAULT 0 CHECK (levels_cleared >= 0),
  coins           INTEGER      NOT NULL DEFAULT 0 CHECK (coins >= 0),
  kills           INTEGER      NOT NULL DEFAULT 0 CHECK (kills >= 0),
  outcome         VARCHAR(4)   NOT NULL CHECK (outcome IN ('win', 'lose')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scores_ranking_idx ON scores (score DESC, created_at ASC);
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for PostgreSQL to accept connections, then creates the schema
 * (idempotent: safe to run on every start).
 */
async function init({ retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(SCHEMA);
      console.log('[db] connected, schema ready');
      return;
    } catch (err) {
      console.warn(`[db] not ready (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) throw err;
      await sleep(delayMs);
    }
  }
}

module.exports = { pool, init };
