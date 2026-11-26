import { COURT, threePointPath } from './court-geometry.js';
// Schematic half-court for placement, not a league-calibrated distance/rule map.
export function drawCourt(parent) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${COURT.width} ${COURT.height}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  function shape(tag, attributes) { const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value); svg.append(el); }
  const line = { fill: 'none', stroke: '#fff2dc', 'stroke-width': COURT.lineWidth, opacity: .8 };
  shape('rect', { x: 15, y: 20, width: 470, height: 435, rx: 2, ...line });
  shape('rect', { x: 170, y: 20, width: 160, height: 190, fill: '#f4d1a21a', stroke: '#fff2dc', 'stroke-width': 2 });
  shape('circle', { cx: 250, cy: 210, r: 60, ...line });
  shape('path', { d: threePointPath(), 'data-court-line': 'three-point', ...line });
  shape('path', { d: 'M 210 65 A 40 40 0 0 0 290 65', ...line });
  shape('path', { d: 'M 190 455 A 60 60 0 0 1 310 455', ...line });
  shape('line', { x1: 220, y1: 45, x2: 280, y2: 45, stroke: '#fff2dc', 'stroke-width': 4 });
  shape('line', { x1: 250, y1: 45, x2: 250, y2: 54, stroke: '#fff2dc', 'stroke-width': 2 });
  shape('circle', { cx: COURT.hoopX, cy: COURT.hoopY, r: 10, fill: 'none', stroke: '#ffd086', 'stroke-width': 3 });
  for (const y of [110, 140, 170]) for (const x of [160, 330]) shape('line', { x1: x, y1: y, x2: x + 10, y2: y, ...line });
  parent.append(svg); return svg;
}
