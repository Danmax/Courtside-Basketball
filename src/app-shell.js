export function setupAppShell() {
  const view = new URLSearchParams(location.search).get('view') || 'control';
  const titles = { control: 'Game desk', tournament: 'Tournament', players: 'Player stats', shots: 'Shot tracker', referee: 'Official’s desk', scoreboard: 'Scoreboard', overlay: 'Broadcast overlay' };
  document.title = 'Courtside — ' + (titles[view] || 'Game desk');
  const nav = document.querySelector('.primary-nav');
  const active = [...nav.querySelectorAll('[data-view]')].find(link => link.dataset.view === view);
  if (active) {
    active.setAttribute('aria-current', 'page');
    const revealActive = () => { nav.scrollLeft = Math.max(0, active.offsetLeft - nav.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2); };
    revealActive(); window.addEventListener('resize', revealActive);
  }
  const menu = document.querySelector('.display-menu'), trigger = menu.querySelector('summary');
  document.addEventListener('pointerdown', event => { if (menu.open && !menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { event.preventDefault(); menu.open = false; trigger.focus(); }
  });
  document.querySelector('.skip-link').addEventListener('click', event => {
    event.preventDefault(); const app = document.getElementById('app'); app.focus({ preventScroll: true }); app.scrollIntoView({ block: 'start' });
  });
}
