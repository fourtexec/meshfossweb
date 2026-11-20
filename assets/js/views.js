// Экраны MESHFOSS Web.

import { t, lang, LANGS } from './i18n.js';
import {
  today, addDays, defaultHomeworkDate, summarizeMarks, cdzStatusText, cdzScoreText, cdzStartsTimer,
  decodeJwt, maskToken, loginUrl, round,
} from './core.js';
import {
  h, icon, button, glass, toast, confirmDialog, spinner, emptyState, errorState, daySelector,
  segmented, markBadge, formatDayShort,
} from './ui.js';
import { refractionSupported } from './glass.js';

export function describeError(e) {
  switch (e?.code) {
    case 'network': return t('error.network');
    case 'timeout': return t('error.timeout');
    case 'unauthorized': return t('error.unauthorized');
    case 'forbidden': return t('error.forbidden');
    default: return t('error.generic', e?.message || String(e));
  }
}

/** Общая обёртка загрузки: спиннер → контент/ошибка. Игнорирует устаревшие ответы. */
function loader(container, load, render) {
  const token = Symbol('load');
  container.dataset.loading = '';
  container.loadToken = token;
  container.replaceChildren(spinner());
  load().then((data) => {
    if (container.loadToken !== token) return;
    delete container.dataset.loading;
    container.replaceChildren(render(data));
  }, (e) => {
    if (container.loadToken !== token) return;
    delete container.dataset.loading;
    container.replaceChildren(errorState(describeError(e), () => loader(container, load, render)));
    if (e?.code === 'unauthorized') container.dispatchEvent(new CustomEvent('mesh:unauthorized', { bubbles: true }));
  });
}

// ---------------------------------------------------------------- расписание --

export function scheduleView(app) {
  const root = h('section.view');
  const body = h('div.view-body');
  const draw = () => {
    const date = app.state.scheduleDate || today();
    root.replaceChildren(
      daySelector(date, (d) => { app.state.scheduleDate = d; draw(); }, body),
      body,
    );
    loader(body, () => app.client.schedule(app.student.id, date), (lessons) => {
      if (!lessons.length) return emptyState(t('schedule.empty'), 'calendar-days');
      return h('ol.lessons', lessons.map((l) => glass(h(`li.card.lesson${l.isCancelled ? '.cancelled' : ''}`,
        h('div.lesson-time', h('strong', l.begin || ''), h('span.muted', l.end || '')),
        h('div.lesson-main',
          h('div.lesson-head',
            h('span.lesson-subject', l.subject),
            l.marks.map((m) => markBadge(m.value, m.markText)),
            l.isCancelled ? h('span.chip.chip-warn', t('schedule.cancelled')) : null),
          h('div.muted.small', [l.number ? t('schedule.lesson', l.number) : null, l.room, l.teacher].filter(Boolean).join(' · ')),
          l.homework ? h('a.lesson-hw', {
            href: '#/homeworks',
            on: { click: () => { app.state.homeworkDate = date; app.state.homeworkMode = 'due'; } },
          }, icon('book-open-check'), h('span', l.homework)) : null,
        )))));
    });
  };
  draw();
  return root;
}

// ------------------------------------------------------------------ ДЗ и ЦДЗ --

export function homeworksView(app) {
  const root = h('section.view');
  const body = h('div.view-body');
  const cdzCache = app.cdzCache;
  let homeworks = [];

  const draw = () => {
    const date = app.state.homeworkDate || defaultHomeworkDate();
    const mode = app.state.homeworkMode || 'due';
    root.replaceChildren(
      daySelector(date, (d) => { app.state.homeworkDate = d; draw(); }, body),
      segmented([['due', t('hw.due')], ['assigned', t('hw.assigned')]], mode, (m) => { app.state.homeworkMode = m; draw(); }),
      body,
    );
    loader(body, () => app.client.homeworks(app.student.id, addDays(date, -21), addDays(date, 21), t), (list) => {
      homeworks = list;
      const items = list.filter((hw) => (mode === 'assigned' ? hw.assignedOn : hw.dueDate) === date)
        .sort((a, b) => a.subjectName.localeCompare(b.subjectName, 'ru'));
      if (!items.length) return emptyState(t('hw.empty'), 'book-open-check');
      return h('div.homeworks', items.map((hw) => homeworkCard(app, hw, cdzCache)));
    });
  };

  // Вернулись на вкладку после прохождения ЦДЗ — перечитываем статус.
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !app.pendingCdz) return;
    const entry = app.pendingCdz;
    app.pendingCdz = null;
    const hw = homeworks.find((x) => x.homeworkEntryId === entry);
    const card = root.querySelector(`[data-entry="${CSS.escape(entry)}"]`);
    if (hw && card) refreshCdz(app, hw, card, cdzCache, true);
  };
  document.addEventListener('visibilitychange', onVisible);
  root.cleanup = () => document.removeEventListener('visibilitychange', onVisible);

  draw();
  return root;
}

