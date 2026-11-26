import { fieldGoalValue } from './court-geometry.js';
import { DEFAULT_GAME_RULES, gameRules, validateGameRules, periodLabel } from './game-rules.js';
export const KEY = 'basketball_modular_v1';
const teamKeys = ['A', 'B'];

function player(id, name, number, on = false) {
  return { id, name, number, on, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fls: 0, ms: 0, out: false };
}

export function initial() {
  return {
    ...DEFAULT_GAME_RULES, quarter: 1, game: 600000, shot: 24000,
    running: false, shotRunning: false, stamp: 0, break: null,
    possession: 'A', violation: false, matchLink: null, gameId: null, shots: [],
    teams: Object.fromEntries(teamKeys.map(k => [k, {
      name: k === 'A' ? 'Home' : 'Away', score: 0, fouls: 0, timeouts: 3,
      players: Array.from({ length: 7 }, (_, i) => player(k + i, `Player ${k}${i + 1}`, i + 1, i < 5)),
    }])),
    log: [],
  };
}

export function format(ms, decimal = false) {
  ms = Math.max(0, ms);
  const s = decimal && ms < 60000 ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}${decimal && ms < 60000 ? '.' + String(Math.floor(ms % 1000 / 10)).padStart(2, '0') : ''}`;
}

// Official entry accepts minutes:seconds with optional millisecond precision.
export function parseClock(value) {
  const match = /^(\d{1,3}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(String(value).trim());
  if (!match) return null;
  return (Number(match[1]) * 60 + Number(match[2])) * 1000 + Number((match[3] || '').padEnd(3, '0'));
}

export function note(s, text) { s.log.unshift(`[${periodLabel(s)} – ${format(s.game, true)}] ${text}`); }
export function stop(s) { s.running = false; s.shotRunning = false; }
const unresolvedFoulOut = s => Object.values(s.teams).some(t => t.players.some(p => p.on && p.out));

export function tick(s, now) {
  // A stale timestamp must not move the anchor backwards and count time twice.
  const d = Math.max(0, now - s.stamp);
  s.stamp = Math.max(s.stamp, now);
  if (s.break) {
    stop(s);
    if (now >= s.break.end) { note(s, `${s.break.label} ended`); s.break = null; }
    return;
  }
  const elapsed = Math.min(d, s.running ? s.game : Infinity, s.shotRunning ? s.shot : Infinity);
  if (s.running) {
    s.game -= elapsed;
    for (const t of Object.values(s.teams)) for (const p of t.players) if (p.on && !p.out) p.ms += elapsed;
  }
  if (s.shotRunning) s.shot -= elapsed;
  if (s.game === 0 && s.running) { stop(s); note(s, 'Period ended'); }
  else if (s.shot === 0 && s.shotRunning) {
    stop(s); s.violation = true; note(s, 'Shot clock violation: ' + s.teams[s.possession].name);
  }
}

export function possession(s, k) {
  if (!s.teams[k]) return false;
  s.possession = k; s.shot = s.shotDefault * 1000; s.violation = false; s.shotRunning = s.shotEnabled !== false && s.running;
  return true;
}

export function start(s) {
  if (s.break || s.game <= 0 || unresolvedFoulOut(s)) return false;
  if (s.violation) {
    s.shot = s.shotDefault * 1000; s.violation = false;
    note(s, `Shot clock violation cleared; shot clock reset to ${s.shotDefault}s`);
  }
  s.running = true; s.shotRunning = s.shotEnabled !== false && s.shot > 0;
  return true;
}

export function startShotClock(s) {
  if (s.shotEnabled === false || s.break || s.violation || s.game <= 0 || s.shot <= 0 || unresolvedFoulOut(s)) return false;
  s.shotRunning = true;
  return true;
}
export function stopShotClock(s) { s.shotRunning = false; }

export function setClock(s, clock, ms) {
  if (!['game', 'shot'].includes(clock) || (clock === 'shot' && s.shotEnabled === false) || s.running || s.shotRunning || s.break || !Number.isSafeInteger(ms) || ms < 0) return false;
  s[clock] = ms;
  if (clock === 'shot') s.violation = false;
  note(s, `${clock === 'game' ? 'Game' : 'Shot'} clock set to ${ms / 1000}s`);
  return true;
}

export function resetShotClock(s, ms = s.shotDefault * 1000) {
  if (s.shotEnabled === false || !Number.isSafeInteger(ms) || ms <= 0 || s.break) return false;
  s.shot = ms; s.violation = false;
  note(s, `Shot clock reset to ${ms / 1000}s`);
  return true;
}

export function beginBreak(s, label, seconds, now, k) {
  const duration = seconds * 1000;
  if (typeof label !== 'string' || !label.trim() || typeof seconds !== 'number' || !Number.isSafeInteger(duration) || duration <= 0 || !Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + duration) || s.break || (k && (!s.teams[k] || s.teams[k].timeouts <= 0))) return false;
  stop(s);
  if (k) s.teams[k].timeouts--;
  s.break = { label, end: now + duration }; note(s, label + ' begins');
  return true;
}

export function stat(s, k, id, key, n = 1) {
  const t = s.teams[k], p = t?.players.find(p => p.id === id);
  if (!p || p.out || !p.on || !['pts', 'reb', 'ast', 'stl', 'blk', 'fls'].includes(key) || !Number.isSafeInteger(n) || n <= 0) return false;
  if (!Number.isSafeInteger(p[key] + n) || (key === 'pts' && !Number.isSafeInteger(t.score + n)) || (key === 'fls' && !Number.isSafeInteger(t.fouls + n))) return false;
  p[key] += n; note(s, `${t.name}: #${p.number} ${p.name} +${n} ${key}`);
  if (key === 'pts') { t.score += n; afterScore(s, k); }
  if (key === 'fls') {
    t.fouls += n;
    if (t.fouls >= s.teamLimit && t.fouls - n < s.teamLimit) note(s, t.name + ' reached team foul limit');
    if (p.fls >= s.personalLimit) { p.out = true; stop(s); note(s, p.name + ' fouled out; remove or substitute before restarting'); }
  }
  return true;
}

