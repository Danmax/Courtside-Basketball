import { KEY } from '../src/engine.js';
import { validateState, exportGame } from '../src/game-transfer.js';
import { TOURNAMENT_KEY, exportTournament } from '../src/tournament-storage.js';
import { validateTournament } from '../src/tournament.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function validGame(value) {
  if (!value) throw new ApiError(400, 'Missing game data.');
  const game = validateState(value); exportGame(game, game.stamp);
  if (!game.gameId) throw new ApiError(400, 'A shared game requires a game identity.');
  return game;
}
export function validTournament(value) { const t = validateTournament(value); exportTournament(t); return t; }
export function preserveEligibility(before, after) {
  if (!before || before.gameId !== after.gameId) return;
  for (const key of ['A', 'B']) for (const player of before.teams[key].players.filter(p => p.out)) {
    const next = after.teams[key].players.find(p => p.id === player.id);
    if (!next || !next.out || (!player.on && next.on)) throw new ApiError(409, 'A fouled-out player cannot return to this game.');
  }
}
export function validateLinkedGame(game, tournament) {
  if (!game?.matchLink) return;
  const link = game.matchLink, match = tournament?.matches.find(m => m.id === link.matchId);
  if (tournament?.id !== link.tournamentId || !match || match.homeId !== link.homeId || match.awayId !== link.awayId || match.status === 'cancelled') throw new ApiError(409, 'The linked tournament match changed. Review the shared game and schedule.');
}
export function changeState(current, input) {
  if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0 || typeof input.mutationId !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(input.mutationId)) throw new ApiError(400, 'Invalid shared-state request.');
  if (input.revision !== current.revision) throw new ApiError(409, 'Shared data changed on another device. Review the latest state and try again.');
  const next = { ...current };
  if (input.operation === 'migrate') {
    if (current.game !== null || current.tournament !== null) throw new ApiError(409, 'The database already has shared data. Browser data was preserved.');
    next.game = input.game == null ? null : validGame(input.game);
    next.tournament = input.tournament == null ? null : validTournament(input.tournament);
    if (!next.game && !next.tournament) throw new ApiError(400, 'There is no browser data to copy.');
    if (next.game && (next.game.running || next.game.shotRunning)) throw new ApiError(400, 'Copied browser clocks must be stopped.');
  } else if (input.key === KEY) {
    next.game = validGame(input.value); preserveEligibility(current.game, next.game);
  } else if (input.key === TOURNAMENT_KEY) {
    next.tournament = validTournament(input.value);
    const link = current.game?.matchLink;
    if (link && current.tournament) {
      const oldMatch = current.tournament.matches.find(m => m.id === link.matchId), newMatch = next.tournament.matches.find(m => m.id === link.matchId);
      if (oldMatch?.status === 'final' && newMatch?.status !== 'final') throw new ApiError(409, 'Reset or replace the linked game before reopening its result.');
    }
  } else throw new ApiError(400, 'Unknown shared data key.');
  validateLinkedGame(next.game, next.tournament);
  next.revision++; return next;
}
