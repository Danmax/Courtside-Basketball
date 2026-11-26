// Shared drawing/scoring geometry in the app's virtual court units.
// This is the displayed court preset, not a verified league specification.
export const COURT = Object.freeze({ width: 500, height: 470, hoopX: 250, hoopY: 64, threeRadius: 220, cornerX: 45, lineWidth: 2 });
export const threeJoinY = COURT.hoopY + Math.sqrt(COURT.threeRadius ** 2 - (COURT.hoopX - COURT.cornerX) ** 2);
export function fieldGoalValue(x, y) {
  if (![x, y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  const px = x * COURT.width, py = y * COURT.height, halfLine = COURT.lineWidth / 2, epsilon = 1e-9;
  // The visible line belongs to the two-point area, including the straight corners.
  if (py <= threeJoinY) return px < COURT.cornerX - halfLine - epsilon || px > COURT.width - COURT.cornerX + halfLine + epsilon ? 3 : 2;
  return Math.hypot(px - COURT.hoopX, py - COURT.hoopY) > COURT.threeRadius + halfLine + epsilon ? 3 : 2;
}
export function threePointPath() {
  return `M ${COURT.cornerX} 20 V ${threeJoinY} A ${COURT.threeRadius} ${COURT.threeRadius} 0 0 0 ${COURT.width - COURT.cornerX} ${threeJoinY} V 20`;
}