function homeworkCard(app, hw, cdzCache) {
  const done = h('input', {
    type: 'checkbox', checked: hw.isDone, 'aria-label': t('hw.done'),
    on: {
      change: async (e) => {
        const target = e.target.checked;
        e.target.disabled = true;
        try {
          await app.client.setHomeworkDone(hw, target);
          hw.isDone = target;
          card.classList.toggle('done', target);
        } catch (err) {
          e.target.checked = !target;
          toast(describeError(err), 'error');
        } finally {
          e.target.disabled = false;
        }
      },
    },
  });
  const visible = hw.materials.filter((m) => !/^(attachments?|files?)$/i.test(m.type) && (m.title || m.typeName));
  const cdzCount = visible.filter((m) => m.isCdz).length;
  const progress = h('span.cdz-progress.muted.small');
  const materialsBox = h('div.materials');
  const card = glass(h(`article.card.homework${hw.isDone ? '.done' : ''}`, { dataset: { entry: hw.homeworkEntryId || hw.id } },
    h('header.homework-head',
      h('label.check', done, h('span.check-box', icon('check'))),
      h('h3', hw.subjectName),
      hw.assignedOn ? h('span.muted.small', t('hw.assignedOn', formatDayShort(hw.assignedOn))) : null),
    hw.description ? h('p.homework-text', hw.description) : null,
    hw.description ? h('button.icon-btn.copy', {
      type: 'button', title: t('common.copy'), 'aria-label': t('common.copy'),
      on: { click: () => navigator.clipboard?.writeText(hw.description).then(() => toast(t('common.copied'))) },
    }, icon('copy')) : null,
    visible.length ? h('div.section-title', h('span', t('hw.materials')), cdzCount ? progress : null) : null,
    visible.length ? materialsBox : null,
    hw.attachments.length ? h('div.section-title', h('span', t('hw.files'))) : null,
    hw.attachments.length ? h('ul.files', hw.attachments.map((a) => h('li',
      a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer' }, icon('paperclip'), a.name || 'file')
        : h('span', icon('paperclip'), a.name)))) : null,
  ));
  card._materials = visible;
  card._progress = progress;
  card._box = materialsBox;
  renderMaterials(app, hw, card, cdzCache.get(hw.homeworkEntryId), !cdzCache.has(hw.homeworkEntryId) && cdzCount > 0);
  if (cdzCount) refreshCdz(app, hw, card, cdzCache, false);
  return card;
}

function refreshCdz(app, hw, card, cdzCache, force) {
  const key = hw.homeworkEntryId;
  if (!key || !app.student.personId) return;
  if (!force && cdzCache.has(key)) return;
  renderMaterials(app, hw, card, cdzCache.get(key), true);
  app.client.cdzStatus(hw, app.student.personId, t)
    .then((info) => { cdzCache.set(key, info); renderMaterials(app, hw, card, info, false); })
    .catch(() => { cdzCache.set(key, {}); renderMaterials(app, hw, card, {}, false); });
}

function renderMaterials(app, hw, card, info, loading) {
  const materials = card._materials;
  const cdz = materials.filter((m) => m.isCdz);
  const doneCount = cdz.filter((m) => info?.[m.uuid]?.result?.done).length;
  if (card._progress) {
    card._progress.textContent = info && Object.keys(info).length ? t('cdz.progress', doneCount, cdz.length) : '';
    card._progress.classList.toggle('all-done', cdz.length > 0 && doneCount === cdz.length);
  }
  card._box.replaceChildren(...materials.map((m) => materialRow(app, hw, m, info?.[m.uuid], loading)));
}

