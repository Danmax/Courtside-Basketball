import test from 'node:test';
import assert from 'node:assert/strict';
import { initialTournament, saveTeam, saveCoach, deleteCoach, validateTournament } from '../src/tournament.js';
import { exportTournament, importTournament, TOURNAMENT_KEY } from '../src/tournament-storage.js';
import { changeState } from '../server/state.js';

test('coach CRUD persists through validation, backups and shared backend writes', () => {
  const t = initialTournament(); saveTeam(t, null, 'Falcons'); const id = t.teams[0].id;
  saveCoach(t, id, null, ' Alex Rivera ', 'Head coach'); const coach = t.teams[0].coaches[0];
  assert.equal(coach.name, 'Alex Rivera');
  saveCoach(t, id, coach.id, 'Alex Rivera', 'Assistant coach');
  assert.deepEqual(importTournament(exportTournament(t)), validateTournament(t));
  const saved = changeState({ revision: 0, game: null, tournament: null }, { key: TOURNAMENT_KEY, value: t, revision: 0, mutationId: crypto.randomUUID() });
  assert.equal(saved.tournament.teams[0].coaches[0].role, 'Assistant coach');
  assert.throws(() => saveCoach(t, id, null, 'alex rivera'), /already/);
  assert.throws(() => saveCoach(t, id, null, 'Coach', 'Invalid role'), /valid/);
  deleteCoach(t, id, coach.id); assert.equal(t.teams[0].coaches.length, 0);
  assert.throws(() => deleteCoach(t, id, coach.id), /no longer/);
});
test('legacy rosters remain unchanged and malformed coach imports fail validation', () => {
  const t = initialTournament(); saveTeam(t, null, 'Falcons'); assert.deepEqual(validateTournament(t), t);
  t.teams[0].coaches = [{ id: t.teams[0].id, name: 'Coach', role: 'Head coach' }];
  assert.throws(() => validateTournament(t), /duplicate ID/);
  t.teams[0].coaches[0].id = 'coach-2'; t.teams[0].coaches[0].role = 'Invalid';
  assert.throws(() => validateTournament(t), /staff role/);
});

test('player profiles and team logos survive backups, shared saves, match loading and roster reset', async () => {
  const { savePlayer, saveMatch, prepareMatchGame } = await import('../src/tournament.js');
  const { initial, resetGame } = await import('../src/engine.js');
  const { validateState, exportGame, importGame } = await import('../src/game-transfer.js');
  const { tournamentPlayers } = await import('../src/player-stats.js');
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
  const t = initialTournament(); saveTeam(t, null, 'Falcons', image); saveTeam(t, null, 'Bears');
  const profile = { position: 'Guard', heightCm: 183, hometown: 'San Juan', bio: 'Team captain', photo: image };
  for (const team of t.teams) savePlayer(t, team.id, null, 'Jordan', '23', profile);
  assert.deepEqual(importTournament(exportTournament(t)), validateTournament(t));
  const saved = changeState({ revision: 0, game: null, tournament: null }, { key: TOURNAMENT_KEY, value: t, revision: 0, mutationId: crypto.randomUUID() });
  assert.deepEqual(saved.tournament.teams[0].players[0].profile, profile);
  assert.equal(tournamentPlayers(t).rows[0].profile.photo, image);
  saveMatch(t, null, { homeId: t.teams[0].id, awayId: t.teams[1].id, scheduledAt: '', court: '' });
  const game = prepareMatchGame(t, t.matches[0].id, initial());
  assert.equal(validateState(game).teams.A.logo, image);
  assert.equal(importGame(exportGame(game)).teams.A.players[0].profile.photo, image);
  resetGame(game); assert.equal(game.teams.A.logo, image); assert.deepEqual(game.teams.A.players[0].profile, profile);
  game.teams.A.players[0].profile.bio = 'Changed snapshot'; assert.equal(t.teams[0].players[0].profile.bio, 'Team captain');
});
test('profile validation rejects active image formats, mismatched data and invalid fields without mutation', async () => {
  const { validateImage, validateProfile, MAX_IMAGE_CHARS } = await import('../src/profiles.js');
  for (const value of ['https://example.com/avatar.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJj', 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_CHARS)]) assert.throws(() => validateImage(value));
  assert.throws(() => validateProfile({ heightCm: -1 })); assert.throws(() => validateProfile({ bio: 'x'.repeat(501) }));
  const t = initialTournament(); saveTeam(t, null, 'Falcons'); const original = structuredClone(t);
  assert.throws(() => saveTeam(t, t.teams[0].id, 'Renamed', 'invalid')); assert.deepEqual(t, original);
});

test('height accepts feet and inches or centimeters and formats consistently', async () => {
  const { parseHeight, formatHeight, heightInFeet } = await import('../src/profiles.js');
  for (const input of [`6'2"`, '6′2″', '6 ft 2 in', '188 cm', '188']) assert.equal(parseHeight(input), 188);
  assert.equal(parseHeight(`6'`), 183); assert.equal(parseHeight(`5'11"`), 180); assert.equal(parseHeight(''), null);
  assert.equal(formatHeight(188), `6'2" (188 cm)`); assert.equal(heightInFeet(null), '');
  for (const input of [`6'12"`, `6'-2"`, 'six feet', '188.5 cm', '12', '300 cm']) assert.throws(() => parseHeight(input));
});
