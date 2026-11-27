import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

export function createAuth(config, now = Date.now) {
  const key = createHash('sha256').update('courtside-session:' + config.adminPassword).digest();
  const passwordHash = createHash('sha256').update(config.adminPassword).digest();
  const name = config.production ? '__Host-courtside' : 'courtside_session', maxAge = 8 * 60 * 60;
  const sign = value => createHmac('sha256', key).update(value).digest('base64url');
  const cookie = (token, age) => `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.production ? '; Secure' : ''}`;
  return {
    passwordMatches(value) { return typeof value === 'string' && value.length <= 1024 && timingSafeEqual(passwordHash, createHash('sha256').update(value).digest()); },
    issue(role = 'operator') {
      const value = Buffer.from(JSON.stringify({ role, exp: now() + maxAge * 1000 })).toString('base64url');
      return cookie(value + '.' + sign(value), maxAge);
    },
    clear() { return cookie('', 0); },
    session(header = '') {
      try {
        const token = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1);
        if (!token || token.length > 1000) return null;
        const [value, signature, extra] = token.split('.');
        if (extra || !signature || signature.length !== sign(value).length || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(value)))) return null;
        const session = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        return ['operator', 'viewer'].includes(session.role) && Number.isSafeInteger(session.exp) && session.exp > now() ? session : null;
      } catch { return null; }
    },
  };
}
