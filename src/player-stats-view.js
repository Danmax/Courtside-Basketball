import { formatHeight } from './profiles.js';
import { profileImage } from './image-upload.js';
import { appStorage, appNow } from './app-storage.js';
import { node, minutes, heading } from './ui.js';
import { KEY, tick, format } from './engine.js';
import { readGame } from './storage.js';
import { readTournament, TOURNAMENT_KEY } from './tournament-storage.js';
import { gamePlayers, tournamentPlayers, rankPlayers, playerFacts, gameFacts, tournamentFacts, statKeys } from './player-stats.js';
import { boxScore } from './reports.js';
import { emptyShooting, shootingValues } from './shooting.js';
import { periodLabel } from './game-rules.js';

export function mountPlayerStats(app) {
  const storage = appStorage();
  const params = new URLSearchParams(location.search), presentation = params.get('display') === '1';
  document.body.className = presentation ? 'players player-presentation' : 'players';
  document.title = 'Courtside — Player Stats';
  document.getElementById('break').hidden = true;
  let source = params.get('source') || 'current', selected = null, average = false;
  let current = null, tournament = null, gameError = '', tournamentError = '';
  const intro = node('div', '', app, 'page-intro stats-intro');
  const title = node('div', '', intro); node('span', 'PLAYER INTELLIGENCE', title, 'eyebrow'); node('h1', presentation ? 'Player board' : 'Player stats', title);
  const displayLink = node('a', presentation ? 'Open Player Stats ↗' : 'Presentation view ↗', intro, 'button-link');
  const notice = node('p', '', app, 'stats-notice'); notice.setAttribute('role', 'alert'); notice.hidden = true;
  const controls = node('section', '', app, 'player-stats-controls'); controls.hidden = presentation;
  function select(label, id, options) {
    const wrap = node('label', label, controls), input = node('select', '', wrap); input.id = id; input.setAttribute('aria-label', label);
    for (const [value, text] of options) { const option = node('option', text, input); option.value = value; }
    return input;
  }
  const sourceInput = select('Stats source', 'stats-source', []);
  const teamInput = select('Team', 'stats-team', [['all', 'All teams']]);
  const searchLabel = node('label', 'Find a player', controls), search = node('input', '', searchLabel); search.id = 'stats-search'; search.type = 'search'; search.placeholder = 'Name or jersey number';
  const metric = select('Sort by', 'stats-metric', [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['fls', 'Personal fouls'], ['ms', 'Playing time']]);
  const mode = select('Display values', 'stats-mode', [['totals', 'Totals'], ['average', 'Per recorded appearance']]);
  const floorLabel = node('label', '', controls, 'floor-filter'), floor = node('input', '', floorLabel); floor.type = 'checkbox'; floor.id = 'stats-floor'; node('span', 'On floor only', floorLabel);
  const scope = node('p', '', app, 'stats-scope');
  const content = node('div', '', app, 'player-stats-content');

  function updateUrl() {
    const url = new URL(location.href); url.searchParams.set('source', source); history.replaceState(null, '', url);
    displayLink.href = `/?view=players&source=${encodeURIComponent(source)}${presentation ? '' : '&display=1'}`;
    if (!presentation) { displayLink.target = '_blank'; displayLink.rel = 'noopener'; }
  }
  function options(input, choices) {
    const signature = JSON.stringify(choices);
    if (input.dataset.choices === signature) return;
    input.dataset.choices = signature; input.replaceChildren();
    for (const [value, text] of choices) { const option = node('option', text, input); option.value = value; }
  }
  function read() {
    gameError = tournamentError = '';
    try { current = readGame(storage); } catch (error) { current = null; gameError = error.message; }
    try { tournament = readTournament(storage); } catch (error) { tournament = null; tournamentError = error.message; }
    const choices = [['current', 'Current game'], ['tournament', 'Tournament · recorded totals'], ...(tournament?.matches.filter(m => m.status === 'final' && m.result.game).map(m => ['match:' + m.id, `${m.result.game.teams.A.name} vs ${m.result.game.teams.B.name} · ${m.id}`]) || [])];
    if (!choices.some(([key]) => key === source)) choices.push([source, 'Saved match unavailable']);
    options(sourceInput, choices);
    sourceInput.value = source;
    render();
  }
  function dataset() {
    if (source === 'current') {
      if (!current) return { error: gameError };
      const game = structuredClone(current); tick(game, appNow());
      return { game, rows: gamePlayers(game), label: 'Current game · ' + game.teams.A.name + ' vs ' + game.teams.B.name, facts: gameFacts(game), final: false };
    }
    if (!tournament) return { error: tournamentError };
    if (source === 'tournament') {
      const aggregate = tournamentPlayers(tournament);
      return { ...aggregate, label: `${tournament.name} · ${aggregate.recorded} of ${aggregate.finals} final matches have player box scores · ${aggregate.manual} manual results excluded from player totals.`, facts: tournamentFacts(tournament) };
    }
    const match = tournament.matches.find(m => 'match:' + m.id === source && m.status === 'final' && m.result.game);
    if (!match) return { error: 'This match no longer has a saved player box score. It may have been reopened, corrected manually, or removed. Choose another source.' };
    return { game: match.result.game, rows: gamePlayers(match.result.game, match.id, true), label: `Final box score · ${match.result.game.teams.A.name} vs ${match.result.game.teams.B.name} · ${match.id}`, facts: gameFacts(match.result.game, true), final: true };
  }
  function factsGrid(parent, facts, className = '') {
    const grid = node('div', '', parent, 'facts-grid ' + className);
    for (const f of facts) {
      const card = node('article', '', grid, 'fact-card'); card.dataset.fact = f.kind;
      node('span', f.title, card, 'eyebrow'); node('strong', f.value, card); node('p', f.text, card);
    }
  }
  function value(player, key) {
    if (average && !player.gp) return '—';
    const n = average ? player[key] / player.gp : player[key];
    return key === 'ms' ? minutes(n) : average ? n.toFixed(1) : n;
  }
  function playerTable(parent, rows, interactive = true) {
    const scroll = node('div', '', parent, 'table-scroll player-stat-table'), table = node('table', '', scroll);
    node('caption', `${rows.length} players · ${average ? 'Per recorded appearance' : 'Recorded totals'}`, table);
    const head = node('tr', '', node('thead', '', table));
    for (const title of ['Player', 'Team', 'REC GP', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'PF', 'MIN']) node('th', title, head).scope = 'col';
    const body = node('tbody', '', table);
    for (const p of rows) {
      const row = node('tr', '', body, selected === p.key ? 'selected-player' : ''); row.dataset.playerKey = p.key;
      const nameCell = node('th', '', row); nameCell.scope = 'row';
      const who = node('div', '', nameCell, 'stats-player-name'); node('span', '#' + p.number, who, 'jersey');
      const name = node(interactive ? 'button' : 'strong', p.name, who);
      if (interactive) {
        name.type = 'button'; name.setAttribute('aria-label', `View stats for #${p.number} ${p.name}`); name.setAttribute('aria-pressed', String(selected === p.key));
        name.onclick = () => { selected = p.key; render(); content.querySelector('.player-feature')?.focus({ preventScroll: true }); };
      }
      node('td', p.teamName, row, 'player-team-cell'); node('td', p.gp || '—', row).dataset.label = 'REC GP';
      for (const key of statKeys) node('td', value(p, key), row).dataset.label = key === 'ms' ? 'MIN' : key === 'fls' ? 'PF' : key.toUpperCase();
    }
    if (!rows.length) node('p', 'No players match this view. Try another team, source or search.', parent, 'empty-state');
  }
  function profile(parent, player) {
    const feature = node('section', '', parent, 'player-feature'); feature.tabIndex = -1; feature.setAttribute('aria-label', 'Selected player details');
    node('span', 'PLAYER SPOTLIGHT', feature, 'eyebrow');
    const header = node('div', '', feature, 'spotlight-header'); node('span', player.number, header, 'spotlight-jersey');
    profileImage(header, player.profile?.photo, player.name + ' photo', 'profile-portrait');
    const identity = node('div', '', header); node('h2', player.name, identity); node('p', player.teamName, identity);
    if (player.profile) { node('p', [player.profile.position, formatHeight(player.profile.heightCm), player.profile.hometown].filter(Boolean).join(' · '), identity, 'muted'); if (player.profile.bio) node('p', player.profile.bio, identity, 'profile-bio'); }
    node('span', source === 'current' ? player.status.toUpperCase() : player.identityScope === 'match' ? 'GAME-ONLY PLAYER' : 'RECORDED STATS', feature, 'spotlight-status' + (player.out && source === 'current' ? ' foul-warning' : ''));
    const line = node('div', '', feature, 'spotlight-numbers');
    for (const [key, label] of [['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK'], ['fls', 'PF']]) {
      const stat = node('div', '', line); node('strong', value(player, key), stat); node('span', label, stat);
    }
    node('p', `${player.gp} recorded appearance${player.gp === 1 ? '' : 's'} · ${value(player, 'ms')} MIN${average ? ' per recorded appearance' : ' total'}`, feature, 'spotlight-meta');
    const shooting = node('div', '', feature, 'player-shooting');
    node('span', 'RECORDED SHOOTING TOTALS', shooting, 'eyebrow');
    const shootingLine = node('div', '', shooting, 'shooting-metrics');
    shootingValues(player.shooting || emptyShooting()).forEach((value, i) => { const item = node('div', '', shootingLine); node('strong', value, item); node('span', ['FGM/FGA', 'FG %', '3PM/3PA', 'FTM/FTA'][i], item); });
    node('small', 'Includes explicitly recorded attempts only; point-only scoring is excluded.', shooting);
    factsGrid(feature, playerFacts(player).slice(0, 3), 'player-milestones');
  }
  function render() {
    const data = dataset(); updateUrl();
    const focused = document.activeElement, focusId = focused?.id;
    const focusPlayer = focused?.closest('[data-player-key]')?.dataset.playerKey;
    const focusProfile = focused?.classList.contains('player-feature');
    const oldTeam = teamInput.value || 'all';
    options(teamInput, [['all', 'All teams'], ...new Map((data.rows || []).map(p => [p.teamId, p.teamName]))]);
    teamInput.value = [...teamInput.options].some(o => o.value === oldTeam) ? oldTeam : 'all';
    mode.parentElement.hidden = source !== 'tournament'; floorLabel.hidden = source !== 'current';
    average = source === 'tournament' && mode.value === 'average';
    notice.hidden = !data.error; notice.textContent = data.error || '';
    scope.textContent = data.error ? 'Stats unavailable. Saved data has not been changed.' : data.label;
    content.replaceChildren();
    if (data.error) return;
    if (presentation) {
      if (data.game) {
        scope.textContent += ` · ${data.final ? 'FINAL' : periodLabel(data.game) + ' · ' + format(data.game.game)} · On-floor board; facts include the full roster.`;
        boxScore(content, data.game, { courtOnly: true });
      } else {
        scope.textContent += ' · Top 10 players by recorded total points.';
        playerTable(content, rankPlayers(data.rows).slice(0, 10), false);
      }
      factsGrid(content, data.facts.slice(0, 3), 'presentation-facts');
      return;
    }
    const query = search.value.trim().toLocaleLowerCase();
    const rows = rankPlayers(data.rows.filter(p => (teamInput.value === 'all' || p.teamId === teamInput.value) && (!floor.checked || source !== 'current' || p.on) && (!query || p.name.toLocaleLowerCase().includes(query) || String(p.number).includes(query))), metric.value, average);
    if (!rows.some(p => p.key === selected)) selected = rows[0]?.key || null;
    const showcase = node('div', '', content, 'stats-showcase');
    const player = rows.find(p => p.key === selected);
    if (player) profile(showcase, player);
    const facts = node('section', '', showcase, 'game-facts-panel');
    heading(facts, source === 'tournament' ? 'ACROSS THE TOURNAMENT' : data.final ? 'SAVED MATCH' : 'CURRENT GAME', source === 'tournament' ? 'Tournament facts' : 'Game facts');
    node('p', 'Facts cover the full selected source, regardless of player filters.', facts, 'muted facts-note');
    factsGrid(facts, data.facts);
    const tableTop = heading(content, 'PLAYER COMPARISON', 'Every player. Every contribution.'); tableTop.classList.add('player-table-heading');
    node('p', 'REC GP counts games with playing time or a recorded stat. Unused bench entries and results without box scores are excluded from averages. Players added only for a game stay separate across matches. Shooting percentages use explicitly recorded attempts only.', content, 'muted stats-method');
    playerTable(content, rows);
    if (player) {
      const logs = node('section', '', content, 'player-game-log'); heading(logs, 'SOURCE GAME LOG', player.name + ' · Recorded appearances');
      const scroll = node('div', '', logs, 'table-scroll'), table = node('table', '', scroll);
      node('caption', 'Includes roster entries without a recorded appearance; these are excluded from REC GP.', table);
      const header = node('tr', '', node('thead', '', table)); for (const title of ['Game / opponent', 'Recorded appearance', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'PF', 'MIN']) node('th', title, header).scope = 'col';
      const body = node('tbody', '', table);
      for (const log of [...player.logs].reverse()) {
        const row = node('tr', '', body); node('th', `${log.final ? log.matchId : 'Current game'} · vs ${log.opponent}`, row).scope = 'row';
        node('td', log.appeared ? 'Yes' : 'No', row); for (const key of statKeys) node('td', key === 'ms' ? minutes(log[key]) : log[key], row);
      }
      if (!player.logs.length) node('p', 'No saved box scores for this player yet.', logs, 'empty-state');
    }
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    else if (focusProfile) content.querySelector('.player-feature')?.focus({ preventScroll: true });
    else if (focusPlayer) [...content.querySelectorAll('[data-player-key]')].find(row => row.dataset.playerKey === focusPlayer)?.querySelector('button')?.focus({ preventScroll: true });
  }
  sourceInput.onchange = () => { source = sourceInput.value; selected = null; teamInput.value = 'all'; read(); };
  for (const input of [teamInput, metric, mode, floor]) input.onchange = render;
  search.oninput = render;
  let refreshPending = false;
  window.addEventListener('storage', event => {
    if (event.key === KEY && source !== 'current') return;
    if (![KEY, TOURNAMENT_KEY, null].includes(event.key) || refreshPending) return;
    refreshPending = true; setTimeout(() => { refreshPending = false; read(); }, 100);
  });
  // Project timestamp-based player minutes; this display never writes clock or storage state.
  setInterval(() => {
    if (source !== 'current' || !current || (!current.running && !current.shotRunning && !current.break)) return;
    render();
  }, 1000);
  read();
}
