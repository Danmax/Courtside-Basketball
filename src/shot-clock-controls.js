import { node } from './ui.js';
import { start, stop, startShotClock, stopShotClock, resetShotClock, setClock, parseClock, note } from './engine.js';

export function createShotClockControls(parent, { apply, toast, fail }) {
  const element = node('section', '', parent, 'shot-clock-controls');
  element.setAttribute('aria-label', 'Game and shot-clock controls');
  let state = null;
  const game = node('div', '', element, 'shot-clock-group'); node('h2', 'Game clock', game);
  const gameActions = node('div', '', game, 'shot-clock-actions');
  function action(parent, label, fn, confirmation, className = '') {
    const button = node('button', label, parent, className); button.type = 'button';
    button.onclick = () => {
      try {
        apply(next => { if (fn(next) === false) throw new Error('Control unavailable. Check the break, game time and on-court foul-outs.'); });
        toast(typeof confirmation === 'function' ? confirmation() : confirmation);
      } catch (error) { fail(error); }
    };
    return button;
  }
  const startGame = action(gameActions, 'Start game + shot', start, () => state.shotEnabled ? 'Game and shot clocks started.' : 'Game clock started.', 'primary');
  action(gameActions, 'Stop both clocks', stop, 'Both clocks stopped.', 'stop-button');
  const editGame = node('button', 'Set game time…', gameActions); editGame.type = 'button';
  const shot = node('div', '', element, 'shot-clock-group'); node('h2', 'Shot clock', shot);
  const shotActions = node('div', '', shot, 'shot-clock-actions');
  const startShot = action(shotActions, 'Start shot only', startShotClock, 'Shot clock started.');
  const stopShot = action(shotActions, 'Stop shot only', stopShotClock, 'Shot clock stopped.');
  const resetShort = action(shotActions, 'Reset shot 14', next => resetShotClock(next, next.shotReset * 1000), () => `Shot clock reset to ${state.shotReset} seconds.`);
  const resetDefault = action(shotActions, 'Reset shot 24', next => resetShotClock(next), () => `Shot clock reset to ${state.shotDefault} seconds.`);
  const editShot = node('button', 'Set shot time…', shotActions); editShot.type = 'button';
  const footer = node('div', '', element, 'shot-clock-footer'), hint = node('p', '', footer);
  const endBreak = action(footer, 'End break', next => {
    if (!next.break) return false;
    note(next, next.break.label + ' ended early'); stop(next); next.break = null;
  }, 'Break ended. Restart the clocks when ready.'); endBreak.hidden = true;

  const dialog = node('dialog', '', parent);
  function edit(clock, trigger) {
    if (!state) return;
    const gameId = state.gameId;
    dialog.replaceChildren(); const title = node('h2', clock === 'game' ? 'Set game clock' : 'Set shot clock', dialog); title.id = 'shot-clock-dialog-title';
    dialog.setAttribute('aria-labelledby', title.id);
    const form = node('form', '', dialog), label = node('label', 'Time (minutes:seconds.milliseconds)', form), input = node('input', '', label);
    input.required = true; input.placeholder = '02:15.500';
    const ms = state[clock]; input.value = `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
    node('p', 'Both clocks must be stopped. Applying a correction leaves them stopped.', form);
    const error = node('p', '', form); error.setAttribute('role', 'alert');
    const actions = node('div', '', form, 'dialog-actions');
    const cancel = node('button', 'Cancel', actions); cancel.type = 'button'; cancel.onclick = () => dialog.close();
    node('button', 'Apply', actions).type = 'submit';
    form.onsubmit = event => {
      event.preventDefault();
      try {
        const parsed = parseClock(input.value);
        if (parsed === null) throw new Error('Use minutes:seconds with up to three decimal digits, such as 02:15.500.');
        apply(next => {
          if (next.gameId !== gameId) throw new Error('The game changed. Close this dialog and review the current clock.');
          if (!setClock(next, clock, parsed)) throw new Error('Stop both clocks and end any break before applying a time correction.');
        });
        dialog.close(); toast(`${clock === 'game' ? 'Game' : 'Shot'} clock corrected. Both clocks remain stopped.`);
      } catch (e) { error.textContent = e.message; }
    };
    dialog.onclose = () => trigger.focus({ preventScroll: true });
    dialog.showModal();
  }
  editGame.onclick = () => edit('game', editGame); editShot.onclick = () => edit('shot', editShot);

  return {
    element,
    render(next, archived) {
      state = next; element.hidden = archived || !state;
      if (element.hidden) { if (dialog.open) dialog.close(); return; }
      const unresolved = Object.values(state.teams).some(t => t.players.some(p => p.on && p.out));
      startGame.textContent = state.shotEnabled ? 'Start game + shot' : 'Start game';
      startGame.disabled = !!state.break || state.game <= 0 || unresolved;
      startShot.disabled = !state.shotEnabled || startGame.disabled || state.violation || state.shot <= 0;
      stopShot.disabled = !state.shotEnabled;
      editGame.disabled = state.running || state.shotRunning || !!state.break;
      editShot.disabled = editGame.disabled || !state.shotEnabled;
      resetShort.disabled = resetDefault.disabled = !!state.break || !state.shotEnabled; resetShort.hidden = state.shotDefault === state.shotReset;
      resetShort.textContent = 'Reset shot ' + state.shotReset;
      resetDefault.textContent = 'Reset shot ' + state.shotDefault;
      endBreak.hidden = !state.break;
      hint.textContent = state.break ? `${state.break.label} · end the break, then restart manually.` : unresolved ? 'Fouled-out player on court. Remove or replace on the Game desk before restarting.' : state.game <= 0 ? 'Period ended. Set the time here, or advance the period on the Game desk.' : state.violation ? 'Shot violation · Start game + shot clears it and resets the shot clock.' : !state.shotEnabled ? 'Shot clock disabled in Game rules. Game time remains under official control.' : 'Start/stop clocks here. Time corrections require both clocks stopped.';
    },
  };
}
