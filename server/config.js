export function serverConfig(env = process.env) {
  for (const key of ['DB_NAME', 'DB_USER', 'DB_PASSWORD', 'COURTSIDE_ADMIN_PASSWORD', 'APP_ORIGIN']) if (!env[key]) throw new Error(`Missing server environment setting: ${key}`);
  if (env.COURTSIDE_ADMIN_PASSWORD.length < 16) throw new Error('COURTSIDE_ADMIN_PASSWORD must contain at least 16 characters.');
  const origin = new URL(env.APP_ORIGIN).origin, production = env.NODE_ENV === 'production';
  if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN must use HTTPS in production.');
  const host = env.DB_HOST || '127.0.0.1', local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  const ssl = env.DB_SSL === 'true' || !local;
  const port = Number(env.PORT || 3000), dbPort = Number(env.DB_PORT || 3306);
  if (![port, dbPort].every(n => Number.isInteger(n) && n > 0 && n <= 65535)) throw new Error('Invalid server/database port.');
  return { origin, production, port, adminPassword: env.COURTSIDE_ADMIN_PASSWORD, database: {
    host, port: dbPort, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
    ssl: ssl ? { rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replaceAll('\\n', '\n') } : {}) } : undefined,
    connectionLimit: 5, waitForConnections: true, queueLimit: 20, connectTimeout: 10000,
    charset: 'utf8mb4', timezone: 'Z', supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false,
  } };
}
