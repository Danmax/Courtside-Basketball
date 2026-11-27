import './style.css';
import './ux.css';
import { setupAppShell } from './app-shell.js';
import { initializeAppStorage, showStorageStartupError } from './app-storage.js';
setupAppShell();
async function mount() {
await initializeAppStorage();
if (new URLSearchParams(location.search).get('view') === 'tournament') {
  const { mountTournament } = await import('./tournament-view.js'); mountTournament(document.getElementById('app'));
} else if (new URLSearchParams(location.search).get('view') === 'players') {
  const { mountPlayerStats } = await import('./player-stats-view.js'); mountPlayerStats(document.getElementById('app'));
} else if (new URLSearchParams(location.search).get('view') === 'shots') {
  const { mountShots } = await import('./shots-view.js'); mountShots(document.getElementById('app'));
} else {
  await import('./game-desk.js');
}
}
mount().catch(showStorageStartupError);
