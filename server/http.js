import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createAuth } from './auth.js';
import { ApiError } from './state.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
async function body(req, limit) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ApiError(415, 'Use an application/json request.');
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw new ApiError(413, 'Request exceeds the supported size.'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'Invalid JSON.'); }
}

export function createAppServer({ database, config, directory = resolve('dist'), now = Date.now, log = code => console.error('Courtside server error:', code) }) {
  const auth = createAuth(config, now), attempts = new Map();
  const response = (res, status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify({ ...data, serverTime: now() })); };
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    try {
      const url = new URL(req.url, config.origin), session = auth.session(req.headers.cookie);
      if (url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== config.origin) throw new ApiError(403, 'This request must come from the app website.');
        if (url.pathname === '/api/config' && req.method === 'GET') return response(res, 200, { storage: 'mysql', authenticated: !!session, role: session?.role || null });
        if (url.pathname === '/api/health' && req.method === 'GET') { await database.health(); return response(res, 200, { ok: true, storage: 'mysql' }); }
        if (url.pathname === '/api/session' && req.method === 'POST') {
          const id = req.socket.remoteAddress || 'local', bucket = attempts.get(id);
          if (bucket && bucket.until > now() && bucket.count >= 10) throw new ApiError(429, 'Too many sign-in attempts. Try again in a minute.');
          const input = await body(req, 4096);
          if (!auth.passwordMatches(input?.password)) {
            if (attempts.size > 10000) for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
            attempts.set(id, { count: bucket?.until > now() ? bucket.count + 1 : 1, until: bucket?.until > now() ? bucket.until : now() + 60000 });
            throw new ApiError(401, 'Incorrect access password.');
          }
          attempts.delete(id); const role = input.role === 'viewer' ? 'viewer' : 'operator';
          return response(res, 200, { authenticated: true, role }, { 'Set-Cookie': auth.issue(role) });
        }
        if (url.pathname === '/api/session' && req.method === 'DELETE') return response(res, 200, { authenticated: false }, { 'Set-Cookie': auth.clear() });
        if (!session) throw new ApiError(401, 'Sign in to access the shared database.');
        if (url.pathname === '/api/state' && req.method === 'GET') {
          const since = url.searchParams.has('since') ? Number(url.searchParams.get('since')) : null;
          if (since !== null && (!Number.isSafeInteger(since) || since < 0)) throw new ApiError(400, 'Invalid database revision.');
          const state = await database.read(since); return response(res, 200, state ? { state } : { unchanged: true });
        }
        if (url.pathname === '/api/state' && req.method === 'PUT') {
          if (session.role !== 'operator') throw new ApiError(403, 'Display access is read-only. Sign in as an operator to save changes.');
          const input = await body(req, 8 * 1024 * 1024); let state;
          try { state = await database.write(input); }
          catch (error) { if (error instanceof ApiError || error.code) throw error; throw new ApiError(400, 'Game or tournament data failed validation.'); }
          return response(res, 200, { state });
        }
        throw new ApiError(404, 'API endpoint not found.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'Method not allowed.');
      const path = decodeURIComponent(url.pathname), file = resolve(directory, path === '/' ? 'index.html' : '.' + path);
      if (!file.startsWith(directory + sep) || path.split('/').some(part => part.startsWith('.'))) throw new ApiError(404, 'File not found.');
      let bytes; try { bytes = await readFile(file); } catch { throw new ApiError(404, 'File not found.'); }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      if (!(error instanceof ApiError)) log(error.code || 'INTERNAL_ERROR');
      response(res, error.status || 503, { error: error instanceof ApiError ? error.message : 'The shared database is unavailable. Saved data has not been replaced.' });
    }
  });
}