function materialRow(app, hw, material, extended, loading) {
  const result = extended?.result;
  const isDone = !!result?.done;
  const typeLabel = extended?.typeName || material.typeName;
  const meta = [...new Set([typeLabel, extended?.partnerName].filter(Boolean))].join(' · ');
  let status = '';
  if (material.isCdz) {
    if (result) status = cdzStatusText(result, t, lang());
    else if (loading) status = t('cdz.checking');
    else if (extended?.resultError) status = t('cdz.statusFailed');
  }
  const score = material.isCdz ? cdzScoreText(result, t) : '';
  const canLaunch = (hw.homeworkEntryId && material.uuid) || material.url;
  const startBtn = canLaunch ? button(material.actionName || t('cdz.start'), {
    icon: 'play', kind: 'filled', on: () => launch(app, hw, material, startBtn),
  }) : null;
  const resultUrl = result?.resultUrl;
  return h(`div.material${isDone ? '.is-done' : ''}`,
    h('div.material-icon', icon(isDone ? 'circle-check' : material.isCdz ? 'list-checks' : 'external-link')),
    h('div.material-main',
      h('div.material-title', material.title || typeLabel),
      meta ? h('div.muted.small', meta) : null,
      extended?.description ? h('p.material-desc', extended.description) : null,
      status ? h(`div.material-status${isDone ? '.ok' : ''}`, loading && !result ? h('span.loader.tiny') : null, status) : null,
      score ? h('div.material-score', score) : null,
      (startBtn || resultUrl) ? h('div.material-actions',
        startBtn,
        resultUrl ? button(t('cdz.result'), { icon: 'external-link', kind: 'outline', on: () => openResult(resultUrl) }) : null) : null,
    ));
}

function openResult(url) {
  if (url.startsWith('demo:')) { toast(t('cdz.demoOpened')); return; }
  window.open(url, '_blank', 'noopener');
}

/**
 * Запуск ЦДЗ: каждый раз новая одноразовая ссылка (§7). Вкладку открываем
 * синхронно в обработчике клика, иначе её заблокирует браузер, а адрес
 * подставляем, когда МЭШ его вернёт.
 */
async function launch(app, hw, material, btn) {
  if (!material.isCdz && material.url) { window.open(material.url, '_blank', 'noopener'); return; }
  if (cdzStartsTimer(material.type)) {
    const ok = await confirmDialog({
      title: t('cdz.timerTitle'), body: [h('p.strong', material.title), t('cdz.timerText'), h('p.muted.small', t('cdz.sessionNote'))],
      ok: t('cdz.begin'),
    });
    if (!ok) return;
  }
  const tab = app.demo ? null : window.open('about:blank', '_blank');
  const label = btn.querySelector('span');
  const previous = label?.textContent;
  btn.disabled = true;
  if (label) label.textContent = t('cdz.opening');
  try {
    const url = await app.client.launchMaterial(hw.homeworkEntryId, material.uuid);
    app.pendingCdz = hw.homeworkEntryId;
    if (url.startsWith('demo:')) {
      toast(t('cdz.demoOpened'));
      app.pendingCdz = null;
      const card = btn.closest('.homework');
      if (card) refreshCdz(app, hw, card, app.cdzCache, true);
    } else if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else if (!window.open(url, '_blank', 'noopener')) {
      toast(t('cdz.popupBlocked'), 'error');
    }
  } catch (e) {
    tab?.close();
    toast(describeError(e), 'error');
  } finally {
    btn.disabled = false;
    if (label) label.textContent = previous;
  }
}

// ------------------------------------------------------------------ оценки --

