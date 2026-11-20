#!/usr/bin/env node
// Собирает SVG-спрайт из набора Lucide в iconkit (https://github.com/fourtexec/iconkit).
// Использование: node tools/build-icons.mjs /path/to/iconkit
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ICONS = [
  'calendar-days', 'book-open-check', 'chart-column', 'trophy', 'settings', 'log-out',
  'refresh-cw', 'chevron-left', 'chevron-right', 'check', 'circle-check', 'circle-dashed',
  'external-link', 'play', 'clock', 'sparkles', 'key-round', 'moon', 'sun', 'copy', 'x',
  'user', 'graduation-cap', 'paperclip', 'timer', 'list-checks', 'flask-conical', 'server',
  'shield-check', 'languages', 'info', 'triangle-alert', 'loader-circle'
];

const root = process.argv[2];
if (!root) {
  console.error('usage: node tools/build-icons.mjs <path-to-iconkit>');
  process.exit(1);
}
const symbols = ICONS.map((name) => {
  const svg = readFileSync(join(root, 'icons/lucide', `${name}.svg`), 'utf8');
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim()
    .split('\n').map((line) => line.trim()).filter(Boolean).join('');
  return `<symbol id="i-${name}" viewBox="0 0 24 24">${body}</symbol>`;
});
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">` +
  `<!-- Lucide icons (ISC License) via fourtexec/iconkit -->${symbols.join('')}</svg>\n`;
writeFileSync(new URL('../assets/icons/sprite.svg', import.meta.url), sprite);
console.log(`sprite: ${ICONS.length} icons`);
