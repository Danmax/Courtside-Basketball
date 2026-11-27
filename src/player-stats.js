import { emptyShooting, shootingTotals, percentage } from './shooting.js';
// Derived statistics only: no DOM, storage, or changes to game/tournament state.
export const statKeys = ['pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'ms'];
export const performanceKeys = ['pts', 'reb', 'ast', 'stl', 'blk'];
export const participated = (p, shooting = null) => p.ms > 0 || statKeys.some(key => key !== 'ms' && p[key] > 0) || (shooting?.fga || 0) > 0 || (shooting?.fta || 0) > 0;
export const doubleDigits = p => performanceKeys.filter(key => p[key] >= 10);
const zero = () => Object.fromEntries(statKeys.map(key => [key, 0]));
const names = rows => rows.slice(0, 2).map(p => p.name).join(' & ') + (rows.length > 2 ? ` + ${rows.length - 2} more` : '');
const top = (rows, key) => { const max = rows.reduce((max, p) => Math.max(max, p[key]), 0); return max > 0 ? rows.filter(p => p[key] === max) : []; };
const fact = (kind, title, value, text) => ({ kind, title, value, text });

export function gamePlayers(game, matchId = 'current', final = false) {
  return Object.entries(game.teams).flatMap(([slot, team]) => team.players.map(p => {
    const shooting = shootingTotals(game.shots, slot, p.id), appeared = participated(p, shooting);
    return { ...p, shooting, key: JSON.stringify([slot, p.id]), teamId: slot, teamName: team.name,
      gp: appeared ? 1 : 0, status: final ? 'Recorded' : p.out ? 'Fouled out' : p.on ? 'On court' : 'Bench',
      logs: [{ ...Object.fromEntries(statKeys.map(key => [key, p[key]])), shooting, matchId, teamName: team.name,
        opponent: game.teams[slot === 'A' ? 'B' : 'A'].name, final, appeared }],
    };
  }));
}

export function tournamentPlayers(tournament) {
  const rows = new Map();
  const keyFor = (teamId, id) => JSON.stringify([teamId, id]);
  const create = (key, teamId, teamName, p) => {
    const row = { ...zero(), shooting: emptyShooting(), key, id: p.id, name: p.name, number: p.number, teamId, teamName, gp: 0, status: 'Recorded', logs: [] };
    rows.set(key, row); return row;
  };
  const finals = tournament.matches.filter(m => m.status === 'final');
  const recorded = finals.filter(m => m.result.game).sort((a, b) => a.result.finishedAt - b.result.finishedAt || a.id.localeCompare(b.id));
  for (const m of recorded) {
    for (const [slot, teamId] of [['A', m.homeId], ['B', m.awayId]]) {
      const team = m.result.game.teams[slot];
      for (const p of team.players) {
        // Loaded directory players keep their ID even when home/away changes.
        // Ad-hoc game players have no stable directory identity: keep those match-specific.
        const identity = p.id.startsWith(slot + ':') ? ['directory', p.id.slice(2)] : ['match', m.id, slot, p.id];
        const key = keyFor(teamId, identity);
        const row = rows.get(key) || create(key, teamId, team.name, p);
        row.name = p.name; row.number = p.number; row.teamName = team.name; if (p.profile) row.profile = structuredClone(p.profile); row.identityScope = identity[0];
        for (const stat of statKeys) row[stat] += p[stat];
        const shooting = shootingTotals(m.result.game.shots, slot, p.id);
        for (const key of Object.keys(shooting)) row.shooting[key] += shooting[key];
        if (participated(p, shooting)) row.gp++;
        row.logs.push({ ...Object.fromEntries(statKeys.map(key => [key, p[key]])), matchId: m.id, final: true,
          appeared: participated(p, shooting), shooting, teamName: team.name, opponent: m.result.game.teams[slot === 'A' ? 'B' : 'A'].name });
      }
    }
  }
  // Current directory names are preferred; removed players still keep their archived statistics.
  for (const team of tournament.teams) {
    for (const p of team.players) {
      const key = keyFor(team.id, ['directory', p.id]);
      const row = rows.get(key) || create(key, team.id, team.name, p);
      row.name = p.name; row.number = p.number; row.teamName = team.name; if (p.profile) row.profile = structuredClone(p.profile);
    }
  }
  return { rows: [...rows.values()], finals: finals.length, recorded: recorded.length, manual: finals.length - recorded.length };
}

export function rankPlayers(rows, metric = 'pts', average = false) {
  const value = row => average ? (row.gp ? row[metric] / row.gp : -1) : row[metric];
  return [...rows].sort((a, b) => value(b) - value(a) || b.gp - a.gp || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function playerFacts(player) {
  const appearances = player.logs.filter(log => log.appeared);
  if (!appearances.length) return [fact('empty', 'Waiting for a contribution', '—', 'No recorded playing time or stats for this player in this source.')];
  const best = Math.max(...appearances.map(p => p.pts));
  const facts = [];
  if (best > 0) facts.push(fact('best', 'Best recorded scoring game', best, `Highest points in one of ${appearances.length} recorded appearance${appearances.length === 1 ? '' : 's'} in this source.`));
  const doubles = appearances.filter(p => doubleDigits(p).length >= 2).length;
  const triples = appearances.filter(p => doubleDigits(p).length >= 3).length;
  if (doubles) facts.push(fact('double', 'Double-double games', doubles, 'At least 10 in two or more of PTS, REB, AST, STL and BLK in the same game. Includes triple-doubles.'));
  if (triples) facts.push(fact('triple', 'Triple-double games', triples, 'At least 10 in three or more of PTS, REB, AST, STL and BLK in the same game.'));
  const defense = player.stl + player.blk;
  if (defense) facts.push(fact('defense', 'Steals + blocks', defense, `${player.stl} steals and ${player.blk} blocks recorded in this source.`));
  if (player.shooting?.fga) facts.push(fact('shooting', 'Recorded field goals', `${player.shooting.fgm}/${player.shooting.fga}`, `${percentage(player.shooting.fgm, player.shooting.fga)} of explicitly recorded field-goal attempts were made. Point-only scoring is excluded.`));
  else if (player.shooting?.fta) facts.push(fact('shooting', 'Recorded free throws', `${player.shooting.ftm}/${player.shooting.fta}`, `${percentage(player.shooting.ftm, player.shooting.fta)} of explicitly recorded free throws were made.`));
  if (!facts.length) facts.push(fact('appearances', 'Recorded appearances', appearances.length, 'An appearance has recorded playing time or at least one recorded stat.'));
  return facts;
}

export function gameFacts(game, final = false) {
  const a = game.teams.A, b = game.teams.B, margin = Math.abs(a.score - b.score), combined = a.score + b.score;
  const facts = [margin ? fact('margin', final ? 'Final winning margin' : 'Current score gap', margin, `${a.score > b.score ? a.name : b.name} ${final ? 'won' : 'leads'} ${a.score}–${b.score} (home–away).`) : fact('margin', 'Scores level', `${a.score}–${b.score}`, combined ? 'The official team scores are tied.' : 'Waiting for the first recorded score.')];
  const players = gamePlayers(game), scorers = top(players, 'pts');
  if (scorers.length) facts.push(fact('scorer', scorers.length > 1 ? 'Joint scoring leaders' : 'Scoring leader', scorers[0].pts + ' PTS', names(scorers)));
  const doubles = players.filter(p => doubleDigits(p).length >= 2), triples = doubles.filter(p => doubleDigits(p).length >= 3);
  if (triples.length) facts.push(fact('triple', 'Triple-double performances', triples.length, `${names(triples)} ${final ? 'recorded' : triples.length > 1 ? 'have recorded' : 'has recorded'} double digits in at least three stat categories.`));
  else if (doubles.length) facts.push(fact('double', 'Double-digit contributions', doubles.length, `${names(doubles)} reached double digits in at least two stat categories.`));
  const rebounds = Object.values(game.teams).map(t => t.players.reduce((sum, p) => sum + p.reb, 0));
  if (rebounds[0] !== rebounds[1]) facts.push(fact('boards', 'Rebounding advantage', Math.abs(rebounds[0] - rebounds[1]), `${rebounds[0] > rebounds[1] ? a.name : b.name} has more recorded rebounds (${rebounds[0]}–${rebounds[1]}, home–away).`));
  if (combined) facts.push(fact('combined', 'Combined official points', combined, `${a.name} ${a.score} · ${b.name} ${b.score}.`));
  for (const team of [a, b]) {
    const assigned = team.players.reduce((sum, p) => sum + p.pts, 0);
    if (assigned !== team.score) facts.push(fact('reconciliation', 'Score / player points', team.score - assigned, `${team.name}: official score ${team.score}, player points ${assigned}. Unassigned scoring or corrections are not credited to a player.`));
  }
  const shooting = shootingTotals(game.shots);
  if (shooting.fga) facts.push(fact('shooting', 'Recorded field goals', `${shooting.fgm}/${shooting.fga}`, `${percentage(shooting.fgm, shooting.fga)} across both teams. Point-only scoring has no attempt history.`));
  return facts;
}

export function tournamentFacts(tournament) {
  const matches = tournament.matches.filter(m => m.status === 'final');
  if (!matches.length) return [fact('empty', 'The story starts at tip-off', '—', 'Finalize a match to unlock tournament game facts.')];
  const facts = [], margins = matches.map(m => Math.abs(m.result.homeScore - m.result.awayScore));
  const largest = Math.max(...margins), decisive = matches.filter((m, i) => margins[i] === largest);
  facts.push(fact('margin', 'Largest final winning margin', largest, decisive.length === 1 ? `${tournament.teams.find(t => t.id === decisive[0].homeId).name} vs ${tournament.teams.find(t => t.id === decisive[0].awayId).name}.` : `Shared by ${decisive.length} final matches.`));
  const close = margins.filter(m => m <= 5).length;
  facts.push(fact('close', 'Decided by five or fewer', close, `Of ${matches.length} final matches, ${close} finished with a margin of 1–5 points.`));
  const high = Math.max(...matches.map(m => m.result.homeScore + m.result.awayScore));
  facts.push(fact('combined', 'Highest combined final score', high, `Most official points by both teams in a single final match; includes manual results.`));
  const { rows, recorded, manual } = tournamentPlayers(tournament);
  if (recorded) {
    const scorers = top(rows, 'pts');
    if (scorers.length) facts.push(fact('scorer', scorers.length > 1 ? 'Joint recorded points leaders' : 'Recorded points leader', scorers[0].pts + ' PTS', names(scorers)));
  }
  facts.push(fact('coverage', 'Finals with player box scores', `${recorded} / ${matches.length}`, `${manual} manual result${manual === 1 ? '' : 's'} without player stats. Player facts use saved box scores only.`));
  return facts;
}
