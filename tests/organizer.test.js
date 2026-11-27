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
