import { appStorage, appNow } from './app-storage.js';
import './style.css';
import {
  KEY, initial, format, parseClock, note, stop, tick, possession, start, beginBreak,
  substitute, startShotClock, stopShotClock, setClock, resetShotClock,
  addPlayer, updatePlayer, resetGame, nextPeriod, applyGameRules,
} from './engine.js';
import { gameRules, gameRulesSummary, periodLabel } from './game-rules.js';
import { buildGameRulesForm } from './game-rules-form.js';
import { exportGame, importGame, MAX_BACKUP_BYTES } from './game-transfer.js';
import { readGame, writeGame } from './storage.js';
import { readTournament } from './tournament-storage.js';
import { node, initials, minutes, confirmChange, confirmingChange } from './ui.js';
import { renderTeams } from './teams-view.js';
import { boxScore, renderReports, csvReport } from './reports.js';
import { createLiveToolbar, clockActionLabel } from './live-toolbar.js';

const storage = appStorage();
const $ = id => document.getElementById(id);
const view = new URLSearchParams(location.search).get('view') || 'control';
const readonly = ['scoreboard', 'overlay'].includes(view);
document.body.className = view;
let storageError = '', storageReadFailure = false, lastActionError = '';
const load = () => {
  try { return readGame(storage); }
  catch (error) { storageReadFailure = true; throw error; }
};
let s;
try { s = load(); } catch (error) { s = initial(); storageError = error.message; }
function reportStorageError(error) {
  storageError = error.message;
  setFeedback(storageError + ' Changes have not been saved.');
}
async function act(fn, expectedGameId = s.gameId) {
  if (readonly) return false;
  lastActionError = '';
  try {
    const expectedRaw = storage.getItem(KEY);
    const next = load();
    if (next.gameId !== expectedGameId) { s = next; render(true); throw new Error('The game changed. Review the current game before trying again.'); }
    tick(next, appNow());
    const result = await fn(next);
    if (result === false) {
      lastActionError = 'Change unavailable. Stop both clocks and check player eligibility or entered values.';
      setFeedback(lastActionError);
      render(true);
      return false;
    }
    await writeGame(storage, next, expectedRaw);
    s = next;
    storageError = ''; storageReadFailure = false;
    setFeedback('');
    render(true);
    return true;
  } catch (error) { lastActionError = error.message; reportStorageError(error); return false; }
}
function button(parent, label, fn, disabled = false) {
  const gameId = s.gameId;
  const b = node('button', label, parent);
  b.type = 'button';
  b.disabled = disabled;
  b.onclick = () => act(fn, gameId);
  return b;
}
function input(parent, label, value, type = 'text') {
  const l = node('label', label, parent), i = node('input', '', l);
  i.type = type; i.value = value;
  return i;
}
function field(parent, label, value, fn, type = 'text') {
  const gameId = s.gameId;
  const i = input(parent, label, value, type);
  i.onchange = () => act(x => fn(x, i.value), gameId);
  return i;
}