export function substitute(s, k, outId, inId) {
  const t = s.teams[k], a = t?.players.find(p => p.id === outId), b = t?.players.find(p => p.id === inId);
  if (s.running || s.shotRunning || !a?.on || !b || b.on || b.out) return false;
  a.on = false; b.on = true; note(s, `${a.name} replaced by ${b.name}`);
  return true;
}

export function removeFromCourt(s, k, id) {
  const p = s.teams[k]?.players.find(p => p.id === id);
  if (s.running || s.shotRunning || !p?.on) return false;
  p.on = false; note(s, `${p.name} removed from court`);
  return true;
}

export function putOnCourt(s, k, id) {
  const t = s.teams[k], p = t?.players.find(p => p.id === id);
  if (s.running || s.shotRunning || !p || p.on || p.out || t.players.filter(p => p.on).length >= 5) return false;
  p.on = true; note(s, `${p.name} entered the court`);
  return true;
}

function rosterDetails(t, id, name, number) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) return null;
  const jersey = String(number).trim();
  if (!/^\d{1,2}$/.test(jersey) || t.players.some(p => p.id !== id && String(p.number) === jersey)) return null;
  return { name: name.trim(), number: jersey };
}

export function addPlayer(s, k, name, number) {
  const t = s.teams[k];
  if (!t || s.running || s.shotRunning || t.players.length >= 100) return false;
  const details = rosterDetails(t, null, name, number);
  if (!details) return false;
  let i = 0;
  while (Object.values(s.teams).some(team => team.players.some(p => p.id === k + i))) i++;
  t.players.push(player(k + i, details.name, details.number));
  note(s, `${t.name}: #${details.number} ${details.name} added to roster`);
  return true;
}

export function updatePlayer(s, k, id, name, number) {
  const t = s.teams[k], p = t?.players.find(p => p.id === id);
  if (!p || s.running || s.shotRunning) return false;
  const details = rosterDetails(t, id, name, number);
  if (!details) return false;
  Object.assign(p, details);
  return true;
}

export function renameTeam(s, k, name) {
  if (!s.teams[k] || typeof name !== 'string' || !name.trim() || name.trim().length > 80) return false;
  s.teams[k].name = name.trim();
  return true;
}

