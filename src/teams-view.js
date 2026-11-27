import { appNow } from './app-storage.js';
import { node, identity, confirmChange } from './ui.js';
import { stat, beginBreak, removeFromCourt, putOnCourt, deletePlayer, renameTeam, addTeamScore } from './engine.js';

function management(parent, state, k, p, ui) {
  const moving = state.running || state.shotRunning;
  ui.dialogButton(parent, 'Edit…', p.id + '-edit', id => ui.rosterEditor(k, p, id), moving);
  if (p.on) {
    ui.dialogButton(parent, 'Substitute…', p.id + '-sub', id => ui.substitutionDialog(k, p, id), moving);
    ui.button(parent, 'Remove from court', x => removeFromCourt(x, k, p.id), moving);
  } else if (!p.out) {
    ui.button(parent, 'Put on court', x => putOnCourt(x, k, p.id), moving || state.teams[k].players.filter(q => q.on).length >= 5);
  }
  const history = (state.shots || []).some(shot => shot.team === k && shot.playerId === p.id) || p.out || ['pts', 'reb', 'ast', 'stl', 'blk', 'fls', 'ms'].some(key => p[key] !== 0);
  ui.button(parent, 'Delete player', async x => await confirmChange('Delete ' + p.name + ' from the roster?') && deletePlayer(x, k, p.id), moving || p.on || history).className = 'text-danger';
}

export function renderTeams(parent, state, ui) {
  const teams = node('div', '', parent, 'teams');
  for (const [k, t] of Object.entries(state.teams)) {
    const moving = state.running || state.shotRunning;
    const panel = node('article', '', teams, 'team-workspace team-' + k);
    const header = node('header', '', panel, 'team-header');
    if (t.logo) { const image = node('img', '', header, 'team-logo'); image.src = t.logo; image.alt = t.name + ' logo'; } else node('span', k === 'A' ? 'H' : 'A', header, 'team-badge');
    const title = node('div', '', header);
    node('small', k === 'A' ? 'HOME TEAM' : 'AWAY TEAM', title, 'eyebrow');
    const name = ui.field(title, 'Team name', t.name, (x, v) => renameTeam(x, k, v)); name.required = true; name.maxLength = 80;
    const eligible = t.players.filter(p => p.on && !p.out).length;
    node('span', `${eligible}/5 on floor`, header, 'count-pill');
    const tools = node('div', '', panel, 'team-tools');
    ui.dialogButton(tools, 'Add player…', k + '-add', id => ui.rosterEditor(k, null, id), moving);
    const timeout = node('details', '', tools, 'popover'); node('summary', `Timeout · ${t.timeouts} left`, timeout);
    for (const n of new Set([state.timeoutShort ?? 30, state.timeoutLong ?? 60])) ui.button(timeout, 'Timeout ' + n, x => beginBreak(x, x.teams[k].name + ' TIMEOUT', n, appNow(), k), t.timeouts <= 0 || !!state.break);
    const corrections = node('details', '', tools, 'popover'); node('summary', 'Team score', corrections);
    node('p', 'Unassigned score / correction', corrections, 'muted');
    for (const n of [1, 2, 3, -1]) ui.button(corrections, 'Score ' + n, x => addTeamScore(x, k, n));
    if (ui.mode === 'roster') {
      node('p', 'Stop both clocks to edit the lineup. Players with game activity stay in this roster until reset.', panel, 'section-help');
      for (const p of [...t.players].sort((a, b) => Number(b.on) - Number(a.on))) {
        const row = node('div', '', panel, 'player roster-player'); row.dataset.playerId = p.id;
        identity(row, p);
        node('p', `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST · ${p.fls} PF`, row, 'roster-summary');
        const actions = node('div', '', row, 'roster-actions'); management(actions, state, k, p, ui);
        if (p.out && p.on) node('p', 'Remove or replace before restarting. With no bench, remove and manually restart with fewer players.', row, 'foul-warning');
      }
      if (!t.players.length) node('p', 'Your roster starts here. Add a player to get ready for tip-off.', panel, 'empty-state');
      continue;
    }
    const caption = node('div', '', panel, 'floor-caption');
    node('h3', 'On the floor', caption); node('span', 'Tap a stat to add one', caption);
    const scroll = node('div', '', panel, 'table-scroll');
    const table = node('table', '', scroll, 'scoring-table');
    table.setAttribute('aria-label', `${t.name} on-floor stat controls`);
    const head = node('tr', '', node('thead', '', table));
    for (const label of ['Player', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'PF', 'Score']) node('th', label, head).scope = 'col';
    const body = node('tbody', '', table);
    for (const p of t.players.filter(p => p.on)) {
      const row = node('tr', '', body, 'player' + (p.out ? ' fouled-out' : '')); row.dataset.playerId = p.id;
      const who = node('th', '', row); who.scope = 'row'; identity(who, p);
      const sub = ui.dialogButton(who, 'Substitute…', p.id + '-sub', id => ui.substitutionDialog(k, p, id), moving); sub.className = 'sub-button';
      node('td', p.pts, row, 'points-cell');
      for (const [key, label] of [['reb', 'rebound'], ['ast', 'assist'], ['stl', 'steal'], ['blk', 'block'], ['fls', 'foul']]) {
        const cell = node('td', '', row);
        const add = ui.button(cell, '', x => stat(x, k, p.id, key), p.out);
        add.setAttribute('aria-label', `Add ${label} for #${p.number} ${p.name}`);
        add.className = 'stat-tap' + (key === 'fls' && p.fls >= state.personalLimit - 1 ? ' foul-warning' : '');
        node('strong', p[key], add); node('span', '+', add, 'stat-plus'); node('span', key === 'fls' ? 'PF' : key.toUpperCase(), add, 'stat-label');
      }
      const score = node('td', '', row, 'score-buttons');
      for (const n of [1, 2, 3]) {
        const add = ui.button(score, '+' + n, x => stat(x, k, p.id, 'pts', n), p.out);
        add.setAttribute('aria-label', `Add ${n} ${n === 1 ? 'point' : 'points'} for #${p.number} ${p.name}`);
      }
      if (p.out) {
        const notice = node('tr', '', body, 'foul-notice'); const cell = node('td', '', notice); cell.colSpan = 8;
        node('span', `${p.name} fouled out. Remove or replace before restarting.`, cell);
        ui.button(cell, 'Remove from court', x => removeFromCourt(x, k, p.id), moving);
      }
    }
    if (!t.players.some(p => p.on)) node('p', 'No players on the floor. Use the bench or Roster to set your lineup.', panel, 'empty-state');
    const bench = node('div', '', panel, 'bench');
    const benchHeading = node('div', '', bench, 'floor-caption');
    node('h3', 'Bench & unavailable', benchHeading); node('span', t.players.filter(p => !p.on).length + ' players', benchHeading);
    for (const p of t.players.filter(p => !p.on)) {
      const row = node('div', '', bench, 'player bench-player'); row.dataset.playerId = p.id;
      identity(row, p); node('span', `${p.pts} PTS · ${p.fls} PF`, row, 'bench-stats');
      if (!p.out) ui.button(row, 'Put on court', x => putOnCourt(x, k, p.id), moving || t.players.filter(q => q.on).length >= 5);
    }
    if (!t.players.some(p => !p.on)) node('p', 'No bench players. Add players to build your rotation.', bench, 'empty-state');
  }
}
