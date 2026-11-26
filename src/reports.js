import { shootingTotals, shootingValues, percentage } from './shooting.js';
import { node, minutes, heading, identity } from './ui.js';

export const columns = [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['fls', 'PF'], ['ms', 'MIN']];
export function totals(team) {
  return Object.fromEntries(columns.map(([key]) => [key, team.players.reduce((sum, p) => sum + p[key], 0)]));
}
export function leaders(state, key = 'pts') {
  return Object.entries(state.teams).flatMap(([team, t]) => t.players.map(p => ({ ...p, team, teamName: t.name })))
    .sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).slice(0, 5);
}
export function csvReport(state) {
  const rows = [['Team', 'Number', 'Player', 'Status', ...columns.map(([, label]) => label), 'FGM/FGA', 'FG%', '3PM/3PA', 'FTM/FTA', 'Official team score']];
  for (const [teamId, t] of Object.entries(state.teams)) {
    for (const p of t.players) rows.push([t.name, p.number, p.name, p.out ? 'Fouled out' : p.on ? 'On court' : 'Bench', ...columns.map(([key]) => key === 'ms' ? minutes(p.ms) : p[key]), ...shootingValues(shootingTotals(state.shots, teamId, p.id)), '']);
    const sum = totals(t);
    rows.push([t.name, '', 'TEAM TOTAL', '', ...columns.map(([key]) => key === 'ms' ? minutes(sum.ms) : sum[key]), ...shootingValues(shootingTotals(state.shots, teamId)), t.score]);
  }
  // Spreadsheet software may interpret user text starting with these characters as formulas.
  return '\uFEFF' + rows.map(row => row.map(value => {
    const text = String(value);
    return '"' + (/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}

export function boxScore(parent, state, { courtOnly = false } = {}) {
  const grid = node('div', '', parent, 'boxscore-grid');
  for (const [k, t] of Object.entries(state.teams)) {
    const panel = node('section', '', grid, `boxscore team-${k}`);
    const top = node('header', '', panel, 'boxscore-title');
    node('h3', t.name, top); node('strong', t.score, top);
    const scroll = node('div', '', panel, 'table-scroll');
    const table = node('table', '', scroll); node('caption', `${t.name} · ${courtOnly ? 'On the floor' : 'Full roster box score'}`, table);
    const head = node('tr', '', node('thead', '', table));
    for (const label of ['Player', ...columns.map(([, label]) => label)]) node('th', label, head).scope = 'col';
    const body = node('tbody', '', table);
    const players = courtOnly ? t.players.filter(p => p.on) : [...t.players].sort((a, b) => Number(b.on) - Number(a.on));
    for (const p of players) {
      const row = node('tr', '', body); row.dataset.playerId = p.id;
      identity(node('th', '', row), p);
      for (const [key] of columns) {
        const cell = node('td', key === 'ms' ? minutes(p.ms) : p[key], row);
        if (key === 'ms') cell.dataset.minutes = p.id;
        if (key === 'fls' && (p.out || p.fls >= state.personalLimit - 1)) cell.className = 'foul-warning';
      }
    }
    if (!players.length) node('p', 'No players on the floor.', panel, 'empty-state');
    const footer = node('tr', '', node('tfoot', '', table));
    node('th', courtOnly ? 'ON-COURT TOTAL' : 'PLAYER TOTAL', footer).scope = 'row';
    const sum = totals({ players });
    for (const [key] of columns) {
      const cell = node('td', key === 'ms' ? minutes(sum.ms) : sum[key], footer);
      if (key === 'ms') { cell.dataset.teamMinutes = k; cell.dataset.courtOnly = String(courtOnly); }
    }
    if (!courtOnly) {
      const adjustment = t.score - sum.pts;
      node('p', `Official score ${t.score} · Player points ${sum.pts}${adjustment ? ` · Unassigned / score correction ${adjustment > 0 ? '+' : ''}${adjustment}` : ''}`, panel, 'score-reconciliation');
    }
  }
}

export function renderReports(parent, state, ui) {
  const top = heading(parent, 'GAME REPORT', 'Every contribution. One view.');
  const actions = node('div', '', top, 'report-actions');
  const csv = node('button', 'Download CSV', actions); csv.type = 'button'; csv.onclick = ui.csv;
  const print = node('button', 'Print report', actions); print.type = 'button'; print.onclick = () => window.print();
  node('p', 'Current game • Player totals include the full roster. Minutes are cumulative player time.', parent, 'muted report-note');
  const overview = node('div', '', parent, 'report-overview');
  const comparison = node('section', '', overview, 'comparison');
  heading(comparison, 'TEAM COMPARISON', 'The numbers behind the score');
  const sums = Object.fromEntries(Object.entries(state.teams).map(([k, t]) => [k, totals(t)]));
  const legend = node('div', '', comparison, 'comparison-legend');
  for (const [k, t] of Object.entries(state.teams)) node('span', t.name, legend, 'team-' + k);
  for (const [key, label] of [['score', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks']]) {
    const a = key === 'score' ? state.teams.A.score : sums.A[key], b = key === 'score' ? state.teams.B.score : sums.B[key];
    const row = node('div', '', comparison, 'comparison-row');
    const values = node('div', '', row); node('strong', a, values); node('span', label, values); node('strong', b, values);
    const bars = node('div', '', row, 'comparison-bars');
    bars.setAttribute('aria-label', `${label}: ${state.teams.A.name} ${a}, ${state.teams.B.name} ${b}`);
    const left = node('span', '', bars, 'bar-a'), right = node('span', '', bars, 'bar-b');
    left.style.width = `${a + b ? a / (a + b) * 100 : 50}%`;
    right.style.width = `${a + b ? b / (a + b) * 100 : 50}%`;
  }
  const ranked = node('section', '', overview, 'leaders');
  heading(ranked, 'GAME LEADERS', 'Setting the pace');
  const label = node('label', 'Rank by', ranked), select = node('select', '', label);
  select.setAttribute('aria-label', 'Rank leaders by');
  for (const [key, name] of columns.filter(([key]) => !['ms', 'fls'].includes(key))) {
    const option = node('option', name, select); option.value = key;
  }
  select.value = ui.metric;
  select.onchange = () => ui.setMetric(select.value);
  const list = node('ol', '', ranked, 'leader-list');
  for (const [i, p] of leaders(state, ui.metric).entries()) {
    const item = node('li', '', list, 'team-' + p.team);
    node('span', String(i + 1).padStart(2, '0'), item, 'rank');
    const who = node('div', '', item); node('strong', p.name, who); node('small', `#${p.number} · ${p.teamName}`, who);
    node('b', p[ui.metric], item);
  }
  if (!list.childElementCount) node('p', 'Add players to see game leaders.', ranked, 'empty-state');
  boxScore(parent, state);
  shootingReport(parent, state);
}

export function shootingReport(parent, state) {
  const section = node('section', '', parent, 'shooting-report'); heading(section, 'SHOT BREAKDOWN', 'Attempts into buckets.');
  node('p', 'Recorded attempts only. Point-only scoring has no attempt history; percentages do not include those points.', section, 'muted report-note');
  const grid = node('div', '', section, 'boxscore-grid');
  for (const [teamId, t] of Object.entries(state.teams)) {
    const panel = node('div', '', grid, 'boxscore team-' + teamId); node('h3', t.name, panel, 'shooting-team-title');
    const scroll = node('div', '', panel, 'table-scroll'), table = node('table', '', scroll);
    node('caption', t.name + ' · Recorded shooting', table);
    const head = node('tr', '', node('thead', '', table));
    for (const label of ['Player', 'FGM/FGA', 'FG %', '3PM/3PA', 'FTM/FTA', 'FT %']) node('th', label, head).scope = 'col';
    for (const p of t.players) {
      const row = node('tr', '', table.tBodies[0] || node('tbody', '', table)); node('th', '#' + p.number + ' ' + p.name, row).scope = 'row';
      const totals = shootingTotals(state.shots, teamId, p.id);
      for (const value of [...shootingValues(totals), percentage(totals.ftm, totals.fta)]) node('td', value, row);
    }
    const total = shootingTotals(state.shots, teamId), foot = node('tr', '', node('tfoot', '', table)); node('th', 'TEAM TOTAL', foot).scope = 'row';
    for (const value of [...shootingValues(total), percentage(total.ftm, total.fta)]) node('td', value, foot);
    node('p', `Tracked shot points ${total.points} · Official score ${t.score}`, panel, 'score-reconciliation');
  }
}
