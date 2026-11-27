import { node, initials, confirmChange } from './ui.js';
import { boxScore } from './reports.js';
import { tick, KEY } from './engine.js';
import { readGame, writeGame } from './storage.js';
import { initialTournament, saveTeam, deleteTeam, savePlayer, deletePlayer, saveMatch, deleteMatch, setMatchStatus, recordResult, standings, prepareMatchGame, matchById, teamById } from './tournament.js';
import { TOURNAMENT_KEY, MAX_TOURNAMENT_BYTES, readTournament, writeTournament, exportTournament, importTournament } from './tournament-storage.js';

export function mountTournament(app) {
  document.body.className = 'tournament';
  document.getElementById('break').hidden = true;
  let data = initialTournament(), section = ['teams', 'matches', 'standings'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'teams', filter = 'all';
  function rememberSection() { const url = new URL(location.href); url.hash = section; history.replaceState(null, '', url); }
  const notice = node('p', '', app, 'tournament-notice'); notice.setAttribute('role', 'status');
  const shell = node('div', '', app), dialog = node('dialog', '', app);
  const notify = message => { notice.textContent = message; };
  try { data = readTournament(localStorage); } catch (error) { notify(error.message); }
  function update(fn) {
    const expectedRaw = localStorage.getItem(TOURNAMENT_KEY);
    const next = readTournament(localStorage); fn(next); writeTournament(localStorage, next, expectedRaw); data = next; render();
  }
  async function run(fn) { try { await fn(); notify(''); } catch (error) { notify(error.message); } }
  async function confirmed(message, fn) {
    const expectedRaw = localStorage.getItem(TOURNAMENT_KEY);
    if (!await confirmChange(message)) return;
    if (localStorage.getItem(TOURNAMENT_KEY) !== expectedRaw) throw new Error('The tournament changed. Review the latest data before trying again.');
    return fn();
  }
  function action(parent, label, fn, className = '') {
    const b = node('button', label, parent, className); b.type = 'button'; b.onclick = () => run(fn); return b;
  }
  function field(parent, label, value = '', type = 'text') {
    const wrap = node('label', label, parent), input = node('input', '', wrap); input.type = type; input.value = value; return input;
  }
  function select(parent, label, options, value) {
    const wrap = node('label', label, parent), input = node('select', '', wrap);
    for (const [id, text] of options) { const option = node('option', text, input); option.value = id; }
    if (value != null) input.value = value; return input;
  }
  function form(title, build, submitLabel = 'Save') {
    const trigger = document.activeElement;
    const expectedRaw = localStorage.getItem(TOURNAMENT_KEY);
    dialog.replaceChildren(); const h = node('h2', title, dialog); h.id = 'tournament-dialog-title'; dialog.setAttribute('aria-labelledby', h.id);
    const body = node('form', '', dialog), error = node('p', '', body); error.setAttribute('role', 'alert');
    const submit = build(body);
    const buttons = node('div', '', body, 'dialog-actions'); action(buttons, 'Cancel', () => dialog.close());
    const save = node('button', submitLabel, buttons); save.type = 'submit';
    body.onsubmit = async event => {
      event.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      try {
        if (localStorage.getItem(TOURNAMENT_KEY) !== expectedRaw) throw new Error('The tournament changed. Close this dialog and review the latest data.');
        await submit(); dialog.close(); notify('');
      } catch (e) { error.textContent = e.message; }
      finally { save.disabled = false; }
    };
    dialog.onclose = () => { render(); if (trigger?.isConnected) trigger.focus(); else shell.querySelector('[aria-selected=true]')?.focus(); };
    dialog.showModal();
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = node('a', '', document.body); link.href = url; link.download = name; link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function backup() {
    let json, name = 'courtside-tournament.json';
    try { json = exportTournament(readTournament(localStorage)); }
    catch { json = localStorage.getItem(TOURNAMENT_KEY); if (json === null) throw new Error('No stored tournament is available.'); name = 'courtside-tournament-recovery.json'; }
    download(json, name);
  }
  function game() { const current = readGame(localStorage); tick(current, Date.now()); return current; }
  function linked(current, match) { return current.matchLink?.tournamentId === data.id && current.matchLink?.matchId === match.id; }
  function guardActive(id) {
    const current = game();
    if (current.matchLink?.tournamentId === data.id && current.matchLink.matchId === id) throw new Error('This match is on the game desk. Record its result and load the next match, or explicitly reset the game before changing its schedule.');
  }
  function editTeam(team = null) {
    form(team ? 'Edit team' : 'Add team', body => {
      const name = field(body, 'Team name', team?.name || ''); name.required = true; name.maxLength = 80;
      return () => update(t => saveTeam(t, team?.id, name.value));
    }, 'Save team');
  }
  function editPlayer(team, player = null) {
    form(player ? 'Edit directory player' : 'Add directory player', body => {
      node('p', team.name + ' · Directory changes apply when loading a new match. A game already on the desk keeps its roster and eligibility.', body);
      const name = field(body, 'Player name', player?.name || ''); name.required = true; name.maxLength = 80;
      const number = field(body, 'Jersey number', player?.number || ''); number.required = true; number.pattern = '[0-9]{1,2}'; number.maxLength = 2;
      return () => update(t => savePlayer(t, team.id, player?.id, name.value, number.value));
    }, 'Save player');
  }
  function editMatch(match = null) {
    form(match ? 'Edit match' : 'Schedule match', body => {
      const choices = data.teams.map(team => [team.id, team.name]);
      const home = select(body, 'Home team', choices, match?.homeId || choices[0]?.[0]);
      const away = select(body, 'Away team', choices, match?.awayId || choices[1]?.[0]);
      let localDate = '';
      if (match?.scheduledAt) { const d = new Date(match.scheduledAt); localDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
      const time = field(body, 'Start time (your local time, optional)', localDate, 'datetime-local');
      const court = field(body, 'Court / venue (optional)', match?.court || ''); court.maxLength = 80;
      return () => {
        if (match) guardActive(match.id);
        update(t => saveMatch(t, match?.id, { homeId: home.value, awayId: away.value, scheduledAt: time.value ? new Date(time.value).toISOString() : '', court: court.value }));
      };
    }, 'Save match');
  }
  function resultForm(match, useDesk) {
    const snapshot = useDesk ? game() : null;
    form(useDesk ? 'Record game desk result' : 'Enter final score', body => {
      node('p', `${teamById(data, match.homeId).name} vs ${teamById(data, match.awayId).name}`, body);
      node('p', useDesk ? 'Review the final score. Stop both clocks and end any break before recording. Player statistics will be saved with this result.' : 'Manual results update standings without player statistics. A final score must have a winner.', body);
      const home = field(body, 'Home final score', snapshot?.teams.A.score ?? match.result?.homeScore ?? '', 'number');
      const away = field(body, 'Away final score', snapshot?.teams.B.score ?? match.result?.awayScore ?? '', 'number');
      for (const input of [home, away]) { input.required = true; input.min = 0; input.step = 1; input.readOnly = useDesk; }
      return () => update(t => {
        const latest = matchById(t, match.id), current = game();
        if (latest.homeId !== match.homeId || latest.awayId !== match.awayId) throw new Error('Match teams changed. Close and review the match again.');
        if (!useDesk && current.matchLink?.tournamentId === t.id && current.matchLink.matchId === match.id) throw new Error('This match is now on the game desk. Close and use Record game desk result.');
        recordResult(t, match.id, Number(home.value), Number(away.value), Date.now(), useDesk ? current : null);
      });
    }, match.status === 'final' ? 'Update final result' : 'Record final result');
  }
  function loadMatch(match) {
    const previewTeams = [match.homeId, match.awayId].map(id => structuredClone(teamById(data, id)));
    form('Load match onto game desk', body => {
      node('p', `${teamById(data, match.homeId).name} vs ${teamById(data, match.awayId).name}`, body);
      for (const id of [match.homeId, match.awayId]) { const team = teamById(data, id); node('p', `${team.name}: ${team.players.length} registered players. First five start on court.`, body); }
      node('p', 'Loading starts a new game with these rosters and your current clock/rule settings. Current scores and statistics will be replaced. Export the current game first if you need it.', body);
      const link = node('a', 'Open game desk to export current game ↗', body); link.href = '/'; link.target = '_blank'; link.rel = 'noopener';
      return () => {
        const expectedGame = localStorage.getItem(KEY);
        const latest = readTournament(localStorage), latestMatch = matchById(latest, match.id);
        if (latestMatch.homeId !== match.homeId || latestMatch.awayId !== match.awayId || JSON.stringify(previewTeams) !== JSON.stringify([latestMatch.homeId, latestMatch.awayId].map(id => teamById(latest, id)))) throw new Error('Teams or rosters changed. Close and review this match again.');
        const next = prepareMatchGame(latest, match.id, game());
        writeGame(localStorage, next, expectedGame); location.href = '/';
      };
    }, 'Load new game');
  }
  function importBackup() {
    form('Import tournament backup', body => {
      node('p', 'This replaces the team directory, schedule, results and standings. Export your current tournament first. Finish/reset any linked game before importing.', body);
      action(body, 'Export tournament first', backup);
      const input = field(body, 'Tournament JSON backup', '', 'file'); input.accept = '.json,application/json'; input.required = true;
      const preview = node('p', 'Choose a backup to review.', body); preview.setAttribute('role', 'status'); let json = null;
      input.onchange = async () => {
        json = null; const file = input.files[0]; if (!file) return;
        try {
          if (file.size > MAX_TOURNAMENT_BYTES) throw new Error('Choose a tournament backup smaller than 4 MB.');
          const text = await file.text(), t = importTournament(text);
          if (input.files[0] !== file) return;
          json = text; preview.textContent = `${t.name} · ${t.teams.length} teams · ${t.matches.length} matches. All current tournament data will be replaced.`;
        } catch (error) { if (input.files[0] === file) preview.textContent = error.message; }
      };
      return async () => {
        if (!json) throw new Error('Choose a valid tournament backup.');
        const expectedRaw = localStorage.getItem(TOURNAMENT_KEY), expectedGame = localStorage.getItem(KEY);
        if (game().matchLink) throw new Error('Reset or finish and reset the linked game before importing a tournament.');
        const next = importTournament(json);
        if (!await confirmChange('Replace the current tournament with the backup shown above?')) throw new Error('Import cancelled. Current tournament was preserved.');
        if (localStorage.getItem(KEY) !== expectedGame) throw new Error('The game desk changed. Close and review the linked game before importing.');
        writeTournament(localStorage, next, expectedRaw); data = next; render();
      };
    }, 'Replace tournament');
  }
  function renderTeams(parent) {
    const tools = node('div', '', parent, 'tournament-section-top'); node('h2', 'Team directory', tools);
    action(tools, 'Add team', () => editTeam(), 'primary');
    action(tools, 'Copy game desk teams', () => confirmed('Copy both game desk teams and player names/numbers into the directory? Existing directory teams will be kept. Live game statistics will not change.', () => {
      const current = game();
      update(t => {
        for (const team of Object.values(current.teams)) {
          saveTeam(t, null, team.name); const added = t.teams.at(-1);
          for (const p of team.players) savePlayer(t, added.id, null, p.name, p.number);
        }
      });
    }));
    node('p', 'Build reusable rosters here. Changes apply to future match loads; active games and recorded box scores keep their own player snapshots.', parent, 'muted tournament-help');
    const grid = node('div', '', parent, 'directory-grid');
    for (const team of data.teams) {
      const card = node('article', '', grid, 'directory-team'); card.dataset.teamId = team.id;
      const top = node('header', '', card); node('span', initials(team.name), top, 'team-badge'); node('h3', team.name, top); node('span', team.players.length + ' players', top, 'muted');
      const actions = node('div', '', card, 'directory-actions');
      action(actions, 'Add player', () => editPlayer(team)); action(actions, 'Edit team', () => editTeam(team));
      action(actions, 'Delete team', () => confirmed('Delete ' + team.name + '? Teams referenced by matches cannot be deleted.', () => update(t => deleteTeam(t, team.id))), 'text-danger');
      const roster = node('details', '', card); roster.open = data.teams.length <= 4; node('summary', `Roster · ${team.players.length} players`, roster);
      for (const p of team.players) {
        const row = node('div', '', roster, 'directory-player'); row.dataset.playerId = p.id;
        node('span', '#' + p.number, row, 'jersey'); node('strong', p.name, row);
        action(row, 'Edit player', () => editPlayer(team, p));
        action(row, 'Delete player', () => confirmed('Remove ' + p.name + ' from the directory? Existing game snapshots will be kept.', () => update(t => deletePlayer(t, team.id, p.id))), 'text-danger');
      }
      if (!team.players.length) node('p', 'Add players before loading this team into a match.', roster, 'empty-state');
    }
    if (!data.teams.length) node('p', 'Create your first team, or copy the two teams already on the game desk.', grid, 'empty-state');
  }
  function renderMatches(parent) {
    const tools = node('div', '', parent, 'tournament-section-top'); node('h2', 'Match schedule', tools);
    action(tools, 'Schedule match', () => editMatch(), 'primary').disabled = data.teams.length < 2;
    const filterSelect = select(tools, 'Show matches', [['all', 'All matches'], ['scheduled', 'Scheduled'], ['final', 'Final'], ['cancelled', 'Cancelled']], filter);
    filterSelect.onchange = () => { filter = filterSelect.value; render(); };
    if (data.teams.length < 2) node('p', 'Add at least two teams to start scheduling.', parent, 'empty-state');
    let current = null; try { current = game(); } catch (error) { notify(error.message); }
    const list = node('div', '', parent, 'match-list');
    const matches = data.matches.filter(m => filter === 'all' || m.status === filter).sort((a, b) => (a.scheduledAt || '9999').localeCompare(b.scheduledAt || '9999') || a.id.localeCompare(b.id));
    for (const m of matches) {
      const card = node('article', '', list, 'match-card'); card.dataset.matchId = m.id;
      const active = current && linked(current, m);
      const meta = node('div', '', card, 'match-meta'); node('span', m.status.toUpperCase() + (active ? ' · ON GAME DESK' : ''), meta, m.status === 'final' ? 'active-label' : 'eyebrow');
      node('span', `${m.scheduledAt ? new Date(m.scheduledAt).toLocaleString() : 'Time to be decided'}${m.court ? ' · ' + m.court : ''}`, meta, 'muted');
      const title = node('h3', '', card, 'match-title'); node('span', teamById(data, m.homeId).name, title);
      node('b', m.result ? `${m.result.homeScore} – ${m.result.awayScore}` : 'vs', title); node('span', teamById(data, m.awayId).name, title);
      const actions = node('div', '', card, 'match-actions');
      if (active) { const open = node('a', 'Open game desk ↗', actions, 'button-link'); open.href = '/'; }
      else if (m.status === 'scheduled') action(actions, 'Load game desk', () => loadMatch(m), 'primary');
      if (m.status !== 'cancelled') action(actions, active ? 'Record game desk result' : m.status === 'final' ? 'Correct result' : 'Enter result', () => resultForm(m, active));
      if (m.status === 'scheduled') {
        action(actions, 'Edit match', () => editMatch(m));
        action(actions, 'Cancel match', () => { guardActive(m.id); return confirmed('Cancel this match? It will not count in standings.', () => update(t => { guardActive(m.id); setMatchStatus(t, m.id, 'cancelled'); })); });
      } else {
        action(actions, m.status === 'final' ? 'Reopen match' : 'Restore match', () => {
          guardActive(m.id); return confirmed('Return this match to scheduled? Its final result and box score, if any, will be cleared from standings.', () => update(t => { guardActive(m.id); setMatchStatus(t, m.id, 'scheduled'); }));
        });
      }
      if (m.status !== 'final') action(actions, 'Delete match', () => { guardActive(m.id); return confirmed('Delete this match from the schedule?', () => update(t => { guardActive(m.id); deleteMatch(t, m.id); })); }, 'text-danger');
      if (m.result?.game) { const details = node('details', '', card, 'saved-boxscore'); node('summary', 'Recorded box score', details); boxScore(details, m.result.game); }
      else if (m.result) node('p', 'Manual result · No player statistics recorded.', card, 'muted tournament-help');
    }
    if (!matches.length) node('p', 'No matches in this view.', list, 'empty-state');
  }
  function renderStandings(parent) {
    node('h2', 'Tournament standings', parent);
    node('p', 'Final results only. Ranked by win percentage, point difference, then points scored. Teams level on all three share a rank; names determine display order. Ties must be resolved before finalizing a game.', parent, 'muted tournament-help');
    const scroll = node('div', '', parent, 'table-scroll standings-table'); const table = node('table', '', scroll);
    node('caption', data.name + ' · Standings', table);
    const row = node('tr', '', node('thead', '', table));
    for (const label of ['Rank', 'Team', 'GP', 'W', 'L', 'WIN %', 'PF', 'PA', '+/−']) node('th', label, row).scope = 'col';
    const body = node('tbody', '', table);
    for (const r of standings(data)) {
      const row = node('tr', '', body); row.dataset.teamId = r.id;
      for (const value of [r.rank, r.name, r.played, r.wins, r.losses, r.played ? (r.pct * 100).toFixed(1) + '%' : '—', r.pf, r.pa, r.diff > 0 ? '+' + r.diff : r.diff]) node('td', value, row);
    }
    if (!data.teams.length) node('p', 'Add teams and finalize match results to build the standings.', parent, 'empty-state');
  }
  function render() {
    shell.replaceChildren();
    const intro = node('div', '', shell, 'page-intro'); const title = node('div', '', intro); node('span', 'TOURNAMENT OPERATIONS', title, 'eyebrow'); node('h1', data.name, title);
    const tools = node('div', '', intro, 'tournament-tools');
    action(tools, 'Rename tournament', () => form('Rename tournament', body => { const name = field(body, 'Tournament name', data.name); name.required = true; name.maxLength = 80; return () => update(t => { t.name = name.value.trim(); }); }));
    action(tools, 'Export tournament', backup); action(tools, 'Import tournament', importBackup);
    const stats = node('div', '', shell, 'tournament-stats');
    for (const [n, label] of [[data.teams.length, 'TEAMS'], [data.teams.reduce((n, t) => n + t.players.length, 0), 'PLAYERS'], [data.matches.filter(m => m.status === 'scheduled').length, 'SCHEDULED'], [data.matches.filter(m => m.status === 'final').length, 'FINAL RESULTS']]) { const item = node('div', '', stats); node('strong', n, item); node('span', label, item); }
    const tabs = node('div', '', shell, 'workspace-tabs tournament-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Tournament workspace');
    for (const [id, title] of [['teams', 'Teams & players'], ['matches', 'Matches'], ['standings', 'Standings']]) {
      const tab = action(tabs, title, () => { section = id; rememberSection(); render(); shell.querySelector('[aria-selected=true]')?.focus(); }); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(id === section));
      tab.id = 'tournament-' + id; tab.setAttribute('aria-controls', 'tournament-panel'); tab.tabIndex = id === section ? 0 : -1;
      tab.onkeydown = event => {
        const keys = ['teams', 'matches', 'standings'];
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const i = keys.indexOf(id);
        section = keys[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (i + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3];
        rememberSection();
        render(); shell.querySelector('[aria-selected=true]')?.focus();
      };
    }
    const panel = node('div', '', shell, 'tournament-panel'); panel.id = 'tournament-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'tournament-' + section);
    if (section === 'teams') renderTeams(panel); else if (section === 'matches') renderMatches(panel); else renderStandings(panel);
  }
  window.addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (['teams', 'matches', 'standings'].includes(tab) && tab !== section) { section = tab; render(); }
  });
  window.addEventListener('storage', event => {
    if (event.key === TOURNAMENT_KEY || event.key === KEY || event.key === null) {
      try { data = readTournament(localStorage); if (!dialog.open) render(); } catch (error) { notify(error.message); }
    }
  });
  render();
}
