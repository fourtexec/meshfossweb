// MESHFOSS Web — оболочка приложения: состояние, маршруты, навигация.

import { MeshClient, MeshError } from './api.js';
import { createDemoFetch, DEMO_TOKEN } from './demo.js';
import { extractToken, looksLikeToken } from './core.js';
import { t, setLang, detectLang } from './i18n.js';
import { h, icon, glass, loadSprite, toast } from './ui.js';
import { setStudioEnabled } from './studio.js';
import { scheduleView, homeworksView, marksView, rankingView, settingsView, loginView } from './views.js';

const STORE_KEY = 'meshfoss.web.v1';

const TABS = [
  ['schedule', 'calendar-days', 'nav.schedule', scheduleView],
  ['homeworks', 'book-open-check', 'nav.homeworks', homeworksView],
  ['marks', 'chart-column', 'nav.marks', marksView],
  ['ranking', 'trophy', 'nav.ranking', rankingView],
  ['settings', 'settings', 'nav.settings', settingsView],
];

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

function saveStore(data) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch { /* приватный режим */ }
}

class App {
  constructor() {
    const stored = loadStore();
    this.settings = {
      theme: 'auto', lang: detectLang(), liquid: true, proxy: '',
      ...stored.settings,
    };
    this.session = stored.session || null; // { token, studentId, demo }
    this.state = {}; // выбранные даты/режимы экранов (на время сессии)
    this.cdzCache = new Map();
    this.pendingCdz = null;
    this.sameOriginProxy = false;
    this.root = document.getElementById('app');
    this.currentView = null;
  }

  persist() {
    saveStore({ settings: this.settings, session: this.session });
  }

  applyAppearance() {
    setLang(this.settings.lang);
    const theme = this.settings.theme;
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    setStudioEnabled(this.settings.liquid);
    document.title = 'MESHFOSS';
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this.persist();
    this.applyAppearance();
    if (this.client) this.renderShell(); else this.renderLogin();
  }

  async start() {
    await loadSprite();
    // proxy.json отдаёт proxy/server.mjs: значит, прокси на том же адресе.
    try {
      const res = await fetch('proxy.json', { cache: 'no-store' });
      if (res.ok) {
        const cfg = await res.json();
        if (typeof cfg.base === 'string') { this.sameOriginProxy = true; this.defaultProxy = cfg.base; }
      }
    } catch { /* статический хостинг */ }
    this.applyAppearance();
    window.addEventListener('hashchange', () => this.client && this.renderView());
    this.root.addEventListener('mesh:unauthorized', () => this.onUnauthorized());

    if (this.session?.token) {
      try {
        await this.openSession(this.session);
        return;
      } catch (e) {
        if (e?.code !== 'unauthorized') {
          this.renderLogin(e.message);
          return;
        }
      }
    }
    this.renderLogin();
  }

  makeClient(token, demo, base) {
    return new MeshClient({
      base: demo ? '' : (base ?? (this.settings.proxy || this.defaultProxy || '')),
      token,
      fetch: demo ? createDemoFetch() : null,
      onToken: (fresh) => {
        if (this.session) { this.session.token = fresh; this.persist(); }
      },
    });
  }

  async openSession(session, base) {
    const client = this.makeClient(session.token, session.demo, base);
    const profile = await client.profile();
    if (!profile.children.length) throw new MeshError('В профиле нет учеников', 'no-student');
    this.client = client;
    this.profile = profile;
    this.demo = !!session.demo;
    this.student = profile.children.find((c) => c.id === session.studentId) || profile.children[0];
    client.profileId = this.student.id;
    this.session = { token: client.token, studentId: this.student.id, demo: this.demo };
    this.persist();
    if (!location.hash) location.replace('#/schedule');
    this.renderShell();
  }

  async signIn(raw, base) {
    const token = extractToken(raw);
    if (!token || !looksLikeToken(token)) throw new MeshError('bad token', 'bad-token');
    const proxy = base === '' && this.sameOriginProxy ? this.defaultProxy : base;
    this.settings.proxy = this.sameOriginProxy ? '' : proxy;
    this.persist();
    await this.openSession({ token }, proxy);
  }

  async startDemo() {
    await this.openSession({ token: DEMO_TOKEN, demo: true });
    toast(t('login.demoHint'));
  }

  selectStudent(id) {
    const child = this.profile.children.find((c) => c.id === id);
    if (!child) return;
    this.student = child;
    this.client.profileId = id;
    this.session.studentId = id;
    this.cdzCache.clear();
    this.persist();
    this.renderShell();
  }

  signOut() {
    this.client = null;
    this.session = null;
    this.cdzCache.clear();
    this.state = {};
    this.persist();
    history.replaceState(null, '', location.pathname);
    this.renderLogin();
  }

