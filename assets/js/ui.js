// Мелкие помощники интерфейса. Все данные МЭШ выводятся через textContent —
// без innerHTML, чтобы текст ДЗ не мог внедрить разметку.

import { t, lang } from './i18n.js';
import { parseIso, today, addDays } from './core.js';
import { liquid, glare } from './glass.js';

/** h('div.card#id', {attrs, on: {click}}, ...children) */
export function h(tag, props = {}, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [, name = 'div', rest = ''] = /^([a-z0-9-]+)?(.*)$/i.exec(tag);
  const node = document.createElement(name);
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') node.classList.add(part.slice(1));
    else node.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'on') Object.entries(v).forEach(([ev, fn]) => node.addEventListener(ev, fn));
    else if (k === 'class') node.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, cls = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export async function loadSprite() {
  try {
    const res = await fetch('assets/icons/sprite.svg');
    const holder = document.createElement('div');
    holder.innerHTML = await res.text(); // собственный статический файл
    document.body.prepend(holder.firstElementChild);
  } catch { /* без иконок интерфейс остаётся рабочим */ }
}

/** Стеклянная панель: класс .glass, преломление (если включено) и блик. */
export function glass(node, { refract = false } = {}) {
  node.classList.add('glass');
  glare(node);
  if (refract) {
    node.dataset.liquid = '';
    liquid(node);
  }
  return node;
}

export function button(label, { icon: ic, kind = 'tonal', on, title, disabled, cls = '' } = {}) {
  return h(`button.btn.btn-${kind}${cls ? `.${cls}` : ''}`, { type: 'button', title, disabled, on: on ? { click: on } : undefined },
    ic ? icon(ic) : null, label ? h('span', label) : null);
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  let node = document.getElementById('toast');
  if (!node) {
    node = glass(h('div#toast', { role: 'status', 'aria-live': 'polite' }));
    document.body.append(node);
  }
  node.className = `glass toast-${kind} show`;
  node.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3800);
}

/** Модальный диалог. Возвращает Promise<boolean>. */
export function confirmDialog({ title, body, ok, cancel = t('common.cancel') }) {
  return new Promise((resolve) => {
    const dialog = h('dialog.dialog');
    const panel = glass(h('form.dialog-panel', { method: 'dialog' },
      h('h2', title),
      ...[].concat(body).map((p) => (p instanceof Node ? p : h('p', p))),
      h('div.dialog-actions',
        h('button.btn.btn-text', { value: 'cancel', type: 'submit' }, cancel),
        h('button.btn.btn-filled', { value: 'ok', type: 'submit' }, ok)),
    ), { refract: true });
    dialog.append(panel);
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok');
      dialog.remove();
    });
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close('cancel'); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

export function spinner(label = t('common.loading')) {
  return h('div.state', h('div.loader', { role: 'progressbar', 'aria-label': label }), h('p.muted', label));
}

export function emptyState(text, ic = 'sparkles') {
  return h('div.state', icon(ic, 'state-icon'), h('p.muted', text));
}

export function errorState(message, retry) {
  return h('div.state', icon('triangle-alert', 'state-icon error'), h('p', message),
    retry ? button(t('common.retry'), { icon: 'refresh-cw', on: retry }) : null);
}

export function formatDayLong(iso) {
  const d = parseIso(iso);
  // На узком экране — короткий день недели, чтобы дата не обрезалась.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 440;
  const text = new Intl.DateTimeFormat(lang(), { weekday: narrow ? 'short' : 'long', day: 'numeric', month: 'long' }).format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatDayShort(iso) {
  return new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'short' }).format(parseIso(iso));
}

/** Переключатель дня: ‹ день › + «Сегодня»; свайп влево/вправо по контейнеру. */
export function daySelector(date, onChange, swipeTarget) {
  const input = h('input.day-input', {
    type: 'date', value: date, 'aria-label': formatDayLong(date),
    on: { change: (e) => e.target.value && onChange(e.target.value) },
  });
  const node = glass(h('div.day-selector',
    h('button.icon-btn', { type: 'button', title: t('common.prevDay'), 'aria-label': t('common.prevDay'), on: { click: () => onChange(addDays(date, -1)) } }, icon('chevron-left')),
    h('label.day-label', h('span.day-title', formatDayLong(date)), input),
    date !== today() ? h('button.chip', { type: 'button', on: { click: () => onChange(today()) } }, t('common.today')) : null,
    h('button.icon-btn', { type: 'button', title: t('common.nextDay'), 'aria-label': t('common.nextDay'), on: { click: () => onChange(addDays(date, 1)) } }, icon('chevron-right')),
  ));
  if (swipeTarget) {
    let x0 = null;
    let y0 = null;
    swipeTarget.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    swipeTarget.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) onChange(addDays(date, dx < 0 ? 1 : -1));
    }, { passive: true });
  }
  return node;
}

export function segmented(options, value, onChange) {
  return glass(h('div.segmented', { role: 'tablist' },
    options.map(([key, label]) => h(`button.seg${key === value ? '.active' : ''}`, {
      type: 'button', role: 'tab', 'aria-selected': String(key === value), on: { click: () => onChange(key) },
    }, label))));
}

export function markBadge(value, text) {
  const v = value === null || value === undefined ? null : Math.round(value);
  const color = v === null ? 'none' : v >= 5 ? 'green' : v === 4 ? 'yellow' : v === 3 ? 'orange' : 'red';
  return h(`span.mark.mark-${color}`, text ?? (value ?? '—'));
}
