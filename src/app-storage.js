import { node } from './ui.js';
import { KEY, tick, stop } from './engine.js';
import { validateState, exportGame } from './game-transfer.js';
import { TOURNAMENT_KEY, exportTournament } from './tournament-storage.js';
import { validateTournament } from './tournament.js';
import { SharedStorage } from './shared-storage.js';

let selected = null;
export const appStorage = () => selected || localStorage;
export const appNow = () => selected?.now ? selected.now() : Date.now();
const params = () => new URLSearchParams(location.search);
const readOnlyView = () => ['scoreboard', 'overlay', 'players'].includes(params().get('view'));
async function request(path, options = {}) {
  let response;
  try { response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: AbortSignal.timeout(12000), ...(options.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) } : {}) }); }
  catch { throw new Error('Could not confirm the database request. Reconnect and review the shared state before trying again.'); }
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Database request failed.'); error.status = response.status; throw error; }
  return data;
}
function localLink(label, parent, shared = false) {
  const link = node('a', label, parent, 'button-link'), url = new URL(location.href);
  url.searchParams.set('storage', shared ? 'shared' : 'local');
  link.href = url; return link;
}
function setupPanel(title, text) {
  const root = document.getElementById('app'); root.replaceChildren();
  const panel = node('section', '', root, 'database-setup'); node('span', 'COURTSIDE · SHARED STORAGE', panel, 'eyebrow'); node('h1', title, panel); node('p', text, panel); return panel;
}
async function signIn() {
  const panel = setupPanel('Connect to Courtside', readOnlyView() ? 'Enter the access password to open this display. Display access cannot save changes.' : 'Enter your operator password to manage the shared game and tournament.');
  const form = node('form', '', panel), label = node('label', 'Access password', form), password = node('input', '', label);
  password.type = 'password'; password.required = true; password.autocomplete = 'current-password'; password.maxLength = 1024;
  const error = node('p', '', form); error.setAttribute('role', 'alert');
  const submit = node('button', 'Sign in', form, 'primary'); submit.type = 'submit';
  localLink('Use this device’s local data', panel);
  await new Promise(resolve => {
    form.onsubmit = async event => {
      event.preventDefault(); if (submit.disabled) return; submit.disabled = true; error.textContent = '';
      try { await request('/api/session', { method: 'POST', body: { password: password.value, role: readOnlyView() ? 'viewer' : 'operator' } }); password.value = ''; resolve(); }
      catch (e) { password.value = ''; error.textContent = e.message; submit.disabled = false; password.focus(); }
    };
  });
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = node('a', '', document.body); a.href = url; a.download = name; a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function chooseSharedData(storage) {
  if (readOnlyView() || sessionStorage.getItem('courtside_shared_selected') === 'yes' || (!localStorage.getItem(KEY) && !localStorage.getItem(TOURNAMENT_KEY))) return;
  const empty = storage.state.game === null && storage.state.tournament === null;
  const panel = setupPanel('Choose your game data', empty ? 'The shared database is empty. Your existing game and tournament are still saved in this browser.' : 'This database already has shared data. Your previous browser data stays separate and will not be overwritten.');
  const error = node('p', '', panel); error.setAttribute('role', 'alert');
  const actions = node('div', '', panel, 'database-choice-actions');
  const backup = node('button', 'Export browser data', actions); backup.type = 'button';
  const exportLocal = () => {
    const g = localStorage.getItem(KEY), t = localStorage.getItem(TOURNAMENT_KEY);
    if (g) { try { download(exportGame(validateState(JSON.parse(g)), Date.now()), 'browser-game.json'); } catch { download(g, 'browser-game-recovery.json'); } }
    if (t) { try { download(exportTournament(JSON.parse(t)), 'browser-tournament.json'); } catch { download(t, 'browser-tournament-recovery.json'); } }
  };
  backup.onclick = exportLocal; localLink('Continue with browser data', panel);
  await new Promise(resolve => {
    const use = node('button', 'Use shared data', actions, 'primary'); use.type = 'button'; use.onclick = resolve;
    if (empty) {
      const copy = node('button', 'Back up & copy browser data', actions); copy.type = 'button';
      copy.onclick = async () => {
        copy.disabled = use.disabled = true;
        try {
          const g = localStorage.getItem(KEY), t = localStorage.getItem(TOURNAMENT_KEY);
          const game = g ? validateState(JSON.parse(g)) : null, tournament = t ? validateTournament(JSON.parse(t)) : null;
          if (game) { tick(game, storage.now()); stop(game); game.stamp = storage.now(); game.gameId ||= crypto.randomUUID(); }
          exportLocal();
          await storage.commit({ operation: 'migrate', game, tournament, revision: storage.state.revision, mutationId: crypto.randomUUID() }); resolve();
        } catch (e) { error.textContent = e.message; copy.disabled = use.disabled = false; }
      };
    }
  });
  sessionStorage.setItem('courtside_shared_selected', 'yes');
}
export async function initializeAppStorage() {
  const mode = params().get('storage');
  if (mode === 'shared') sessionStorage.removeItem('courtside_local_mode');
  if (mode === 'local') sessionStorage.setItem('courtside_local_mode', 'yes');
  if (mode === 'local' || sessionStorage.getItem('courtside_local_mode') === 'yes') {
    const localDisplays = () => {
      for (const link of document.querySelectorAll('a[target="_blank"]')) {
        const url = new URL(link.href, location.href);
        if (url.origin === location.origin && url.pathname === '/' && !url.searchParams.has('storage')) { url.searchParams.set('storage', 'local'); link.href = url; }
      }
    };
    localDisplays(); new MutationObserver(localDisplays).observe(document.body, { childList: true, subtree: true });
    const banner = node('div', '', document.body, 'database-status'); banner.dataset.phase = 'local'; node('span', 'This device only · Shared data is not in use', banner); localLink('Open shared data', banner, true); document.getElementById('app').before(banner); return;
  }
  const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (response.status === 404 || (response.ok && !response.headers.get('content-type')?.includes('application/json'))) return; // Static Vite builds keep the existing local mode.
  if (!response.ok) throw new Error('The database server could not be reached.');
  const config = await response.json();
  if (config.storage !== 'mysql') throw new Error('Unexpected database server configuration.');
  if (!config.authenticated || (!readOnlyView() && config.role !== 'operator')) await signIn();
  const started = Date.now(), result = await request('/api/state');
  const banner = node('div', '', document.body, 'database-status'), label = node('span', 'Shared database · Connected', banner); document.getElementById('app').before(banner);
  const storage = new SharedStorage({ state: result.state, request, readOnly: readOnlyView(), notify: () => window.dispatchEvent(new StorageEvent('storage', { key: null })), status: phase => {
    banner.dataset.phase = phase; label.textContent = phase === 'saving' ? 'Shared database · Saving…' : phase === 'offline' ? 'Shared database · Connection interrupted; review before retrying' : 'Shared database · Connected';
  } });
  storage.offset = result.serverTime - (started + Date.now()) / 2; selected = storage;
  await chooseSharedData(storage); document.getElementById('app').replaceChildren();
  if (!readOnlyView()) {
    const logout = node('button', 'Sign out', banner); logout.type = 'button'; logout.onclick = async () => { try { await request('/api/session', { method: 'DELETE' }); location.reload(); } catch (e) { label.textContent = e.message; } };
  }
  setInterval(() => storage.refresh().catch(() => {}), 1000);
}
export function showStorageStartupError(error) {
  const panel = setupPanel('Shared data unavailable', error.message);
  const retry = node('button', 'Retry connection', panel, 'primary'); retry.type = 'button'; retry.onclick = () => location.reload(); localLink('Use existing browser data', panel);
}
