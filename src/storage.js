import { KEY, initial } from './engine.js';
import { validateState, exportGame } from './game-transfer.js';

// Storage is injected; the engine and transfer format stay independent of the browser.
export function readGame(storage) {
  const raw = storage.getItem(KEY);
  if (raw === null) return initial();
  try { return validateState(JSON.parse(raw)); }
  catch { throw new Error('Saved game cannot be read. Export the stored data before replacing it with a backup.'); }
}
export function writeGame(storage, state, expectedRaw) {
  const gameId = state.gameId || globalThis.crypto?.randomUUID?.() || 'game-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const validated = validateState({ ...state, gameId });
  // Refuse a change before it can make the saved game unreadable or unexportable.
  exportGame(validated, validated.stamp);
  const json = JSON.stringify(validated);
  if (expectedRaw !== undefined && storage.getItem(KEY) !== expectedRaw) throw new Error('The game changed while this action was open. Review it and try again.');
  if (typeof storage.save === 'function') return storage.save(KEY, json, expectedRaw).then(() => { state.gameId = gameId; });
  storage.setItem(KEY, json);
  state.gameId = gameId;
}
