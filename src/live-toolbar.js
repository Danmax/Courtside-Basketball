import { node } from './ui.js';
import { format } from './engine.js';
import { periodLabel } from './game-rules.js';

export function clockActionLabel(element, label, compact) {
  if (element.getAttribute('aria-label') === label) return;
  element.setAttribute('aria-label', label); element.title = label; element.replaceChildren();
  node('span', label, element, 'clock-label-full'); node('span', compact, element, 'clock-label-compact');
}

// Presentation only. Each view supplies its existing official clock actions.
export function createLiveToolbar(parent, { shots = false, target = 'clock-tools' } = {}) {
  const element = node('section', '', parent, 'live-toolbar'); element.setAttribute('aria-label', 'Live game controls');
  const scorebar = node('div', '', element, shots ? 'shot-scorebar' : 'toolbar-scorebar');
  scorebar.setAttribute('role', 'group'); scorebar.setAttribute('aria-label', shots ? 'Shot tracker scoreboard' : 'Current score and clocks');
  const teams = {};
  for (const slot of ['A', 'clock', 'B']) {
    const panel = node('div', '', scorebar, slot === 'clock' ? 'shot-clock-status' : 'team-' + slot);
    if (slot === 'clock') continue;
    teams[slot] = { name: node('span', '', panel), score: node('strong', '', panel) };
  }
  const clock = scorebar.querySelector('.shot-clock-status'), time = node('span', '', clock), shot = node('strong', '', clock), status = node('small', '', clock);
  const controls = node('div', '', element, 'toolbar-controls');
  const actions = node('div', '', controls, 'toolbar-actions');
  const tools = node('a', 'Clock tools', controls, 'toolbar-tools'); tools.href = '#' + target;
  clockActionLabel(tools, 'Clock tools', 'Tools');
  tools.onclick = event => {
    const panel = document.getElementById(target); if (!panel) return;
    event.preventDefault(); panel.scrollIntoView({ block: 'start' }); panel.focus({ preventScroll: true });
  };
  const hint = node('p', '', element, 'toolbar-hint'); hint.hidden = true;
  const hintText = node('span', '', hint), rosterLink = node('a', 'Manage lineup', hint); rosterLink.href = '/#roster'; rosterLink.hidden = true;
  return {
    element, actions, scorebar,
    render(state, archived = false) {
      element.hidden = !state; if (!state) return;
      for (const key of ['A', 'B']) { teams[key].name.textContent = state.teams[key].name; teams[key].score.textContent = state.teams[key].score; }
      time.textContent = archived ? 'RECORDED FINAL' : `${periodLabel(state)} · ${format(state.game, state.game < 60000)}`;
      shot.textContent = state.shotEnabled ? `SHOT ${Math.ceil(state.shot / 1000)}` : 'SHOT OFF';
      status.textContent = state.break ? state.break.label + ' · BREAK' : state.violation ? 'SHOT CLOCK VIOLATION' : state.running ? 'GAME RUNNING' : state.shotRunning ? 'SHOT RUNNING · GAME STOPPED' : 'CLOCKS STOPPED';
      const out = Object.values(state.teams).some(team => team.players.some(player => player.on && player.out));
      element.dataset.phase = state.break ? 'break' : state.violation || out ? 'blocked' : state.running || state.shotRunning ? 'live' : 'paused';
      controls.hidden = archived; element.classList.toggle('is-archived', archived);
      hintText.textContent = state.break ? `${state.break.label} · End the break before restarting.` : out ? 'Fouled-out player on court. Remove or replace them before restarting.' : state.game <= 0 ? 'Period ended. Set the time or advance the period before restarting.' : state.violation ? 'Shot violation. Start game + shot clears it and reloads the shot clock.' : '';
      rosterLink.hidden = !out; hint.hidden = archived || !hintText.textContent;
    },
  };
}
