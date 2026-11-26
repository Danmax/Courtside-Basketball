import { initial, resetGame } from './engine.js';
import { validateState } from './game-transfer.js';

const require = (condition, message) => { if (!condition) throw new Error(message); };
const integer = n => Number.isSafeInteger(n) && n >= 0;
const nameValue = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 80;
const idValue = value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value);
const allocate = (t, prefix) => {
  const ids = new Set([...t.teams, ...t.teams.flatMap(team => team.players), ...t.matches].map(item => item.id));
  let id;
  do { id = prefix + t.nextId++; } while (ids.has(id));
  return id;
};
export function initialTournament() { return { id: 'local-tournament', name: 'My tournament', nextId: 1, teams: [], matches: [] }; }
export function teamById(t, id) { const team = t.teams.find(team => team.id === id); require(team, 'Team no longer exists.'); return team; }
export function matchById(t, id) { const match = t.matches.find(match => match.id === id); require(match, 'Match no longer exists.'); return match; }
export function saveTeam(t, id, name) {
  require(nameValue(name), 'Enter a team name (1–80 characters).');
  require(!t.teams.some(team => team.id !== id && team.name.toLowerCase() === name.trim().toLowerCase()), 'Team names must be unique.');
  if (id) teamById(t, id).name = name.trim();
  else { require(t.teams.length < 64, 'Maximum 64 teams.'); t.teams.push({ id: allocate(t, 'team-'), name: name.trim(), players: [] }); }
}
export function deleteTeam(t, id) {
  teamById(t, id);
  require(!t.matches.some(m => m.homeId === id || m.awayId === id), 'Remove this team’s matches before deleting the team.');
  t.teams = t.teams.filter(team => team.id !== id);
}
export function savePlayer(t, teamId, id, name, number) {
  const team = teamById(t, teamId), jersey = String(number).trim();
  require(nameValue(name), 'Enter a player name (1–80 characters).');
  require(/^\d{1,2}$/.test(jersey), 'Use a jersey number from 0–99 (00 is accepted).');
  require(!team.players.some(p => p.id !== id && String(p.number) === jersey), 'Jersey numbers must be unique within a team.');
  if (id) {
    const p = team.players.find(p => p.id === id); require(p, 'Player no longer exists.'); Object.assign(p, { name: name.trim(), number: jersey });
  } else {
    require(team.players.length < 100, 'Maximum 100 players per team.');
    team.players.push({ id: allocate(t, 'player-'), name: name.trim(), number: jersey });
  }
}
export function deletePlayer(t, teamId, id) {
  const team = teamById(t, teamId); require(team.players.some(p => p.id === id), 'Player no longer exists.');
  team.players = team.players.filter(p => p.id !== id);
}
function matchDetails(t, data) {
  teamById(t, data.homeId); teamById(t, data.awayId);
  require(data.homeId !== data.awayId, 'Choose two different teams.');
  require(typeof data.scheduledAt === 'string' && (!data.scheduledAt || (Number.isFinite(Date.parse(data.scheduledAt)) && /Z$/.test(data.scheduledAt))), 'Invalid scheduled date/time.');
  require(typeof data.court === 'string' && data.court.trim().length <= 80, 'Court must be 80 characters or fewer.');
  return { homeId: data.homeId, awayId: data.awayId, scheduledAt: data.scheduledAt, court: data.court.trim() };
}
export function saveMatch(t, id, data) {
  const details = matchDetails(t, data);
  if (id) { const match = matchById(t, id); require(match.status === 'scheduled', 'Only scheduled matches can be edited.'); Object.assign(match, details); }
  else { require(t.matches.length < 500, 'Maximum 500 matches.'); t.matches.push({ id: allocate(t, 'match-'), ...details, status: 'scheduled', result: null }); }
}
export function deleteMatch(t, id) {
  require(matchById(t, id).status !== 'final', 'Reopen a final result before deleting its match.');
  t.matches = t.matches.filter(m => m.id !== id);
}
export function setMatchStatus(t, id, status) {
  require(['scheduled', 'cancelled'].includes(status), 'Invalid match status.');
  Object.assign(matchById(t, id), { status, result: null });
}
export function recordResult(t, id, homeScore, awayScore, now, game = null) {
  const match = matchById(t, id);
  require(match.status !== 'cancelled', 'Restore the cancelled match before recording a result.');
  require(integer(homeScore) && integer(awayScore) && homeScore <= 1000000 && awayScore <= 1000000 && homeScore !== awayScore, 'Final scores must be whole numbers from 0–1,000,000 with a winner. Tied games stay scheduled.');
  require(integer(now), 'Invalid result timestamp.');
  const snapshot = game ? validateState(game) : null;
  if (snapshot) {
    const link = snapshot.matchLink;
    require(link && link.tournamentId === t.id && link.matchId === id && link.homeId === match.homeId && link.awayId === match.awayId, 'The game desk is linked to a different match.');
    require(!snapshot.running && !snapshot.shotRunning && !snapshot.break, 'Stop both clocks and end the break before recording the result.');
    require(snapshot.teams.A.score === homeScore && snapshot.teams.B.score === awayScore, 'The game desk scores have changed. Review the result again.');
  }
  match.status = 'final'; match.result = { homeScore, awayScore, finishedAt: now, game: snapshot };
}
export function standings(t) {
  const rows = t.teams.map(team => ({ id: team.id, name: team.name, played: 0, wins: 0, losses: 0, pf: 0, pa: 0, diff: 0, pct: 0 }));
  for (const match of t.matches.filter(m => m.status === 'final')) {
    for (const [id, pf, pa] of [[match.homeId, match.result.homeScore, match.result.awayScore], [match.awayId, match.result.awayScore, match.result.homeScore]]) {
      const row = rows.find(row => row.id === id); row.played++; row.pf += pf; row.pa += pa;
      if (pf > pa) row.wins++; else row.losses++;
    }
  }
  for (const row of rows) { row.diff = row.pf - row.pa; row.pct = row.played ? row.wins / row.played : 0; }
  rows.sort((a, b) => b.pct - a.pct || b.diff - a.diff || b.pf - a.pf || a.name.localeCompare(b.name));
  rows.forEach((row, i) => { const previous = rows[i - 1]; row.rank = previous && row.pct === previous.pct && row.diff === previous.diff && row.pf === previous.pf ? previous.rank : i + 1; });
  return rows;
}
export function prepareMatchGame(t, id, current) {
  const match = matchById(t, id);
  require(match.status === 'scheduled', 'Only scheduled matches can be loaded.');
  require(!current.running && !current.shotRunning && !current.break, 'Stop both clocks and end the break before loading a match.');
  if (current.matchLink) {
    const linked = t.matches.find(m => m.id === current.matchLink.matchId);
    require(current.matchLink.tournamentId === t.id && linked?.status === 'final', 'A match is already on the game desk. Open it to continue, record its result, or explicitly reset the game before loading another.');
  }
  const game = structuredClone(current); resetGame(game);
  for (const [k, teamId] of [['A', match.homeId], ['B', match.awayId]]) {
    const team = teamById(t, teamId); require(team.players.length > 0, `${team.name} needs at least one player before loading.`);
    game.teams[k].name = team.name;
    game.teams[k].players = team.players.map((p, i) => ({ ...initial().teams[k].players[0], id: k + ':' + p.id, name: p.name, number: p.number, on: i < 5 }));
  }
  game.matchLink = { tournamentId: t.id, matchId: match.id, homeId: match.homeId, awayId: match.awayId };
  return game;
}

