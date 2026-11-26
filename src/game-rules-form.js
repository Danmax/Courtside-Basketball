import { node } from './ui.js';
import { DEFAULT_GAME_RULES, gameRules, validateGameRules } from './game-rules.js';
import { openingGame } from './engine.js';

export function buildGameRulesForm(form, state) {
  const rules = gameRules(state), inputs = new Map();
  node('p', openingGame(state) ? 'Ready for tip-off. Applying rules sets the opening clocks and timeout balances. Rosters stay in place.' : 'Game in progress. Current clocks, timeout balances, scores and stats are kept. New durations apply on the next period/reset; foul limits apply immediately. Fouled-out players stay out.', form, 'rules-apply-note');
  const groups = node('div', '', form, 'rules-form-grid');
  function group(title) { const set = node('fieldset', '', groups); node('legend', title, set); return set; }
  function numeric(parent, label, key, min, max) {
    const wrap = node('label', label, parent), input = node('input', '', wrap);
    input.type = 'number'; input.required = true; input.min = min; input.max = max; input.step = 1; input.value = rules[key]; inputs.set(key, input); return input;
  }
  function select(parent, label, key, options) {
    const wrap = node('label', label, parent), input = node('select', '', wrap);
    input.setAttribute('aria-label', label);
    for (const [value, title] of options) { const option = node('option', title, input); option.value = value; }
    input.value = String(rules[key]); inputs.set(key, input); return input;
  }
  const format = group('Game format');
  numeric(format, 'Number of periods', 'periods', 1, Number.MAX_SAFE_INTEGER);
  const lengthLabel = node('label', 'Period length (mm:ss)', format), length = node('input', '', lengthLabel);
  length.required = true; length.placeholder = '10:00'; length.pattern = '[0-9]{1,4}:[0-5][0-9]'; inputs.set('length', length);
  numeric(format, 'Halftime minutes', 'halftime', 0, 1440);
  node('p', 'Set halftime to 0 to disable the halftime break button.', format, 'rules-field-help');
  const clock = group('Clocks');
  const enabledLabel = node('label', '', clock, 'rule-checkbox'), enabled = node('input', '', enabledLabel); enabled.type = 'checkbox'; inputs.set('shotEnabled', enabled); node('span', 'Use shot clock', enabledLabel);
  const shotDefault = numeric(clock, 'Shot clock seconds', 'shotDefault', 1, 86400);
  const reset = numeric(clock, 'Short shot reset seconds', 'shotReset', 1, 86400);
  select(clock, 'Game clock after a score', 'stopOnScore', [['false', 'Keep running'], ['true', 'Stop both clocks']]);
  node('p', 'A short reset is an official control; offensive rebounds do not automatically reset the shot clock.', clock, 'rules-field-help');
  const fouls = group('Fouls');
  numeric(fouls, 'Personal foul limit', 'personalLimit', 1, Number.MAX_SAFE_INTEGER);
  numeric(fouls, 'Team foul threshold', 'teamLimit', 1, Number.MAX_SAFE_INTEGER);
  select(fouls, 'Reset team fouls', 'teamFoulReset', [['period', 'Each period'], ['half', 'At halftime'], ['game', 'New game only']]);
  node('p', 'The team threshold is an indicator and journal event. Officials manage any free throws.', fouls, 'rules-field-help');
  const timeouts = group('Timeouts');
  numeric(timeouts, 'Timeouts per team', 'timeoutsPerTeam', 0, 99);
  numeric(timeouts, 'Short timeout seconds', 'timeoutShort', 1, 3600);
  numeric(timeouts, 'Full timeout seconds', 'timeoutLong', 1, 3600);
  node('p', 'A shared allowance for both timeout durations. It resets for a new game, with no automatic replenishment between periods.', timeouts, 'rules-field-help');
  const hint = node('p', 'Both clocks must be stopped and the break ended. Saving never restarts play.', form, 'rules-field-help');
  function updateShotFields() { shotDefault.disabled = reset.disabled = !enabled.checked; }
  function fill(values) {
    for (const [key, input] of inputs) {
      if (key === 'length') input.value = `${Math.floor(values.length / 60)}:${String(values.length % 60).padStart(2, '0')}`;
      else if (input.type === 'checkbox') input.checked = values[key];
      else input.value = String(values[key]);
    }
    updateShotFields();
  }
  enabled.onchange = updateShotFields;
  const defaults = node('button', 'Use app defaults', form, 'rules-defaults'); defaults.type = 'button'; defaults.onclick = () => { fill(DEFAULT_GAME_RULES); hint.textContent = 'App defaults filled in. Choose Apply to save them.'; };
  fill(rules);
  return () => {
    const match = /^(\d{1,4}):([0-5]\d)$/.exec(length.value.trim());
    if (!match) throw new Error('Use minutes:seconds for the period length, such as 08:00.');
    const values = {};
    for (const [key, input] of inputs) {
      if (key === 'length') values.length = Number(match[1]) * 60 + Number(match[2]);
      else if (input.type === 'checkbox') values[key] = input.checked;
      else if (key === 'stopOnScore') values[key] = input.value === 'true';
      else values[key] = input.tagName === 'SELECT' ? input.value : Number(input.value);
    }
    return validateGameRules(values);
  };
}
