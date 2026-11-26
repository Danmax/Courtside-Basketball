// Rule definitions and validation stay independent of the UI and persistence.
export const DEFAULT_GAME_RULES = Object.freeze({
  periods: 4, length: 600, shotDefault: 24, shotEnabled: true, shotReset: 14,
  personalLimit: 5, teamLimit: 5, teamFoulReset: 'period',
  timeoutsPerTeam: 3, timeoutShort: 30, timeoutLong: 60, halftime: 15,
  stopOnScore: false,
});
export const GAME_RULE_KEYS = Object.keys(DEFAULT_GAME_RULES);
export const OPTIONAL_RULE_KEYS = ['shotEnabled', 'shotReset', 'teamFoulReset', 'timeoutsPerTeam', 'timeoutShort', 'timeoutLong', 'stopOnScore'];

export function gameRules(state) {
  const rules = Object.fromEntries(GAME_RULE_KEYS.map(key => [key, state[key] === undefined ? DEFAULT_GAME_RULES[key] : state[key]]));
  if (state.shotReset === undefined) rules.shotReset = Math.min(14, rules.shotDefault);
  return rules;
}

export function validateGameRules(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Enter valid game rules.');
  const rules = gameRules(source);
  const fields = [
    ['periods', 'Number of periods', 1, Number.MAX_SAFE_INTEGER],
    ['length', 'Period length in seconds', 1, 86400],
    ['shotDefault', 'Shot clock seconds', 1, 86400],
    ['shotReset', 'Short shot reset seconds', 1, 86400],
    ['personalLimit', 'Personal foul limit', 1, Number.MAX_SAFE_INTEGER],
    ['teamLimit', 'Team foul threshold', 1, Number.MAX_SAFE_INTEGER],
    ['timeoutsPerTeam', 'Timeouts per team', 0, 99],
    ['timeoutShort', 'Short timeout seconds', 1, 3600],
    ['timeoutLong', 'Full timeout seconds', 1, 3600],
    ['halftime', 'Halftime minutes', 0, 1440],
  ];
  for (const [key, label, min, max] of fields) if (!Number.isSafeInteger(rules[key]) || rules[key] < min || rules[key] > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  for (const key of ['shotEnabled', 'stopOnScore']) if (typeof rules[key] !== 'boolean') throw new Error('Choose valid clock options.');
  if (rules.shotReset > rules.shotDefault) throw new Error('Short shot reset cannot exceed the full shot clock.');
  if (rules.timeoutShort > rules.timeoutLong) throw new Error('Short timeout cannot exceed the full timeout.');
  if (!['period', 'half', 'game'].includes(rules.teamFoulReset)) throw new Error('Choose when team fouls reset.');
  if (rules.teamFoulReset === 'half' && rules.periods % 2 !== 0) throw new Error('Halftime foul resets require an even number of periods.');
  return rules;
}

export const periodLabel = state => `${state.periods === 4 ? 'Q' : state.periods === 2 ? 'H' : 'P'}${state.quarter}`;
export function gameRulesSummary(state) {
  const r = gameRules(state);
  const duration = r.length % 60 ? `${Math.floor(r.length / 60)}:${String(r.length % 60).padStart(2, '0')}` : `${r.length / 60} min`;
  return `${r.periods} × ${duration} · ${r.shotEnabled ? r.shotDefault + 's shot clock' : 'No shot clock'} · ${r.personalLimit} PF · ${r.timeoutsPerTeam} timeouts/team`;
}
