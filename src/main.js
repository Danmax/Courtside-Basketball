import './style.css';
import './ux.css';
import { setupAppShell } from './app-shell.js';
setupAppShell();
if (new URLSearchParams(location.search).get('view') === 'tournament') {
  import('./tournament-view.js').then(({ mountTournament }) => mountTournament(document.getElementById('app')));
} else if (new URLSearchParams(location.search).get('view') === 'players') {
  import('./player-stats-view.js').then(({ mountPlayerStats }) => mountPlayerStats(document.getElementById('app')));
} else if (new URLSearchParams(location.search).get('view') === 'shots') {
  import('./shots-view.js').then(({ mountShots }) => mountShots(document.getElementById('app')));
} else {
  import('./game-desk.js');
}
