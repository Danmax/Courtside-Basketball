import { appStorage, appNow } from './app-storage.js';
import { node, confirmChange } from './ui.js';
import { KEY, tick, stat, format, recordShot, voidShot } from './engine.js';
import { readGame, writeGame } from './storage.js';
import { readTournament, TOURNAMENT_KEY } from './tournament-storage.js';
import { shootingTotals, shootingValues } from './shooting.js';
import { drawCourt } from './shot-court.js';
import { fieldGoalValue } from './court-geometry.js';
import { createShotClockControls } from './shot-clock-controls.js';
import { periodLabel } from './game-rules.js';
import { createLiveToolbar } from './live-toolbar.js';

export function mountShots(app) {
  const storage = appStorage();
  document.body.className = 'shots'; document.title = 'Courtside — Shot tracker'; document.getElementById('break').hidden = true;
  let currentError = '', saving = false;
  let game = null, tournament = null, source = 'current', team = 'A', playerId = '', value = 2, pending = null, cursor = { x: .5, y: .5 };
  const intro = node('div', '', app, 'page-intro'); const title = node('div', '', intro); node('span', 'LIVE CAPTURE', title, 'eyebrow'); node('h1', 'Shot tracker', title);
  const error = node('p', '', app, 'shot-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const message = node('p', '', app, 'shot-message'); message.setAttribute('role', 'status'); message.setAttribute('aria-atomic', 'true');
  let toastDismissTimer, toastClearTimer;
  function hideToast() {
    clearTimeout(toastDismissTimer); clearTimeout(toastClearTimer);
    message.classList.remove('is-visible');
    toastClearTimer = setTimeout(() => { message.textContent = ''; }, 250);
  }
  function showToast(text) {
    clearTimeout(toastDismissTimer); clearTimeout(toastClearTimer);
    message.textContent = text; message.classList.add('is-visible');
    toastDismissTimer = setTimeout(hideToast, 3500);
  }
  const toolbar = createLiveToolbar(app, { shots: true });
  const selectors = node('section', '', app, 'shot-selectors shot-source-toolbar'); selectors.setAttribute('aria-label', 'Shot chart source and focus');
  function select(label, id, options) {
    const wrap = node('label', label, selectors), input = node('select', '', wrap); input.id = id; input.setAttribute('aria-label', label);
    setOptions(input, options); return input;
  }
  function setOptions(input, choices) {
    const signature = JSON.stringify(choices); if (input.dataset.choices === signature) return;
    input.dataset.choices = signature; input.replaceChildren(); for (const [value, text] of choices) { const option = node('option', text, input); option.value = value; }
  }
  const sourceInput = select('Game source', 'shot-source', [['current', 'Current game']]);
  const chartInput = select('Chart focus', 'shot-chart-focus', [['player', 'Player'], ['team', 'Team']]);
  const layout = node('div', '', app, 'shot-layout');
  const chart = node('section', '', layout, 'shot-chart-panel');
  const side = node('div', '', layout, 'shot-sidebar');
  const picker = node('section', '', layout, 'shot-picker'); layout.prepend(picker);
  node('h2', 'Team & shooter', picker, 'eyebrow');
  const teamPicks = node('div', '', picker, 'shot-team-picks'); teamPicks.setAttribute('role', 'group'); teamPicks.setAttribute('aria-label', 'Shooting team');
  const teamButtons = new Map();
  for (const k of ['A', 'B']) {
    const button = node('button', '', teamPicks, 'shot-team-pick team-' + k); button.type = 'button';
    const name = node('span', '', button), score = node('strong', '', button);
    button.onclick = () => { if (team !== k) { team = k; playerId = ''; render(); } };
    teamButtons.set(k, { button, name, score });
  }
  const floorTitle = node('p', 'On the floor', picker, 'shot-picker-title');
  const quickPlayers = node('div', '', picker, 'shot-player-picks'); quickPlayers.setAttribute('role', 'group'); quickPlayers.setAttribute('aria-label', 'Choose shooter');
  const bench = node('details', '', picker, 'shot-bench-picker'), benchTitle = node('summary', 'Bench & unavailable · review charts', bench), benchPlayers = node('div', '', bench, 'shot-player-picks');
  let rosterSignature = '', playerButtons = [];
  const otherStats = node('section', '', side, 'shot-other-stats');
  const statTitle = node('h3', '', otherStats);
  const statMeta = node('p', '', otherStats, 'muted');
  const statActions = node('div', '', otherStats, 'shot-stat-actions'); statActions.setAttribute('role', 'group'); statActions.setAttribute('aria-label', 'Selected player stat controls');
  const statButtons = [];
  for (const [key, label, noun] of [['reb', 'REB', 'rebound'], ['ast', 'AST', 'assist'], ['stl', 'STL', 'steal'], ['blk', 'BLK', 'block'], ['fls', 'PF', 'foul']]) {
    const button = node('button', '', statActions); button.type = 'button';
    const count = node('strong', '0', button); node('span', label + ' +', button);
    button.onclick = async () => {
      const id = playerId, selectedTeam = team;
      try {
        await update(next => { if (!stat(next, selectedTeam, id, key)) throw new Error('Choose an eligible on-court player before adding a stat.'); });
        const player = game.teams[selectedTeam].players.find(p => p.id === id);
        showToast(`${label} added · #${player.number} ${player.name}${player.out ? ' · Fouled out; remove or replace before restarting.' : ''}`);
      } catch (e) { fail(e); }
    };
    statButtons.push({ button, count, key, noun });
  }
  const recordedStats = node('p', '', otherStats, 'shot-recorded-stats'); recordedStats.hidden = true;
  const chartHeader = node('div', '', chart, 'shot-chart-header'); node('h2', 'Mark the shot', chartHeader); const detected = node('b', 'AUTO 2 / 3', chartHeader, 'shot-detected-value'); const count = node('span', '', chartHeader, 'muted');
  const kindPicker = node('div', '', chart, 'shot-kind-picker'); kindPicker.setAttribute('role', 'group'); kindPicker.setAttribute('aria-label', 'Attempt type');
  const fieldButton = node('button', 'Field goal · auto 2/3', kindPicker), freeButton = node('button', 'Free throw', kindPicker);
  fieldButton.type = freeButton.type = 'button';
  fieldButton.onclick = () => { value = 2; pending = null; render(); };
  freeButton.onclick = () => { value = 1; pending = null; render(); };
  chartHeader.insertBefore(kindPicker, detected);
  const court = node('button', '', chart, 'shot-court'); court.type = 'button'; court.setAttribute('aria-label', 'Choose shot location on half-court'); court.setAttribute('aria-describedby', 'court-help');
  drawCourt(court); const markers = node('span', '', court, 'shot-markers');
  const help = node('p', 'Tap a location, then choose Made or Missed. Arrow keys move the marker; Enter selects a spot.', chart, 'court-help'); help.id = 'court-help'; const courtInstructions = help.textContent;
  const courtGuide = node('details', '', chart, 'inline-help'); node('summary', 'Court guide & keyboard controls', courtGuide);
  node('p', 'Outside the drawn three-point line counts as 3; on or inside it counts as 2, including the corner lines. Focus the court and use arrow keys to move. Hold Shift for larger steps, or press Enter to select the center. Switch teams or players before confirming without losing the marked spot.', courtGuide);
  const legend = node('div', '', chart, 'shot-legend'); node('span', '● Made', legend, 'made-legend'); node('span', '× Missed', legend, 'missed-legend'); node('span', '◎ Selected location', legend, 'pending-legend');
  legend.append(count);
  const summary = node('section', '', side, 'shot-summary'); const summaryTitle = node('h2', '', summary); const summaryStats = node('div', '', summary, 'shooting-metrics');
  node('p', 'Recorded shots only. Point-only scoring has no attempt history and is not converted into shooting percentages.', summary, 'section-help');
  const capture = node('section', '', side, 'shot-capture'); node('h2', 'Record shot', capture);
  const captureWho = node('p', '', capture, 'shot-current-shooter');
  const selection = node('p', '', capture, 'shot-selection');
  const buttons = node('div', '', capture, 'shot-outcomes');
  const made = node('button', 'Made · +2 points', buttons, 'shot-made'), missed = node('button', 'Missed · attempt only', buttons, 'shot-missed'); made.type = missed.type = 'button';
  const clear = node('button', 'Clear location', capture, 'shot-clear'); clear.type = 'button';
  const scoringHelp = node('details', '', capture, 'inline-help'); node('summary', 'How scoring works', scoringHelp);
  node('p', 'A make adds player and team points. Record each basket once, using this page or the game desk. Misses do not change possession or clocks. Free throws require both clocks stopped and leave possession under official control.', scoringHelp);
  const clockControls = createShotClockControls(side, { apply: update, toast: showToast, fail, primaryHost: toolbar.actions });
  clockControls.element.id = 'clock-tools'; clockControls.element.tabIndex = -1;
  const archiveNote = node('p', 'Saved final box score · This shot chart is read-only. Use Current game to capture new attempts.', side, 'shot-archive-note'); archiveNote.hidden = true;
  side.append(capture, otherStats, clockControls.element, summary, archiveNote);
  const history = node('section', '', app, 'shot-history');
  let historySignature = '', historyScope = '', markerSignature = '';
  const mobileDock = node('div', '', app, 'shot-mobile-dock'); mobileDock.hidden = true;
  mobileDock.setAttribute('role', 'group'); mobileDock.setAttribute('aria-label', 'Quick shot result');
  const dockWho = node('span', '', mobileDock);
  const dockMade = node('button', 'Made +2', mobileDock, 'shot-made'), dockMissed = node('button', 'Missed', mobileDock, 'shot-missed');
  dockMade.type = dockMissed.type = 'button'; dockMissed.setAttribute('aria-label', 'Missed · attempt only');

  function fail(e) { hideToast(); error.textContent = e.message; error.hidden = false; }
  function activeGame() {
    if (source === 'current') return game;
    return tournament?.matches.find(m => 'match:' + m.id === source && m.status === 'final' && m.result.game)?.result.game || null;
  }
  function read(refreshTournament = true) {
    let next = null;
    try { next = readGame(storage); if (currentError) error.hidden = true; currentError = ''; } catch (e) { currentError = e.message; if (source === 'current') fail(e); }
    if (next?.gameId !== game?.gameId) { pending = null; playerId = ''; value = 2; cursor = { x: .5, y: .5 }; }
    game = next;
    if (refreshTournament) {
      try { tournament = readTournament(storage); } catch (e) { tournament = null; if (source !== 'current') fail(e); }
    }
    const options = [['current', 'Current game'], ...(tournament?.matches.filter(m => m.status === 'final' && m.result.game).map(m => ['match:' + m.id, `${m.result.game.teams.A.name} vs ${m.result.game.teams.B.name} · ${m.id}`]) || [])];
    if (!options.some(([id]) => id === source)) options.push([source, 'Saved match unavailable']); setOptions(sourceInput, options); sourceInput.value = source;
    render();
  }
  function display() { const state = activeGame(); if (!state) return null; const copy = structuredClone(state); if (source === 'current') tick(copy, appNow()); return copy; }
  async function update(fn) {
    if (source !== 'current') throw new Error('Archived shot charts are read-only.');
    if (saving) throw new Error('A save is still in progress. Wait for it to finish.');
    const expectedRaw = storage.getItem(KEY);
    const next = readGame(storage);
    if (next.gameId !== game?.gameId) throw new Error('The game changed. Review the current game and choose the shot again.');
    saving = true; render();
    try { tick(next, appNow()); fn(next); await writeGame(storage, next, expectedRaw); game = next; error.hidden = true; }
    finally { saving = false; render(); }
  }
  async function commit(madeShot) {
    try {
      const spot = pending, chosenPlayer = playerId, chosenTeam = team, shotValue = value;
      if (shotValue !== 1 && !spot) throw new Error('Choose a location before recording the shot.');
      await update(next => {
        if (!recordShot(next, chosenTeam, chosenPlayer, shotValue, madeShot, shotValue === 1 ? null : spot.x, shotValue === 1 ? null : spot.y, appNow())) throw new Error('Shot not recorded. Choose an on-court eligible player, end any break, resolve clock violations, and stop both clocks for a free throw.');
      });
      if (pending === spot) pending = null; showToast(`${madeShot ? 'Made' : 'Missed'} ${shotValue === 1 ? 'free throw' : shotValue + '-point attempt'} saved${madeShot ? ' · score updated' : ' · score unchanged'}.`);
      render();
    } catch (e) { fail(e); }
  }
  made.onclick = dockMade.onclick = () => commit(true); missed.onclick = dockMissed.onclick = () => commit(false);
  clear.onclick = () => { pending = null; render(); };
  function choose(x, y) { pending = cursor = { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) }; value = fieldGoalValue(pending.x, pending.y); render(); }
  court.onclick = event => {
    if (source !== 'current' || value === 1) return;
    const bounds = court.querySelector('svg').getBoundingClientRect(); choose(event.detail === 0 ? cursor.x : (event.clientX - bounds.left) / bounds.width, event.detail === 0 ? cursor.y : (event.clientY - bounds.top) / bounds.height);
  };
  court.onkeydown = event => {
    if (source !== 'current' || value === 1 || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); const step = event.shiftKey ? .1 : .02;
    choose(cursor.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), cursor.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
  };
  function render() {
    const state = display(), archived = source !== 'current';
    sourceInput.disabled = saving;
    toolbar.render(state, archived);
    clockControls.render(state, archived);
    capture.hidden = kindPicker.hidden = archived; archiveNote.hidden = !archived;
    fieldButton.setAttribute('aria-pressed', String(value !== 1)); freeButton.setAttribute('aria-pressed', String(value === 1));
    court.disabled = archived || value === 1 || !state || saving;
    summary.hidden = !state;
    if (!state) { picker.hidden = otherStats.hidden = true; mobileDock.hidden = true; document.body.classList.remove('shot-ready'); markers.replaceChildren(); history.replaceChildren(); markerSignature = historySignature = ''; summaryStats.replaceChildren(); made.disabled = missed.disabled = true; fail(new Error(source === 'current' ? currentError || 'Game data is unavailable. Use the game desk to recover it.' : 'This match no longer has a saved box score. Choose another source.')); return; }
    picker.hidden = otherStats.hidden = false;
    for (const [k, t] of Object.entries(state.teams)) {
      const item = teamButtons.get(k); item.name.textContent = t.name; item.score.textContent = t.score;
      item.button.setAttribute('aria-label', 'Select team ' + t.name); item.button.setAttribute('aria-pressed', String(team === k));
    }
    const players = state.teams[team].players;
    if (!players.some(p => p.id === playerId)) playerId = (players.find(p => p.on && !p.out) || players[0])?.id || '';
    floorTitle.textContent = archived ? 'Saved roster · choose a player to review' : 'On the floor · tap a jersey to select';
    const signature = JSON.stringify([source, team, players.map(p => [p.id, p.name, p.number, p.on, p.out])]);
    if (signature !== rosterSignature) {
      const focused = document.activeElement?.dataset.shooter;
      rosterSignature = signature; quickPlayers.replaceChildren(); benchPlayers.replaceChildren(); playerButtons = [];
      const add = (parent, p, review = false) => {
        const button = node('button', '', parent, 'shot-player-pick'); button.type = 'button'; button.dataset.shooter = p.id;
        button.setAttribute('aria-label', `${review ? 'View' : 'Select'} #${p.number} ${p.name}`);
        button.disabled = !archived && !review && p.out;
        node('strong', '#' + p.number, button); node('span', p.name, button); const points = node('small', '', button);
        button.onclick = () => { playerId = p.id; render(); };
        playerButtons.push({ button, points, id: p.id });
      };
      for (const p of players.filter(p => archived || p.on)) add(quickPlayers, p);
      for (const p of players.filter(p => !p.on || p.out)) add(benchPlayers, p, true);
      if (!quickPlayers.childElementCount) node('p', 'No players on the floor. Set the lineup on the game desk.', quickPlayers, 'empty-state');
      if (focused) playerButtons.find(item => item.id === focused)?.button.focus({ preventScroll: true });
    }
    for (const { button, points, id } of playerButtons) {
      const p = players.find(p => p.id === id); button.setAttribute('aria-pressed', String(playerId === id));
      points.textContent = p.out ? 'FOULED OUT' : `${p.pts} PTS${!p.on && !archived ? ' · BENCH' : ''}`;
    }
    bench.hidden = archived || !players.some(p => !p.on || p.out);
    benchTitle.textContent = `Bench & unavailable (${players.filter(p => !p.on || p.out).length}) · review charts`;
    help.textContent = archived ? 'Saved attempts retain their recorded point values. This chart is read-only.' : courtInstructions;
    detected.textContent = archived ? 'RECORDED VALUES' : value === 1 ? 'FREE THROW · 1 PT' : pending ? value + '-POINT SHOT' : 'AUTO 2 / 3';
    detected.dataset.value = !archived && (pending || value === 1) ? value : '';
    const player = players.find(p => p.id === playerId), teamChart = chartInput.value === 'team';
    captureWho.textContent = player ? `#${player.number} ${player.name} · ${state.teams[team].name}` : 'Choose a shooter';
    captureWho.className = 'shot-current-shooter team-' + team;
    statTitle.textContent = player ? `Other stats · #${player.number} ${player.name}` : 'Other player stats';
    statMeta.textContent = player ? `${player.pts} PTS · ${Math.floor(player.ms / 60000)}:${String(Math.floor(player.ms / 1000) % 60).padStart(2, '0')} MIN · Team fouls ${state.teams[team].fouls}${player.out ? ' · FOULED OUT' : !player.on && !archived ? ' · BENCH' : ''}` : 'Choose a player to see their stats.';
    statActions.hidden = archived; recordedStats.hidden = !archived;
    recordedStats.textContent = player ? `${player.reb} REB · ${player.ast} AST · ${player.stl} STL · ${player.blk} BLK · ${player.fls} PF` : 'No player selected.';
    for (const { button, count, key, noun } of statButtons) {
      count.textContent = player?.[key] ?? '—'; button.disabled = saving || !player?.on || player.out;
      button.setAttribute('aria-label', player ? `Add ${noun} for #${player.number} ${player.name}` : `Add ${noun}`);
      button.classList.toggle('foul-warning', key === 'fls' && !!player && player.fls >= state.personalLimit - 1);
    }
    const shots = (state.shots || []).filter(shot => shot.team === team && (teamChart || shot.playerId === playerId));
    const scope = JSON.stringify([source, state.gameId, team, teamChart ? 'team' : playerId]);
    const shotSignature = JSON.stringify(shots);
    const total = shootingTotals(shots);
    summaryTitle.textContent = teamChart ? state.teams[team].name : player ? '#' + player.number + ' ' + player.name : 'No player selected'; summaryStats.replaceChildren();
    shootingValues(total).forEach((value, i) => { const item = node('div', '', summaryStats); node('strong', value, item); node('span', ['FGM / FGA', 'FG %', '3PM / 3PA', 'FTM / FTA'][i], item); });
    const eligible = !!player?.on && !player.out && !state.break && !state.violation;
    const ready = !saving && eligible && (value === 1 ? !state.running && !state.shotRunning : !!pending);
    made.disabled = missed.disabled = !ready; clear.disabled = !pending;
    made.textContent = `Made · +${value} ${value === 1 ? 'point' : 'points'}`;
    mobileDock.hidden = archived || !ready; document.body.classList.toggle('shot-ready', !archived && ready);
    dockWho.textContent = player ? `#${player.number} ${player.name} · ${value === 1 ? 'FT' : value + 'PT'}` : '';
    dockMade.textContent = `Made +${value}`; dockMade.setAttribute('aria-label', made.textContent);
    selection.textContent = !player ? 'Add players on the game desk first.' : player.out ? 'This player has fouled out and cannot receive new attempts.' : !player.on ? 'Bench player · chart review only. Substitute this player onto the floor before recording.' : state.break ? 'Break in progress · use End break in the clock controls before recording.' : state.violation ? 'Shot-clock violation · use Start game + shot or reset the shot clock.' : value === 1 ? state.running || state.shotRunning ? 'Stop both clocks to record a free throw.' : 'Free throw selected · no map location needed.' : pending ? `#${player.number} ${player.name} · ${value} points (${value === 3 ? 'outside the three-point line' : 'on or inside the three-point line'}). Choose Made or Missed.` : 'Choose a court location, then Made or Missed.';
    const nextMarkerSignature = JSON.stringify([scope, state.periods, archived, pending, value]) + shotSignature;
    if (markerSignature !== nextMarkerSignature) {
      markerSignature = nextMarkerSignature; markers.replaceChildren();
      for (const shot of shots.filter(shot => !shot.voided && shot.value !== 1)) {
        const mark = node('span', shot.made ? String(shot.value) : '×', markers, 'shot-marker ' + (shot.made ? 'made' : 'missed')); mark.style.left = shot.x * 100 + '%'; mark.style.top = shot.y * 100 + '%';
        mark.title = `#${shot.playerNumber} ${shot.playerName} · ${shot.made ? 'Made' : 'Missed'} ${shot.value}PT · ${periodLabel({ ...state, quarter: shot.quarter })} ${format(shot.gameMs)}`;
      }
      if (pending && !archived && value !== 1) { const mark = node('span', String(value), markers, 'shot-marker pending'); mark.style.left = pending.x * 100 + '%'; mark.style.top = pending.y * 100 + '%'; }
    }
    count.textContent = `${total.fga} field-goal attempts · ${total.fta} free throws`;
    const nextHistorySignature = JSON.stringify([scope, state.periods, archived, state.running || state.shotRunning]) + shotSignature;
    if (nextHistorySignature === historySignature) return;
    const sameScope = scope === historyScope;
    const scrollTop = sameScope ? history.querySelector('.shot-attempt-list')?.scrollTop || 0 : 0;
    const focusedShot = sameScope ? document.activeElement?.closest('[data-shot-id]')?.dataset.shotId : null;
    historySignature = nextHistorySignature; historyScope = scope;
    history.replaceChildren(); const header = node('div', '', history, 'shot-history-header'); node('h2', 'Attempt log', header); node('span', `${shots.filter(shot => !shot.voided).length} recorded · ${shots.filter(shot => shot.voided).length} voided`, header, 'muted');
    node('p', 'Void an incorrect attempt with both clocks stopped. A void subtracts its made points and excludes it from shooting totals; clocks, possession, fouls and player eligibility stay as set. Reconcile those manually if needed.', history, 'section-help');
    const list = node('ol', '', history, 'shot-attempt-list');
    for (const shot of [...shots].reverse()) {
      const row = node('li', '', list, shot.voided ? 'voided-attempt' : ''); row.dataset.shotId = shot.id; row.tabIndex = -1;
      node('span', shot.voided ? 'VOID' : shot.made ? 'MADE' : 'MISS', row, shot.made ? 'made-legend' : 'missed-legend');
      const detail = node('div', '', row); node('strong', `#${shot.playerNumber} ${shot.playerName}`, detail); node('small', `${periodLabel({ ...state, quarter: shot.quarter })} · ${format(shot.gameMs, true)} · ${shot.value === 1 ? 'Free throw' : shot.value + 'PT'} · ${shot.id}`, detail);
      node('b', shot.made ? '+' + shot.value : '0', row);
      if (!archived && !shot.voided) {
        const shotGameId = state.gameId;
        const undo = node('button', 'Void attempt', row, 'text-danger'); undo.type = 'button'; undo.disabled = state.running || state.shotRunning;
        undo.onclick = async () => {
          if (!await confirmChange('Void this attempt? Its made points will be subtracted. Clocks, possession and player eligibility will stay unchanged.')) return;
          try { await update(next => { if (next.gameId !== shotGameId) throw new Error('The game changed. Review the current attempt log before voiding.'); if (!voidShot(next, shot.id)) throw new Error('Cannot void. Stop both clocks and reconcile any score corrections first.'); }); pending = null; render(); showToast('Attempt voided. Review possession and clocks before restarting.'); } catch (e) { fail(e); }
        };
      }
    }
    if (!shots.length) node('p', 'No attempts recorded for this view yet.', history, 'empty-state');
    list.scrollTop = scrollTop;
    if (focusedShot) {
      const row = [...list.children].find(row => row.dataset.shotId === focusedShot);
      (row?.querySelector('button:not(:disabled)') || row)?.focus({ preventScroll: true });
    }
  }
  sourceInput.onchange = () => { source = sourceInput.value; pending = null; playerId = ''; value = 2; error.hidden = true; hideToast(); read(); };
  chartInput.onchange = render;
  window.addEventListener('storage', event => {
    if (event.key === KEY && source !== 'current') return;
    if ([KEY, TOURNAMENT_KEY, null].includes(event.key)) read(event.key !== KEY);
  });
  setInterval(() => { const state = activeGame(); if (source === 'current' && state && (state.running || state.shotRunning || state.break)) render(); }, 500);
  read();
}
