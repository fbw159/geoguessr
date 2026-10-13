// Gemeinsame UI-Bausteine: Bildschirme, Toasts, Dialoge, Avatare
import { $, $$, esc } from './util.js';

let current = 'home';
const leaveHandlers = {};
export function onLeave(screen, fn) { leaveHandlers[screen] = fn; }

export function show(screen) {
  if (current !== screen && leaveHandlers[current]) leaveHandlers[current]();
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${screen}`));
  current = screen;
  window.scrollTo(0, 0);
}
export const currentScreen = () => current;

export function toast(msg, type = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = msg;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); }, ms);
}

let modalClose = null;
export function openModal(html, onMount) {
  const m = $('#modal');
  m.querySelector('.modal-box').className = 'modal-box';
  $('#modal-content').innerHTML = html;
  m.classList.remove('hidden');
  const close = () => { m.classList.add('hidden'); $('#modal-content').innerHTML = ''; modalClose = null; };
  modalClose = close;
  m.onclick = e => { if (e.target === m) close(); };
  if (onMount) onMount($('#modal-content'), close);
  const first = $('#modal-content input, #modal-content button');
  if (first) setTimeout(() => first.focus(), 30);
  return close;
}
export const closeModal = () => modalClose && modalClose();
export const modalOpen = () => !!modalClose;

export function confirmDialog(text, { ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
  return new Promise(resolve => {
    openModal(`
      <p class="modal-text">${text}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-r="0">${esc(cancel)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-r="1">${esc(ok)}</button>
      </div>`, (root, close) => {
      root.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { close(); resolve(b.dataset.r === '1'); });
      $('#modal').onclick = e => { if (e.target === $('#modal')) { close(); resolve(false); } };
    });
  });
}

export function avatar(p, size = 'md') {
  if (!p) return `<span class="avatar avatar-${size}" style="--c:#8d99ae">?</span>`;
  return `<span class="avatar avatar-${size}" style="--c:${esc(p.color || '#8d99ae')}">${esc(p.emoji || p.name?.[0] || '?')}</span>`;
}