let workspace = ['live', 'roster', 'reports', 'journal'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'live', leaderMetric = 'pts';
const app = $('app');
let rulesActions = null;
if (!readonly) {
  const intro = node('div', '', app, 'page-intro');
  const title = node('div', '', intro);
  node('span', 'MATCH OPERATIONS', title, 'eyebrow');
  node('h1', view === 'referee' ? 'Official’s desk' : 'Game desk', title);
  const introActions = node('div', '', intro, 'game-intro-actions');
  node('span', 'LOCAL GAME · MANUAL CONTROL', introActions, 'local-label');
  rulesActions = node('div', '', introActions);
}
const board = node('section', '', app, 'board');
board.setAttribute('aria-label', 'Live scoreboard');
for (const k of ['A', 'clock', 'B']) {
  const panel = node('div', '', board, k === 'clock' ? 'clock-panel' : 'score-team team-' + k);
  if (k !== 'clock') node('span', '', panel, 'score-badge').id = k + 'Badge';
  node('h2', '', panel).id = k + 'Title';
  node('strong', '', panel).id = k + 'Value';
  node('small', '', panel).id = k + 'Meta';
  if (k === 'clock') {
    const shot = node('div', '', panel, 'shot-readout');
    node('span', 'SHOT', shot); node('b', '', shot).id = 'shotValue';
    node('span', '', shot).id = 'gameState';
  }
}
// Break presentation stays in the scoreboard flow; officials keep their controls.
board.after($('break'));
const breakControls = node('div', '', app, 'break-controls');
breakControls.hidden = true;
node('span', '', breakControls).id = 'controlBreakLabel';
breakControls.append($('endBreak'));
board.after(breakControls);
const status = node('p', '', app, 'action-notice');
status.setAttribute('role', 'status'); status.hidden = readonly && !storageError;
status.setAttribute('aria-atomic', 'true');
let feedbackTimer;
function setFeedback(message, success = false) {
  clearTimeout(feedbackTimer); status.textContent = message; status.hidden = readonly && !message;
  status.dataset.kind = success ? 'success' : 'error'; status.classList.toggle('is-visible', !!message);
  if (message && success) feedbackTimer = setTimeout(() => {
    status.classList.remove('is-visible'); feedbackTimer = setTimeout(() => { status.textContent = ''; }, 250);
  }, 3500);
}
if (storageError) setFeedback('Storage error: ' + storageError);
const matchContext = node('div', '', app, 'match-context'); matchContext.hidden = true;
const liveToolbar = readonly ? null : createLiveToolbar(app);
const controls = node('section', '', app, 'clock-controls'), detail = node('section', '', app, 'workspace');
controls.id = 'clock-tools'; controls.tabIndex = -1;
controls.hidden = detail.hidden = readonly;
const broadcastDetail = node('section', '', app, 'broadcast-detail');
broadcastDetail.hidden = view !== 'scoreboard';

// Dialogs live outside the controls so synchronization cannot discard an open form.
const dialog = node('dialog', '', app);
function openDialog(title, triggerId, build, replacement = false) {
  if (readonly) return;
  const gameId = s.gameId;
  dialog.replaceChildren(); dialog.className = '';
  const heading = node('h2', title, dialog); heading.id = 'dialogTitle';
  dialog.setAttribute('aria-labelledby', heading.id);
  const form = node('form', '', dialog);
  const error = node('p', '', form); error.setAttribute('role', 'alert');
  const submit = build(form);
  const actions = node('div', '', form); actions.className = 'dialog-actions';
  const cancel = node('button', 'Cancel', actions); cancel.type = 'button'; cancel.onclick = () => dialog.close();
  const apply = node('button', 'Apply', actions); apply.type = 'submit';
  form.onsubmit = async event => {
    event.preventDefault();
    if (apply.disabled) return;
    apply.disabled = true;
    try {
      if (!replacement && load().gameId !== gameId) { error.textContent = 'The game changed. Close this dialog and review the current game.'; return; }
      lastActionError = '';
      if (await submit()) dialog.close();
      else error.textContent = 'Unable to apply. ' + (lastActionError || 'Stop both clocks; check names, unique jersey numbers, and player eligibility.');
    } catch (e) { error.textContent = e.message; }
    finally { apply.disabled = false; }
  };
  dialog.onclose = () => { render(true); $(triggerId)?.focus({ preventScroll: true }); };
  dialog.showModal();
}
function rosterEditor(k, p, triggerId) {
  openDialog(p ? 'Edit player' : 'Add player', triggerId, form => {
    const name = input(form, 'Name', p?.name || ''); name.required = true; name.maxLength = 80;
    const number = input(form, 'Jersey number', p?.number ?? '');
    number.required = true; number.pattern = '[0-9]{1,2}'; number.maxLength = 2;
    node('p', 'Use a unique jersey number from 0–99 (00 is also accepted). Changes require both clocks stopped.', form);
    return () => act(x => p ? updatePlayer(x, k, p.id, name.value, number.value) : addPlayer(x, k, name.value, number.value));
  });
}
function substitutionDialog(k, p, triggerId) {
  openDialog('Substitute for ' + p.name, triggerId, form => {
    const label = node('label', 'Incoming player', form), select = node('select', '', label);
    select.required = true;
    for (const candidate of s.teams[k].players.filter(q => !q.on && !q.out)) {
      const option = node('option', `#${candidate.number} ${candidate.name}`, select); option.value = candidate.id;
    }
    if (!select.options.length) node('p', 'No eligible bench players. Cancel and use Remove from court to continue with fewer players.', form);
    return () => act(x => substitute(x, k, p.id, select.value));
  });
}
function clockEditor(clock, triggerId) {
  openDialog(clock === 'game' ? 'Set game clock' : 'Set shot clock', triggerId, form => {
    const ms = s[clock];
    const value = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    const time = input(form, 'Time (minutes:seconds.milliseconds)', value);
    time.required = true; time.placeholder = '02:15.500';
    node('p', 'Stop both clocks before applying. Clocks remain stopped after correction.', form);
    return () => {
      const parsed = parseClock(time.value);
      if (parsed === null) return false;
      return act(x => setClock(x, clock, parsed));
    };
  });
}
function rulesEditor(triggerId) {
  const original = JSON.stringify(gameRules(s));
  openDialog('Game rules', triggerId, form => {
    const values = buildGameRulesForm(form, s);
    return async () => {
      const rules = values();
      const applied = await act(next => {
        if (JSON.stringify(gameRules(next)) !== original) throw new Error('Game rules changed in another tab. Close this dialog and review them again.');
        return applyGameRules(next, rules);
      });
      if (applied) setFeedback('Game rules saved. Both clocks remain stopped.', true);
      return applied;
    };
  });
  dialog.className = 'game-rules-dialog';
}
function dialogButton(parent, label, id, handler, disabled = false) {
  const gameId = s.gameId;
  const b = node('button', label, parent);
  b.type = 'button'; b.id = id; b.disabled = disabled; b.onclick = () => {
    if (s.gameId !== gameId) { render(true); setFeedback('The game changed. Review the current game before trying again.'); return; }
    handler(id);
  };
  return b;
}

function download(text, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = node('a', '', document.body);
  link.href = url; link.download = filename; link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBackup() {
  if (readonly) return;
  try {
    let json, recovery = false;
    try { json = exportGame(load(), appNow()); }
    catch {
      json = storage.getItem(KEY);
      if (json === null) throw new Error('No stored game is available.');
      recovery = true;
    }
    download(json, recovery ? 'basketball-recovery.json' : 'basketball-game.json');
    setFeedback(recovery ? 'Stored data downloaded for recovery. It is not a validated game backup.' : 'Game backup downloaded. The live game was not changed.', !recovery);
  } catch (error) { reportStorageError(error); }
}
function importDialog(triggerId) {
  openDialog('Import game backup', triggerId, form => {
    node('p', 'Import replaces this game. Export the current game first. Both clocks must be stopped; imported clocks stay stopped.', form);
    const backup = node('button', 'Export current game first', form);
    backup.type = 'button'; backup.onclick = exportBackup;
    const file = input(form, 'JSON backup', '', 'file'); file.accept = '.json,application/json'; file.required = true;
    const preview = node('p', 'Choose a backup to review.', form); preview.setAttribute('role', 'status');
    let pending = null;
    file.onchange = async () => {
      pending = null;
      const selected = file.files[0];
      if (!selected) return;
      try {
        if (selected.size > MAX_BACKUP_BYTES) throw new Error('Choose a JSON backup smaller than 2 MB.');
        const json = await selected.text(), imported = importGame(json, appNow());
        if (file.files[0] !== selected) return;
        pending = json;
        preview.textContent = `${imported.teams.A.name} ${imported.teams.A.score} – ${imported.teams.B.score} ${imported.teams.B.name}. Q${imported.quarter}, ${format(imported.game, true)}. Rosters: ${imported.teams.A.players.length} / ${imported.teams.B.players.length}. Both clocks will be stopped.`;
      } catch (error) { if (file.files[0] === selected) preview.textContent = error.message; }
    };
    return async () => {
      if (!pending) return false;
      try {
        // A corrupt saved game can also be explicitly replaced through this confirmation.
        const expectedRaw = storage.getItem(KEY);
        let current;
        try { current = load(); } catch { current = null; }
        if (current && (current.running || current.shotRunning)) {
          preview.textContent = 'Stop both clocks before importing.';
          return false;
        }
        const imported = importGame(pending, appNow());
        if (!await confirmChange('Replace the current game with the backup shown above? Current scores, roster and play-by-play will be replaced.')) return false;
        await writeGame(storage, imported, expectedRaw);
        s = imported; storageError = ''; storageReadFailure = false; setFeedback('Game imported. Both clocks are stopped.', true);
        render(true);
        return true;
      } catch (error) { preview.textContent = error.message; return false; }
    };
  }, true);
}

function renderControls() {
  controls.replaceChildren();
  liveToolbar.actions.replaceChildren();
  rulesActions.replaceChildren();
  const moving = s.running || s.shotRunning;
  const game = node('div', '', controls, 'control-group game-controls');
  node('h2', 'Game clock', game);
  const main = liveToolbar.actions;
  const blocked = !!s.break || s.game <= 0 || Object.values(s.teams).some(team => team.players.some(player => player.on && player.out));
  const startLabel = s.shotEnabled ? 'Start game + shot' : 'Start game';
  const startButton = button(main, startLabel, start, blocked); startButton.className = 'primary'; clockActionLabel(startButton, startLabel, 'Start');
  const stopButton = button(main, 'Stop both clocks', stop); stopButton.className = 'stop-button'; clockActionLabel(stopButton, 'Stop both clocks', 'Stop');
  const resetButton = button(main, 'Reset shot ' + s.shotDefault, x => resetShotClock(x), !!s.break || !s.shotEnabled); resetButton.className = 'toolbar-reset'; clockActionLabel(resetButton, 'Reset shot ' + s.shotDefault, 'Reset ' + s.shotDefault);
  const adjustments = node('div', '', game, 'secondary-actions');
  for (const n of [-5, -1, 1, 5, 60]) button(adjustments, `${n > 0 ? '+' : ''}${n}s game`, x => setClock(x, 'game', Math.max(0, x.game + n * 1000)), moving || !!s.break);
  dialogButton(adjustments, 'Set game time…', 'setGame', id => clockEditor('game', id), moving || !!s.break);
  const shot = node('div', '', controls, 'control-group shot-controls');
  node('h2', 'Shot clock', shot);
  const shotActions = node('div', '', shot, 'primary-actions');
  button(shotActions, 'Start shot only', startShotClock, !s.shotEnabled); button(shotActions, 'Stop shot only', stopShotClock, !s.shotEnabled);
  const resets = node('div', '', shot, 'secondary-actions');
  if (s.shotReset !== s.shotDefault) button(resets, 'Reset shot ' + s.shotReset, x => resetShotClock(x, x.shotReset * 1000), !!s.break || !s.shotEnabled);
  dialogButton(resets, 'Set shot time…', 'setShot', id => clockEditor('shot', id), moving || !!s.break || !s.shotEnabled);
  const match = node('div', '', controls, 'control-group match-controls');
  node('h2', 'Game management', match);
  button(match, 'Possession', x => possession(x, x.possession === 'A' ? 'B' : 'A'));
  button(match, 'Next period', nextPeriod, s.quarter >= s.periods || !!s.break);
  button(match, 'Halftime', x => beginBreak(x, 'HALFTIME', x.halftime * 60, appNow()), s.halftime === 0 || !!s.break);
  dialogButton(rulesActions, 'Game rules…', 'editRules', rulesEditor, moving || !!s.break).className = 'rules-button';
  const settings = node('details', '', match, 'game-settings'); node('summary', 'Game settings & reset', settings);
  const halftime = field(settings, 'Halftime minutes', s.halftime, (x, v) => {
    const minutes = Number(v);
    if (!v.trim() || !Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440) return false;
    return applyGameRules(x, { ...gameRules(x), halftime: minutes });
  }, 'number'); halftime.min = 0; halftime.max = 1440; halftime.step = 1; halftime.disabled = moving || !!s.break;
  button(settings, 'Reset game (keep rosters)', async x => {
    if (!await confirmChange('Start a new game? Scores, stats, fouls, timeouts and play-by-play will reset. Team names, rosters and settings are kept.')) return false;
    resetGame(x);
  }).className = 'text-danger';
  node('p', gameRulesSummary(s), match, 'game-rules-summary');
}
function setWorkspace(value) { workspace = value; const url = new URL(location.href); url.hash = value; history.replaceState(null, '', url); render(true); }
function renderWorkspace(display) {
  detail.replaceChildren();
  const toolbar = node('div', '', detail, 'workspace-toolbar');
  const tabs = node('div', '', toolbar, 'workspace-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Game workspace');
  const choices = [['live', 'Live scoring'], ['roster', 'Roster'], ['reports', 'Reports'], ['journal', 'Play-by-play']];
  for (const [key, label] of choices) {
    const tab = node('button', label, tabs); tab.type = 'button'; tab.id = key + '-tab'; tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(workspace === key)); tab.tabIndex = workspace === key ? 0 : -1;
    tab.setAttribute('aria-controls', 'workspace-panel'); tab.onclick = () => setWorkspace(key);
    tab.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = choices.findIndex(([id]) => id === key);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + choices.length) % choices.length;
      setWorkspace(choices[next][0]); $(choices[next][0] + '-tab').focus();
    };
  }
  const files = node('div', '', toolbar, 'backup-actions');
  dialogButton(files, 'Export game', 'exportGame', exportBackup);
  dialogButton(files, 'Import game…', 'importGame', importDialog);
  const panel = node('div', '', detail, 'workspace-panel'); panel.id = 'workspace-panel';
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', workspace + '-tab');
  if (workspace === 'live' || workspace === 'roster') {
    const hint = node('div', '', panel, 'workspace-hint');
    node('span', workspace === 'live' ? 'ON-COURT TRACKING' : 'ROSTER MANAGEMENT', hint, 'eyebrow');
    node('span', workspace === 'live' ? 'Score a basket on the player’s row. Rebounds, assists, steals, blocks and fouls: tap +.' : 'Set your rotation. Stop both clocks before making lineup changes.', hint);
    renderTeams(panel, s, { mode: workspace, button, dialogButton, field, rosterEditor, substitutionDialog });
  } else if (workspace === 'reports') {
    renderReports(panel, display, {
      metric: leaderMetric,
      setMetric: value => { leaderMetric = value; render(true); },
      csv: () => {
        try { const current = load(); tick(current, appNow()); download(csvReport(current), 'basketball-box-score.csv', 'text/csv;charset=utf-8'); }
        catch (error) { reportStorageError(error); }
      },
    });
  } else {
    node('span', 'GAME JOURNAL', panel, 'eyebrow'); node('h2', 'Every play, in order.', panel);
    field(panel, 'Add note (Enter or blur)', '', (x, v) => { if (v.trim()) note(x, v); });
    const log = node('ol', '', panel, 'journal-list');
    for (const entry of s.log) {
      const item = node('li', '', log);
      const end = entry.indexOf(']');
      node('span', end >= 0 ? entry.slice(1, end) : 'NOTE', item, 'journal-time');
      node('p', end >= 0 ? entry.slice(end + 1).trim() : entry, item);
    }
    if (!s.log.length) node('p', 'Ready for tip-off. Scores, stats and official notes will appear here.', panel, 'empty-state');
  }
}
function render(full = false) {
  const display = structuredClone(s);
  tick(display, appNow());
  liveToolbar?.render(display);
  for (const k of ['A', 'B']) {
    const t = display.teams[k];
    $(k + 'Title').textContent = t.name;
    $(k + 'Badge').textContent = initials(t.name);
    $(k + 'Value').textContent = t.score;
    $(k + 'Meta').textContent = `Fouls ${t.fouls} • TO ${t.timeouts}${display.possession === k ? ' • POS' : ''}`;
    $(k + 'Value').parentElement.classList.toggle('has-possession', display.possession === k);
  }
  $('clockTitle').textContent = periodLabel(display);
  $('clockValue').textContent = format(display.game, display.game < 60000);
  $('clockMeta').textContent = `Game ${display.running ? 'running' : 'stopped'} • Shot ${!display.shotEnabled ? 'disabled' : display.shotRunning ? 'running' : 'stopped'}`;
  $('shotValue').textContent = display.shotEnabled ? Math.ceil(display.shot / 1000) : 'OFF';
  $('shotValue').classList.toggle('shot-warning', display.shotEnabled && display.shot <= 5000);
  $('gameState').textContent = display.violation ? 'VIOLATION' : display.break ? 'BREAK' : display.running ? 'LIVE' : 'STOPPED';
  board.classList.toggle('is-running', display.running);
  board.classList.toggle('is-violation', display.violation);
  $('break').hidden = view !== 'scoreboard' || !display.break;
  breakControls.hidden = readonly || !display.break;
  document.body.classList.toggle('on-break', !!display.break);
  if (display.break) {
    $('breakLabel').textContent = display.break.label;
    $('controlBreakLabel').textContent = display.break.label + ' · Clocks paused. Restart manually after the break.';
    $('breakTime').textContent = format(display.break.end - appNow());
  }
  $('endBreak').hidden = readonly;
  for (const summary of controls.querySelectorAll('.game-rules-summary')) summary.textContent = gameRulesSummary(display);
  for (const cell of document.querySelectorAll('[data-minutes]')) {
    const player = Object.values(display.teams).flatMap(t => t.players).find(p => p.id === cell.dataset.minutes);
    if (player) cell.textContent = minutes(player.ms);
  }
  for (const cell of document.querySelectorAll('[data-team-minutes]')) {
    const players = display.teams[cell.dataset.teamMinutes].players.filter(p => cell.dataset.courtOnly !== 'true' || p.on);
    cell.textContent = minutes(players.reduce((sum, p) => sum + p.ms, 0));
  }
  if (!full) return;
  if (readonly) {
    if (view === 'scoreboard') { broadcastDetail.replaceChildren(); boxScore(broadcastDetail, display, { courtOnly: true }); }
    return;
  }
  matchContext.hidden = !s.matchLink;
  matchContext.replaceChildren();
  if (s.matchLink) {
    let label = 'Tournament match · ' + s.matchLink.matchId;
    try { const tournament = readTournament(storage); const match = tournament.matches.find(m => m.id === s.matchLink.matchId && tournament.id === s.matchLink.tournamentId); if (match) label += match.status === 'final' ? ' · Result recorded. Record again if scores change.' : ' · Result not yet recorded.'; } catch {}
    node('span', label, matchContext);
    const link = node('a', 'Record result / manage matches →', matchContext); link.href = '/?view=tournament#matches';
  }
  const focused = document.activeElement;
  const focusKey = focused?.id || focused?.dataset.focusKey;
  // Preserve open control menus during scoring and clock updates.
  const openMenus = [...document.querySelectorAll('details[open]')].map(e => e.querySelector('summary')?.textContent);
  renderControls();
  if (view !== 'referee') renderWorkspace(display);
  for (const menu of document.querySelectorAll('details')) if (openMenus.includes(menu.querySelector('summary')?.textContent)) menu.open = true;
  for (const element of app.querySelectorAll('button, input, select')) {
    const owner = element.closest('[data-player-id]')?.dataset.playerId || element.closest('.team-workspace')?.className || '';
    element.dataset.focusKey = owner + ':' + (element.getAttribute('aria-label') || element.closest('label')?.firstChild?.textContent || element.textContent);
  }
  if (focusKey && !dialog.open) {
    const target = $(focusKey) || [...app.querySelectorAll('[data-focus-key]')].find(e => e.dataset.focusKey === focusKey);
    target?.focus({ preventScroll: true });
  }
}

