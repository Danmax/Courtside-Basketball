import { initialTournament, validateTournament } from './tournament.js';
export const TOURNAMENT_KEY = 'basketball_tournament_v1';
export const MAX_TOURNAMENT_BYTES = 4 * 1024 * 1024;
export function readTournament(storage) {
  const raw = storage.getItem(TOURNAMENT_KEY);
  if (raw === null) return initialTournament();
  try { return validateTournament(JSON.parse(raw)); }
  catch { throw new Error('Tournament data cannot be read. Export stored tournament data for recovery before importing a backup.'); }
}
export function writeTournament(storage, data, expectedRaw) {
  const validated = validateTournament(data);
  // A state must remain exportable before it can become the saved tournament.
  exportTournament(validated);
  const json = JSON.stringify(validated);
  if (new TextEncoder().encode(json).length > MAX_TOURNAMENT_BYTES) throw new Error('Tournament exceeds the 4 MB backup limit. Export data and reduce the number of matches.');
  if (expectedRaw !== undefined && storage.getItem(TOURNAMENT_KEY) !== expectedRaw) throw new Error('The tournament changed while this action was open. Close and review it again.');
  if (typeof storage.save === 'function') return storage.save(TOURNAMENT_KEY, json, expectedRaw);
  storage.setItem(TOURNAMENT_KEY, json);
}
export function exportTournament(data) {
  const json = JSON.stringify({ format: 'courtside-tournament', version: 1, tournament: validateTournament(data) }, null, 2);
  if (new TextEncoder().encode(json).length > MAX_TOURNAMENT_BYTES) throw new Error('Tournament backup exceeds 4 MB.');
  return json;
}
export function importTournament(json) {
  if (typeof json !== 'string' || new TextEncoder().encode(json).length > MAX_TOURNAMENT_BYTES) throw new Error('Choose a tournament JSON backup smaller than 4 MB.');
  let file;
  try { file = JSON.parse(json); } catch { throw new Error('This file is not valid JSON.'); }
  if (file?.format !== 'courtside-tournament' || file.version !== 1) throw new Error('Unsupported tournament backup format or version.');
  return validateTournament(file.tournament);
}