export function validateTournament(source) {
  require(source && typeof source === 'object' && !Array.isArray(source), 'Invalid tournament.');
  require(idValue(source.id) && nameValue(source.name) && integer(source.nextId) && source.nextId > 0 && source.nextId < Number.MAX_SAFE_INTEGER - 1000, 'Invalid tournament identity.');
  require(Array.isArray(source.teams) && source.teams.length <= 64 && Array.isArray(source.matches) && source.matches.length <= 500, 'Tournament exceeds team or match limits.');
  const t = { id: source.id, name: source.name.trim(), nextId: source.nextId, teams: [], matches: [] }, ids = new Set();
  const checkId = id => { require(idValue(id) && !ids.has(id), 'Invalid or duplicate ID.'); ids.add(id); };
  for (const team of source.teams) {
    require(team && typeof team === 'object', 'Invalid team.'); checkId(team.id);
    require(nameValue(team.name) && !t.teams.some(q => q.name.toLowerCase() === team.name.trim().toLowerCase()), 'Invalid or duplicate team name.');
    require(Array.isArray(team.players) && team.players.length <= 100, 'Invalid roster.');
    const copy = { id: team.id, name: team.name.trim(), players: [] };
    for (const p of team.players) {
      require(p && nameValue(p.name), 'Invalid player.'); checkId(p.id);
      require(/^\d{1,2}$/.test(String(p.number)) && !copy.players.some(q => q.number === String(p.number)), 'Invalid or duplicate jersey number.');
      copy.players.push({ id: p.id, name: p.name.trim(), number: String(p.number) });
    }
    t.teams.push(copy);
  }
  for (const m of source.matches) {
    require(m && typeof m === 'object', 'Invalid match.'); checkId(m.id);
    const match = { id: m.id, ...matchDetails(t, m), status: 'scheduled', result: null }; t.matches.push(match);
    require(['scheduled', 'cancelled', 'final'].includes(m.status), 'Invalid match status.');
    if (m.status === 'final') {
      require(m.result && typeof m.result === 'object' && (m.result.game === null || typeof m.result.game === 'object'), 'Missing final result.');
      recordResult(t, m.id, m.result.homeScore, m.result.awayScore, m.result.finishedAt, m.result.game);
    } else { require(m.result === null, 'Unfinalized matches cannot have results.'); match.status = m.status; }
  }
  return t;
}