$('endBreak').onclick = () => act(x => {
  if (x.break) note(x, x.break.label + ' ended early');
  stop(x); x.break = null;
});
window.addEventListener('hashchange', () => {
  const tab = location.hash.slice(1);
  if (!readonly && view !== 'referee' && ['live', 'roster', 'reports', 'journal'].includes(tab) && tab !== workspace) { workspace = tab; render(true); }
});
window.addEventListener('storage', e => {
  if (e.key === KEY || e.key === null) {
    try {
      s = load();
      if (storageReadFailure) { storageReadFailure = false; storageError = ''; setFeedback(''); }
      render(!document.activeElement.matches('input'));
    }
    catch (error) { reportStorageError(error); }
  }
});
let clockSavePending = false;
setInterval(async () => {
  if (!readonly && !confirmingChange() && !clockSavePending) {
    try {
      const expectedRaw = storage.getItem(KEY);
      const next = load();
      if (next.running || next.shotRunning || next.break) {
        tick(next, appNow());
        // Timestamps drive the display. Save only the transition at expiration;
        // normal countdown frames never rewrite another official's actions.
        const ended = !next.running && !next.shotRunning && !next.break;
        if (ended) { clockSavePending = true; try { await writeGame(storage, next, expectedRaw); } finally { clockSavePending = false; } }
        s = next;
        if (ended) render(true);
      } else { s = next; }
    } catch (error) { reportStorageError(error); }
  }
  render(false);
}, 100);
render(true);
