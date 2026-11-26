export const emptyShooting = () => ({ fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, points: 0 });
export function shootingTotals(shots = [], team = null, playerId = null) {
  const total = emptyShooting();
  for (const shot of shots) {
    if (shot.voided || (team && shot.team !== team) || (playerId && shot.playerId !== playerId)) continue;
    if (shot.value === 1) { total.fta++; if (shot.made) total.ftm++; }
    else { total.fga++; if (shot.made) total.fgm++; if (shot.value === 3) { total.tpa++; if (shot.made) total.tpm++; } }
    if (shot.made) total.points += shot.value;
  }
  return total;
}
export const percentage = (made, attempts) => attempts ? (made / attempts * 100).toFixed(1) + '%' : '—';
export const shootingValues = total => [`${total.fgm}/${total.fga}`, percentage(total.fgm, total.fga), `${total.tpm}/${total.tpa}`, `${total.ftm}/${total.fta}`];
