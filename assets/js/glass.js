// «Жидкое стекло» для веба.
//
// Оптика — порт fragment-main.glsl из Liquid Glass Studio
// (github.com/iyinchao/liquid-glass-studio, MIT): SDF скруглённого
// прямоугольника, угол падения по профилю толщины, преломление по закону
// Снеллиуса и дисперсия (N_R = 0.98, N_B = 1.02). Вместо WebGL-текстуры фона
// смещение запекается в карту для SVG feDisplacementMap, а фильтр применяется
// через `backdrop-filter: url(#…)` — он преломляет настоящий DOM под стеклом.
//
// backdrop-filter с url() умеют только Chromium-браузеры; остальным достаётся
// матовое стекло (blur + saturate) из CSS.

const SVG_NS = 'http://www.w3.org/2000/svg';
const cache = new Map();
let defs = null;
let counter = 0;

export function refractionSupported() {
  if (typeof navigator === 'undefined' || typeof CSS === 'undefined') return false;
  const brands = navigator.userAgentData?.brands?.map((b) => b.brand) || [];
  const chromium = brands.some((b) => /Chromium|Google Chrome|Microsoft Edge|Opera/.test(b)) ||
    (/Chrome\/\d+/.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent) && !/Version\/[\d.]+.*Safari/.test(navigator.userAgent));
  return chromium && CSS.supports('backdrop-filter', 'blur(1px)');
}

const safeAsin = (x) => Math.asin(Math.max(-1, Math.min(1, x)));

/** SDF скруглённого прямоугольника (центр в 0, полуразмеры b, радиус r). */
function sdRoundRect(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
}

/**
 * Карта смещения: R/G = 0.5 ± смещение по x/y. Возвращает dataURL и масштаб в px.
 * thickness — ширина «линзовой» кромки, n — показатель преломления.
 */
function displacementMap(w, h, radius, { thickness = 22, n = 1.5, strength = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const bx = w / 2;
  const by = h / 2;
  const r = Math.min(radius, bx, by);
  const offsets = new Float32Array(w * h * 2);
  let max = 0.0001;
  const eps = 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - bx;
      const py = y + 0.5 - by;
      const d = sdRoundRect(px, py, bx, by, r);
      const depth = -d; // расстояние от кромки внутрь
      let dx = 0;
      let dy = 0;
      if (depth > 0 && depth < thickness) {
        // Нормаль — градиент SDF (смотрит наружу).
        const gx = sdRoundRect(px + eps, py, bx, by, r) - sdRoundRect(px - eps, py, bx, by, r);
        const gy = sdRoundRect(px, py + eps, bx, by, r) - sdRoundRect(px, py - eps, bx, by, r);
        const len = Math.hypot(gx, gy) || 1;
        // Профиль кромки из Liquid Glass Studio.
        const ratio = 1 - depth / thickness;
        const thetaI = safeAsin(ratio * ratio);
        const thetaT = safeAsin(Math.sin(thetaI) / n);
        const edge = -Math.tan(thetaT - thetaI);
        // Сэмплируем ближе к центру — край «втягивает» и увеличивает фон.
        dx = -(gx / len) * edge * thickness * strength;
        dy = -(gy / len) * edge * thickness * strength;
      }
      const i = (y * w + x) * 2;
      offsets[i] = dx;
      offsets[i + 1] = dy;
      max = Math.max(max, Math.abs(dx), Math.abs(dy));
    }
  }
  for (let p = 0, i = 0; p < w * h; p++, i += 2) {
    const o = p * 4;
    img.data[o] = Math.round(128 + (offsets[i] / max) * 127);
    img.data[o + 1] = Math.round(128 + (offsets[i + 1] / max) * 127);
    img.data[o + 2] = 128;
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL(), scale: max * 2 };
}

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  defs = document.createElementNS(SVG_NS, 'defs');
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

function el(name, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  children.forEach((c) => node.append(c));
  return node;
}

/** SVG-фильтр под размер элемента (кэш по размеру и радиусу). */
function filterFor(w, h, radius, opts) {
  const key = `${w}x${h}r${radius}t${opts.thickness}`;
  if (cache.has(key)) return cache.get(key);
  const id = `lg-${++counter}`;
  const { url, scale } = displacementMap(w, h, radius, opts);
  // Дисперсия: три канала смещаются чуть по-разному (N_R / N_G / N_B).
  const channel = (k, matrix, result) => [
    el('feDisplacementMap', { in: 'SourceGraphic', in2: 'map', scale: (scale * k).toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G', result: `${result}d` }),
    el('feColorMatrix', { in: `${result}d`, type: 'matrix', values: matrix, result }),
  ];
  const filter = el('filter', {
    id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB',
  }, [
    el('feImage', { href: url, x: 0, y: 0, width: w, height: h, result: 'map', preserveAspectRatio: 'none' }),
    ...channel(1.02, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', 'r'),
    ...channel(1.0, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', 'g'),
    ...channel(0.98, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', 'b'),
    el('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }),
    el('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }),
  ]);
  ensureDefs().append(filter);
  cache.set(key, id);
  return id;
}

const observed = new WeakMap();
let enabled = false;

function apply(node) {
  const rect = node.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w < 8 || h < 8 || w * h > 900_000) return;
  const radius = parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
  const thickness = Number(node.dataset.glassThickness || Math.min(26, Math.min(w, h) / 2.4));
  const id = filterFor(w, h, Math.round(radius), { thickness, n: 1.5 });
  const blur = node.dataset.glassBlur || '2px';
  node.style.backdropFilter = `url(#${id}) blur(${blur}) saturate(1.6) brightness(1.04)`;
  node.style.webkitBackdropFilter = '';
}

/** Включить преломление для элемента (обновляется при изменении размера). */
export function liquid(node) {
  if (!node || observed.has(node)) return node;
  const ro = new ResizeObserver(() => { if (enabled) apply(node); });
  observed.set(node, ro);
  ro.observe(node);
  if (enabled) requestAnimationFrame(() => apply(node));
  return node;
}

export function setLiquidEnabled(on) {
  enabled = on && refractionSupported();
  document.documentElement.classList.toggle('liquid', enabled);
  document.querySelectorAll('[data-liquid]').forEach((node) => {
    if (enabled) apply(node);
    else node.style.backdropFilter = '';
  });
  return enabled;
}

/** Блик, следующий за указателем (как glare в Liquid Glass Studio). */
export function glare(node) {
  node.addEventListener('pointermove', (e) => {
    const r = node.getBoundingClientRect();
    node.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
    node.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
  }, { passive: true });
  return node;
}