export function deletePlayer(s, k, id) {
  const t = s.teams[k], p = t?.players.find(p => p.id === id);
  // Keep players with game history, including every fouled-out player, until reset.
  if (!p || s.running || s.shotRunning || p.on || p.out || (s.shots || []).some(shot => shot.team === k && shot.playerId === id) || ['pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'ms'].some(key => p[key] !== 0)) return false;
  t.players = t.players.filter(p => p.id !== id);
  note(s, `${t.name}: ${p.name} removed from roster`);
  return true;
}

export function resetGame(s) {
  const fresh = initial();
  Object.assign(fresh, gameRules(s));
  fresh.game = fresh.length * 1000; fresh.shot = fresh.shotDefault * 1000;
  for (const k of teamKeys) {
    fresh.teams[k].name = s.teams[k].name;
    fresh.teams[k].timeouts = fresh.timeoutsPerTeam;
    const starters = s.teams[k].players.filter(p => p.on).slice(0, 5).map(p => p.id);
    for (const p of s.teams[k].players) if (starters.length < 5 && !starters.includes(p.id)) starters.push(p.id);
    fresh.teams[k].players = s.teams[k].players.map(p => player(p.id, p.name, p.number, starters.includes(p.id)));
  }
  Object.assign(s, fresh);
}

export function openingGame(s) {
  const rules = gameRules(s);
  return s.quarter === 1 && s.game === s.length * 1000 && s.shot === s.shotDefault * 1000 && !s.violation && !s.break && !s.running && !s.shotRunning && !(s.shots || []).length && Object.values(s.teams).every(t => t.score === 0 && t.fouls === 0 && t.timeouts === rules.timeoutsPerTeam && t.players.every(p => !p.out && ['pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'ms'].every(key => p[key] === 0)));
}

export function applyGameRules(s, input) {
  const rules = validateGameRules(input);
  if (s.running || s.shotRunning || s.break) throw new Error('Stop both clocks and end the break before changing game rules.');
  if (rules.periods < s.quarter || (s.shots || []).some(shot => shot.quarter > rules.periods)) throw new Error('Period count cannot exclude a period already played or recorded.');
  const opening = openingGame(s);
  Object.assign(s, rules);
  if (opening) {
    s.game = rules.length * 1000; s.shot = rules.shotDefault * 1000;
    for (const team of Object.values(s.teams)) team.timeouts = rules.timeoutsPerTeam;
  }
  if (!rules.shotEnabled) s.violation = false;
  for (const team of Object.values(s.teams)) for (const p of team.players) {
    if (!p.out && p.fls >= rules.personalLimit) { p.out = true; note(s, `${p.name} fouled out under the updated foul limit`); }
  }
  note(s, `Game rules updated${opening ? '; opening clocks and timeout balances set' : '; current clocks and timeout balances preserved'}`);
  return true;
}

export function nextPeriod(s) {
  if (s.quarter >= s.periods || s.break) return false;
  const reset = (s.teamFoulReset || 'period') === 'period' || (s.teamFoulReset === 'half' && s.quarter === s.periods / 2);
  stop(s); s.quarter++; s.game = s.length * 1000;
  if (reset) for (const team of Object.values(s.teams)) team.fouls = 0;
  possession(s, s.possession); note(s, `${periodLabel(s)} ready; restart manually`);
  return true;
}

function afterScore(s, k) {
  if (s.stopOnScore) stop(s);
  possession(s, k === 'A' ? 'B' : 'A');
}

export function addTeamScore(s, k, n) {
  const team = s.teams[k];
  if (!team || !Number.isSafeInteger(n) || n === 0 || !Number.isSafeInteger(team.score + n)) return false;
  team.score = Math.max(0, team.score + n);
  if (n > 0) afterScore(s, k);
  note(s, `${team.name} score ${n}`); return true;
}

// Field goals use the same normalized geometry as the displayed three-point line. Value 1 explicitly selects a free throw.
export function recordShot(s, k, playerId, value, made, x, y, now) {
  const team = s.teams[k], p = team?.players.find(p => p.id === playerId);
  if (!p?.on || p.out || s.break || s.violation || ![1, 2, 3].includes(value) || typeof made !== 'boolean' || !Number.isSafeInteger(now) || now < 0) return false;
  if (value === 1 ? (x !== null || y !== null || s.running || s.shotRunning) : ![x, y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  if (value !== 1) value = fieldGoalValue(x, y);
  const shots = s.shots || [];
  if (shots.length >= 5000) return false;
  let n = shots.length + 1; while (shots.some(shot => shot.id === 'shot-' + n)) n++;
  const shot = { id: 'shot-' + n, team: k, playerId, playerName: p.name, playerNumber: String(p.number), value, made, x, y, quarter: s.quarter, gameMs: s.game, timestamp: now, voided: false };
  if (made) {
    if (!Number.isSafeInteger(p.pts + value) || !Number.isSafeInteger(team.score + value)) return false;
    p.pts += value; team.score += value;
    if (value > 1) afterScore(s, k);
  }
  s.shots = [...shots, shot];
  note(s, `${team.name}: #${p.number} ${p.name} ${made ? 'made' : 'missed'} ${value === 1 ? 'free throw' : value + '-point shot'} (${shot.id})`);
  return true;
}
export function voidShot(s, id) {
  const shot = s.shots?.find(shot => shot.id === id);
  if (!shot || shot.voided || s.running || s.shotRunning) return false;
  const team = s.teams[shot.team], p = team?.players.find(p => p.id === shot.playerId);
  if (!p || (shot.made && (p.pts < shot.value || team.score < shot.value))) return false;
  if (shot.made) { p.pts -= shot.value; team.score -= shot.value; }
  shot.voided = true;
  note(s, `Voided ${shot.id}: #${shot.playerNumber} ${shot.playerName}. Clocks and possession unchanged.`);
  return true;
}