export function marksView(app) {
  const root = h('section.view');
  const body = h('div.view-body');
  root.append(h('div.view-title', h('h2', t('nav.marks')), h('span.chip', t('marks.period'))), body);
  const to = today();
  loader(body, () => app.client.marks(app.student.id, addDays(to, -30), to), (marks) => {
    if (!marks.length) return emptyState(t('marks.empty'), 'chart-column');
    const s = summarizeMarks(marks);
    const maxCount = Math.max(1, ...s.byValue.map((b) => b.count));
    return h('div.marks',
      h('div.kpis',
        glass(h('div.card.kpi', h('span.muted.small', t('marks.average')), h('strong', s.average ?? '—'))),
        glass(h('div.card.kpi', h('span.muted.small', t('marks.weighted')), h('strong', s.weightedAverage ?? '—'))),
        glass(h('div.card.kpi', h('span.muted.small', t('marks.count')), h('strong', s.count)))),
      glass(h('div.card.histogram', s.byValue.map((b) => h('div.bar-col',
        h('div.bar', { class: `bar-${b.value}`, style: { height: `${(b.count / maxCount) * 100}%` } }),
        h('span.bar-count', b.count), markBadge(b.value))))),
      h('h3.section-heading', t('marks.bySubject')),
      h('div.subjects', s.bySubject.map((g) => glass(h('details.card.subject',
        h('summary', h('span.subject-name', g.subjectName), h('span.muted.small', `×${g.count}`), markBadge(g.average, g.average ?? '—')),
        h('ul.mark-list', g.marks.map((m) => h('li',
          markBadge(m.value, m.markText),
          h('span', m.controlForm),
          m.weight > 1 ? h('span.chip', `×${m.weight}`) : null,
          h('span.muted.small', formatDayShort(m.date))))))))),
    );
  });
  return root;
}

// ----------------------------------------------------------------- рейтинг --

export function rankingView(app) {
  const root = h('section.view');
  const body = h('div.view-body');
  root.append(h('div.view-title', h('h2', t('nav.ranking'))), body);
  loader(body, () => app.client.rankBoard(app.student.personId, today()), (rows) => {
    if (!rows.length) return emptyState(t('rank.empty'), 'trophy');
    const avgs = rows.map((r) => r.average).filter((v) => v !== null);
    const classAvg = avgs.length ? round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null;
    const me = rows.find((r) => r.isMe);
    return h('div.ranking',
      h('div.kpis',
        me ? glass(h('div.card.kpi', h('span.muted.small', t('rank.place')), h('strong', `#${me.place}`))) : null,
        me ? glass(h('div.card.kpi', h('span.muted.small', t('marks.average')), h('strong', me.average ?? '—'))) : null,
        glass(h('div.card.kpi', h('span.muted.small', t('rank.classAvg')), h('strong', classAvg ?? '—')))),
      glass(h('ol.card.rank-table', rows.map((r) => h(`li${r.isMe ? '.me' : ''}`,
        h('span.rank-place', r.place),
        h('span.rank-name', r.isMe ? `${r.name} · ${t('rank.you')}` : r.name),
        r.placeDelta ? h(`span.delta${r.placeDelta > 0 ? '.up' : '.down'}`, r.placeDelta > 0 ? `▲${r.placeDelta}` : `▼${-r.placeDelta}`) : h('span.delta'),
        markBadge(r.average, r.average === null ? '—' : r.average.toFixed(2)))))),
    );
  });
  return root;
}

// --------------------------------------------------------------- настройки --

