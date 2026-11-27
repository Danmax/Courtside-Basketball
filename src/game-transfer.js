import { validateImage, validateProfile } from './profiles.js';
import { initial, tick, stop } from './engine.js';
import { validateGameRules } from './game-rules.js';

export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const FORMAT = 'basketball-scoreboard';
const fail = message => { throw new Error(message); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = value => typeof value === 'string';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Copy only known fields. Never merge arbitrary file properties into live state.
export function validateState(source) {
  if (!object(source)) fail('Missing game state.');
  const result = initial();
  for (const key of ['quarter', 'periods', 'length', 'shotDefault', 'personalLimit', 'teamLimit', 'halftime', 'game', 'shot', 'stamp']) {
    if (!integer(source[key])) fail(`Invalid ${key}.`);
    result[key] = source[key];
  }
  for (const key of ['quarter', 'periods', 'length', 'shotDefault', 'personalLimit', 'teamLimit']) if (result[key] === 0) fail(`Invalid ${key}.`);
  if (result.quarter > result.periods || result.length > 86400 || result.shotDefault > 86400 || result.halftime > 1440) fail('Invalid game settings.');
  // Optional rules use their existing behavior when loading older games/backups.
  Object.assign(result, validateGameRules(source));
  for (const key of ['running', 'shotRunning', 'violation']) {
    if (typeof source[key] !== 'boolean') fail(`Invalid ${key}.`);
    result[key] = source[key];
  }
  if (!['A', 'B'].includes(source.possession)) fail('Invalid possession.');
  result.possession = source.possession;
  if (source.break !== null) {
    if (!object(source.break) || !text(source.break.label) || !integer(source.break.end)) fail('Invalid break.');
    result.break = { label: source.break.label, end: source.break.end };
  }
  if (!object(source.teams)) fail('Missing teams.');
  const ids = new Set();
  for (const k of ['A', 'B']) {
    const t = source.teams[k];
    if (!object(t) || !text(t.name) || !Array.isArray(t.players) || t.players.length > 100) fail('Invalid team or roster (maximum 100 players).');
    const team = { name: t.name, players: [] };
    if (t.logo !== undefined) team.logo = validateImage(t.logo);
    for (const key of ['score', 'fouls', 'timeouts']) {
      if (!integer(t[key])) fail(`Invalid team ${key}.`);
      team[key] = t[key];
    }
    const numbers = new Set();
    for (const p of t.players) {
      if (!object(p) || !text(p.id) || !p.id || ids.has(p.id) || !text(p.name) || !p.name.trim()) fail('Invalid or duplicate player identity.');
      const number = String(p.number);
      if (!/^\d{1,2}$/.test(number) || numbers.has(number)) fail('Invalid or duplicate jersey number.');
      ids.add(p.id); numbers.add(number);
      const copy = { id: p.id, name: p.name, number: p.number };
      if (p.profile !== undefined) copy.profile = validateProfile(p.profile);
      for (const key of ['on', 'out']) {
        if (typeof p[key] !== 'boolean') fail('Invalid player eligibility.');
        copy[key] = p[key];
      }
      for (const key of ['pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'ms']) {
        if (!integer(p[key])) fail(`Invalid player ${key}.`);
        copy[key] = p[key];
      }
      if (copy.fls >= result.personalLimit && !copy.out) fail('A fouled-out player cannot be eligible.');
      team.players.push(copy);
    }
    if (team.players.filter(p => p.on).length > 5) fail('A team cannot have more than five players on court.');
    result.teams[k] = team;
  }
  if (!Array.isArray(source.log) || source.log.length > 10000 || !source.log.every(text)) fail('Invalid play-by-play (maximum 10000 entries).');
  result.log = [...source.log];
  if (source.gameId != null) {
    if (!text(source.gameId) || !/^[a-zA-Z0-9:_-]{1,100}$/.test(source.gameId)) fail('Invalid game identity.');
    result.gameId = source.gameId;
  }
  if (source.shots !== undefined) {
    if (!Array.isArray(source.shots) || source.shots.length > 5000) fail('Invalid shot history (maximum 5000 entries).');
    const shotIds = new Set();
    result.shots = source.shots.map(shot => {
      if (!object(shot) || !text(shot.id) || !shot.id || shot.id.length > 100 || shotIds.has(shot.id)) fail('Invalid or duplicate shot identity.');
      shotIds.add(shot.id);
      if (!['A', 'B'].includes(shot.team) || !result.teams[shot.team].players.some(p => p.id === shot.playerId)) fail('Shot player is missing from its team.');
      if (!text(shot.playerName) || !shot.playerName.trim() || !/^\d{1,2}$/.test(shot.playerNumber)) fail('Invalid shot player details.');
      if (![1, 2, 3].includes(shot.value) || typeof shot.made !== 'boolean' || typeof shot.voided !== 'boolean') fail('Invalid shot outcome.');
      if (shot.value === 1 ? (shot.x !== null || shot.y !== null) : ![shot.x, shot.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) fail('Invalid shot location.');
      if (!integer(shot.quarter) || !shot.quarter || shot.quarter > result.periods || !integer(shot.gameMs) || !integer(shot.timestamp)) fail('Invalid shot time.');
      return Object.fromEntries(['id', 'team', 'playerId', 'playerName', 'playerNumber', 'value', 'made', 'voided', 'x', 'y', 'quarter', 'gameMs', 'timestamp'].map(key => [key, shot[key]]));
    });
  }
  if (source.matchLink != null) {
    const link = source.matchLink;
    if (!object(link) || !['tournamentId', 'matchId', 'homeId', 'awayId'].every(key => typeof link[key] === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(link[key])) || link.homeId === link.awayId) fail('Invalid match link.');
    result.matchLink = Object.fromEntries(['tournamentId', 'matchId', 'homeId', 'awayId'].map(key => [key, link[key]]));
  }
  const moving = result.running || result.shotRunning;
  if (!result.shotEnabled && (result.shotRunning || result.violation)) fail('A disabled shot clock cannot run or have a violation.');
  if (moving && (result.break || result.violation || Object.values(result.teams).some(team => team.players.some(p => p.on && p.out)))) fail('Clocks must be stopped during a break, violation or unresolved foul-out.');
  if (moving && (result.game === 0 || (result.shotRunning && result.shot === 0))) fail('An expired clock cannot be running.');
  return result;
}

export function exportGame(state, now = Date.now()) {
  if (!integer(now)) fail('Invalid backup timestamp.');
  const snapshot = validateState(state);
  tick(snapshot, now);
  stop(snapshot);
  // Projecting a horn can add a journal entry; validate the result as well.
  const json = JSON.stringify({ format: FORMAT, version: 1, exportedAt: now, state: validateState(snapshot) }, null, 2);
  if (new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) fail('Backup exceeds the 2 MB limit.');
  return json;
}

export function importGame(json, now = Date.now()) {
  if (!integer(now)) fail('Invalid restore timestamp.');
  if (!text(json) || new TextEncoder().encode(json).length > MAX_BACKUP_BYTES) fail('Choose a JSON backup smaller than 2 MB.');
  let file;
  try { file = JSON.parse(json); } catch { fail('This file is not valid JSON.'); }
  if (!object(file) || file.format !== FORMAT || file.version !== 1) fail('Unsupported backup format or version. Legacy imports are not supported yet.');
  if (!integer(file.exportedAt)) fail('Invalid backup timestamp.');
  const result = validateState(file.state);
  stop(result);
  result.stamp = now;
  // A standalone game backup must not accidentally publish a tournament result.
  result.matchLink = null;
  result.gameId = null;
  if (result.break) {
    const remaining = Math.max(0, result.break.end - file.exportedAt);
    result.break = remaining ? { label: result.break.label, end: now + remaining } : null;
  }
  return result;
}