  onUnauthorized() {
    if (this.demo) return;
    this.signOut();
    this.renderLogin(t('error.unauthorized'));
  }

  // ---------------------------------------------------------------- render --

  renderLogin(error) {
    this.currentView?.cleanup?.();
    this.currentView = null;
    this.root.replaceChildren(loginView(this, { error }));
  }

  route() {
    const key = (location.hash.match(/^#\/(\w+)/) || [])[1];
    return TABS.find((tab) => tab[0] === key) || TABS[0];
  }

  renderShell() {
    const header = glass(h('header.topbar',
      h('div.brand-mini', h('div.logo.small', icon('graduation-cap')), h('strong', 'MESHFOSS'),
        this.demo ? h('span.chip', t('common.demoBadge')) : null),
      h('div.student-mini', h('span', this.student.shortName || this.student.name),
        this.student.className ? h('span.muted.small', this.student.className) : null),
    ));
    this.main = h('main.content', { id: 'content', tabindex: '-1' });
    this.nav = this.buildNav();
    this.root.replaceChildren(header, this.main, this.nav);
    this.renderView();
  }

  renderView() {
    const [key, , , view] = this.route();
    this.currentView?.cleanup?.();
    this.currentView = view(this);
    this.main.replaceChildren(this.currentView);
    this.main.scrollTo?.({ top: 0 });
    this.nav.querySelectorAll('a.tab').forEach((a) => {
      const active = a.dataset.tab === key;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    this.moveLens(key, true);
  }

  /**
   * Нижняя панель с «линзой» — стеклянная капля под активной вкладкой, как в
   * Android-версии: её можно тянуть пальцем, она прилипает к ближайшей вкладке.
   */
  buildNav() {
    // Линза — отдельная фигура Studio, слитая с панелью через smin: при
    // перетаскивании она выпячивается из панели, как вторая фигура в Studio.
    const lens = h('div.lens', { 'aria-hidden': 'true', dataset: { studio: '' } });
    // draggable=false: иначе нативное перетаскивание ссылки отменяет жест линзы (pointercancel).
    const tabs = TABS.map(([key, ic, label]) => h('a.tab', { href: `#/${key}`, draggable: 'false', dataset: { tab: key } }, icon(ic), h('span', t(label))));
    const nav = glass(h('nav.tabbar', { 'aria-label': 'MESHFOSS' }, lens, ...tabs));
    let drag = null;
    nav.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { x: e.clientX, moved: false, id: e.pointerId };
    });
    nav.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (Math.abs(e.clientX - drag.x) > 6) {
        drag.moved = true;
        nav.setPointerCapture(e.pointerId);
      }
      if (!drag.moved) return;
      const r = nav.getBoundingClientRect();
      const w = lens.offsetWidth;
      const x = Math.max(4, Math.min(r.width - w - 4, e.clientX - r.left - w / 2));
      lens.classList.add('dragging');
      lens.style.transform = `translateX(${x}px) scale(1.18, 1.32)`;
    });
    const end = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const wasDrag = drag.moved;
      drag = null;
      lens.classList.remove('dragging');
      if (!wasDrag) return;
      // Магнитное прилипание к ближайшей вкладке.
      const nearest = tabs.reduce((best, tab) => {
        const r = tab.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - e.clientX);
        return d < best.d ? { d, tab } : best;
      }, { d: Infinity, tab: null }).tab;
      if (nearest) {
        const key = nearest.dataset.tab;
        if (location.hash !== `#/${key}`) location.hash = `#/${key}`;
        else this.moveLens(key, false);
      }
    };
    nav.addEventListener('dragstart', (e) => e.preventDefault());
    nav.addEventListener('pointerup', end);
    nav.addEventListener('pointercancel', end);
    nav.addEventListener('click', (e) => { if (lens.classList.contains('dragging')) e.preventDefault(); });
    new ResizeObserver(() => this.moveLens(this.route()[0], true)).observe(nav);
    return nav;
  }

  moveLens(key, instant) {
    const lens = this.nav?.querySelector('.lens');
    const tab = this.nav?.querySelector(`a.tab[data-tab="${key}"]`);
    if (!lens || !tab) return;
    const navRect = this.nav.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (!navRect.width) return;
    lens.style.width = `${r.width}px`;
    if (instant && !lens.dataset.placed) lens.style.transition = 'none';
    lens.style.transform = `translateX(${r.left - navRect.left}px)`;
    lens.dataset.placed = '1';
    requestAnimationFrame(() => { lens.style.transition = ''; });
  }
}

const app = new App();
window.meshfoss = app; // для отладки из консоли
app.start().catch((e) => {
  console.error(e);
  app.renderLogin(e?.message);
});