export function settingsView(app) {
  const s = app.settings;
  const jwt = decodeJwt(app.client.token);
  const expires = jwt?.exp ? new Date(jwt.exp * 1000).toLocaleString(lang()) : null;
  const select = (value, options, onChange) => h('select.select', { on: { change: (e) => onChange(e.target.value) } },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  const row = (label, control, hint) => h('div.setting', h('div', h('div', label), hint ? h('div.muted.small', hint) : null), control);
  const toggle = (checked, onChange, disabled) => h('label.switch',
    h('input', { type: 'checkbox', checked, disabled, on: { change: (e) => onChange(e.target.checked) } }), h('span'));

  return h('section.view',
    h('div.view-title', h('h2', t('nav.settings'))),
    glass(h('div.card.settings-card',
      h('h3', icon('user'), t('settings.student')),
      h('div.student', h('strong', app.student.name), h('span.muted', [app.student.className, app.student.schoolName].filter(Boolean).join(' · '))),
      app.profile.children.length > 1 ? row(t('settings.student'), select(app.student.id,
        app.profile.children.map((c) => [c.id, c.name]), (id) => app.selectStudent(id))) : null)),
    glass(h('div.card.settings-card',
      h('h3', icon('sparkles'), t('settings.appearance')),
      row(t('settings.theme'), select(s.theme, [['auto', t('settings.theme.auto')], ['dark', t('settings.theme.dark')], ['light', t('settings.theme.light')]],
        (v) => app.updateSettings({ theme: v }))),
      row(t('settings.glass'), toggle(s.liquid, (v) => app.updateSettings({ liquid: v }), !refractionSupported()), t('settings.glassHint')),
      row(t('settings.language'), select(lang(), Object.entries(LANGS), (v) => app.updateSettings({ lang: v }))))),
    glass(h('div.card.settings-card',
      h('h3', icon('server'), t('settings.connection')),
      app.demo ? h('p', h('span.chip', t('common.demoBadge')), ' ', t('login.demoHint')) : [
        row(t('login.proxyLabel'), h('code.small', s.proxy || location.origin)),
        row(t('settings.token'), h('code.small', maskToken(app.client.token)), expires ? t('settings.tokenExpires', expires) : null),
        h('div.actions', button(t('settings.refreshToken'), {
          icon: 'refresh-cw', on: async () => {
            const fresh = await app.client.refreshToken();
            toast(fresh ? t('settings.tokenRefreshed') : t('settings.tokenNotRefreshed'), fresh ? 'info' : 'error');
          },
        })),
      ],
      h('div.actions', button(t('settings.signOut'), { icon: 'log-out', kind: 'outline', on: () => app.signOut() })))),
    glass(h('div.card.settings-card',
      h('h3', icon('info'), t('settings.about')),
      h('p.muted', t('settings.aboutText')),
      h('p', h('a', { href: 'https://github.com/photonest444/meshfossweb', target: '_blank', rel: 'noopener' }, icon('external-link'), t('settings.source')),
        ' · ', h('a', { href: 'https://github.com/fourtexec/MESHFOSS', target: '_blank', rel: 'noopener' }, 'MESHFOSS (Android)')))),
  );
}

// -------------------------------------------------------------------- вход --

export function loginView(app, { error } = {}) {
  const s = app.settings;
  const proxy = h('input.input', { type: 'url', placeholder: 'https://mesh-proxy.example.workers.dev', value: s.proxy || '', autocomplete: 'off', spellcheck: false });
  const token = h('textarea.input', { rows: 3, placeholder: 'eyJhbGciOi…', autocomplete: 'off', spellcheck: false });
  const message = h('p.form-error', { role: 'alert' }, error || '');
  const submit = h('button.btn.btn-filled.wide', { type: 'submit' }, icon('key-round'), h('span', t('login.signIn')));
  const form = h('form.login-form', {
    on: {
      submit: async (e) => {
        e.preventDefault();
        message.textContent = '';
        const base = proxy.value.trim() || (app.sameOriginProxy ? '' : null);
        if (base === null) { message.textContent = t('login.needProxy'); proxy.focus(); return; }
        submit.disabled = true;
        try {
          await app.signIn(token.value, base);
        } catch (err) {
          message.textContent = err?.code === 'bad-token' ? t('login.badToken') : describeError(err);
        } finally {
          submit.disabled = false;
        }
      },
    },
  },
  h('label.field', h('span', t('login.tokenLabel')), token, h('span.muted.small', t('login.tokenHint'))),
  h('a.link', { href: loginUrl(), target: '_blank', rel: 'noopener' }, icon('external-link'), t('login.openTokenPage')),
  app.sameOriginProxy ? null : h('label.field', h('span', t('login.proxyLabel')), proxy, h('span.muted.small', t('login.proxyHint'))),
  message,
  submit);

  return h('main.login',
    glass(h('div.login-card',
      h('div.brand', h('div.logo', icon('graduation-cap')), h('div', h('h1', 'MESHFOSS'), h('p.muted', t('app.tagline')))),
      form,
      h('div.divider'),
      h('button.btn.btn-tonal.wide', { type: 'button', on: { click: () => app.startDemo() } }, icon('sparkles'), h('span', t('login.demo'))),
      h('p.muted.small.center', t('login.demoHint')),
      h('div.login-foot', select(lang(), (v) => app.updateSettings({ lang: v })))), { refract: true }),
  );

  function select(value, onChange) {
    return h('label.lang', icon('languages'), h('select.select', { 'aria-label': t('settings.language'), on: { change: (e) => onChange(e.target.value) } },
      Object.entries(LANGS).map(([v, label]) => h('option', { value: v, selected: v === value }, label))));
  }
}
