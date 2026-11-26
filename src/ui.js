export function node(tag, text, parent, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  parent?.append(element);
  return element;
}
let confirmationOpen = false;
export const confirmingChange = () => confirmationOpen;
export async function confirmChange(message) {
  confirmationOpen = true;
  try {
    const accepted = window.confirm(message);
    // Native dialogs suspend storage events. Let queued cross-tab updates arrive
    // before callers recheck state or attempt a conditional save.
    await new Promise(resolve => setTimeout(resolve, 0));
    return accepted;
  } finally { confirmationOpen = false; }
}
export function minutes(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function initials(name) {
  return name.trim().split(/\s+/).map(word => word[0]).join('').slice(0, 3).toUpperCase() || '—';
}
export function heading(parent, eyebrow, title) {
  const header = node('div', '', parent, 'section-heading');
  node('span', eyebrow, header, 'eyebrow');
  node('h2', title, header);
  return header;
}
export function identity(parent, p) {
  const wrap = node('div', '', parent, 'player-identity');
  node('span', p.number, wrap, 'jersey');
  const copy = node('div', '', wrap);
  node('h3', p.name, copy);
  node('small', p.out ? 'FOULED OUT' : p.on ? 'ON COURT' : 'BENCH', copy, p.out ? 'foul-warning' : p.on ? 'active-label' : 'muted');
  return wrap;
}
