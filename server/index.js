import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { serverConfig } from './config.js';
import { createDatabase } from './database.js';
import { createAppServer } from './http.js';

async function start() {
  const config = serverConfig(), database = createDatabase(config.database);
  await database.initialize();
  const directory = fileURLToPath(new URL('../dist', import.meta.url));
  const server = createAppServer({ database, config, directory });
  server.listen(config.port, '0.0.0.0', () => console.log(`Courtside server listening on port ${config.port}`));
  let stopping = false;
  const close = () => { if (stopping) return; stopping = true; server.close(async () => { await database.close(); process.exit(0); }); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start().catch(error => {
  console.error(error.code ? `Database startup failed (${error.code}). Check server database settings.` : error.message);
  process.exit(1);
});
