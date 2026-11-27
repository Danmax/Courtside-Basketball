import mysql from 'mysql2/promise';
import { createHash } from 'node:crypto';
import { ApiError, changeState } from './state.js';

// A dedicated additive table; existing application tables are never changed.
export const SCHEMA = `CREATE TABLE IF NOT EXISTS courtside_shared_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  game_state LONGTEXT NULL,
  tournament_state LONGTEXT NULL,
  last_mutation_id VARCHAR(64) NULL,
  last_mutation_hash CHAR(64) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

export function createDatabase(options, factory = mysql.createPool) {
  const pool = factory(options);
  function decode(row) {
    if (!row) throw new Error('Shared state has not been initialized.');
    const revision = Number(row.revision); if (!Number.isSafeInteger(revision)) throw new Error('Invalid database revision.');
    return { revision, game: row.game_state === null ? null : JSON.parse(row.game_state), tournament: row.tournament_state === null ? null : JSON.parse(row.tournament_state), lastMutationId: row.last_mutation_id };
  }
  return {
    async initialize() { await pool.execute(SCHEMA); await pool.execute('INSERT IGNORE INTO courtside_shared_state (id) VALUES (1)'); },
    async health() { await pool.execute('SELECT 1'); },
    async read() { const [rows] = await pool.execute('SELECT * FROM courtside_shared_state WHERE id = 1'); return decode(rows[0]); },
    async write(input) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.execute('SELECT * FROM courtside_shared_state WHERE id = 1 FOR UPDATE');
        const row = rows[0], current = decode(row), hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        if (row.last_mutation_id === input?.mutationId) {
          if (row.last_mutation_hash !== hash) throw new ApiError(409, 'This save identifier was already used for a different change.');
          await connection.commit(); return current;
        }
        const next = changeState(current, input);
        await connection.execute('UPDATE courtside_shared_state SET revision = ?, game_state = ?, tournament_state = ?, last_mutation_id = ?, last_mutation_hash = ? WHERE id = 1', [next.revision, next.game === null ? null : JSON.stringify(next.game), next.tournament === null ? null : JSON.stringify(next.tournament), input.mutationId, hash]);
        await connection.commit(); return { ...next, lastMutationId: input.mutationId };
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
    async close() { await pool.end(); },
  };
}
