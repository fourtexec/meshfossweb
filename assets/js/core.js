// Ядро MESHFOSS Web: разбор ответов МЭШ. Порт MeshCore.kt / Cdz.kt из
// Android-клиента (github.com/fourtexec/MESHFOSS). Модуль без DOM — тестируется
// в Node (`node --test`).

export const HOST = 'https://school.mos.ru';
export const ROLE_ID = '1';
export const SUBSYSTEM = 'familyweb';
export const SUBSYSTEM_ID = '2';

export const Paths = {
  PROFILE: '/api/family/web/v1/profile',
  PROFILE_BY_ID: '/api/gamification/v1/profiles',
  SUBJECTS: '/api/ej/rating/v1/rank/subjects',
  RANK: '/api/ej/rating/v1/rank/class',
  MARKS: '/api/family/web/v1/marks',
  HOMEWORKS: '/api/family/web/v1/homeworks',
  HOMEWORK_LAUNCH: '/api/ej/partners/v1/homeworks/launch',
  ADDITIONAL_MATERIALS: '/api/family/materials/v1/additional_materials',
  LRS_RESULTS: '/api/lrs/v2/results',
  SCHEDULE: '/api/family/web/v1/schedule',
  TOKEN_REFRESH: '/v2/token/refresh',
  homeworkDone: (entryStudentId) => `/api/family/web/v1/homeworks/${entryStudentId}/done`,
};

export const loginUrl = () => `${HOST}${Paths.TOKEN_REFRESH}?roleId=${ROLE_ID}&subsystem=${SUBSYSTEM_ID}`;

// ------------------------------------------------------------------ helpers --

export const isNil = (v) => v === null || v === undefined;

export function asString(value) {
  if (isNil(value)) return '';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  return String(value);
}

export function asNumber(value) {
  if (isNil(value) || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

export function asBool(value) {
  if (isNil(value)) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'да', 'yes'].includes(String(value).trim().toLowerCase());
}

export function firstDefined(...values) {
  for (const v of values) {
    if (!isNil(v) && !(typeof v === 'string' && v.trim() === '')) return v;
  }
  return null;
}

export const round = (v, digits = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** digits) / 10 ** digits);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function gradeColor(mark) {
  if (mark === null || mark === undefined) return 'none';
  const r = Math.round(mark);
  if (r >= 5) return 'green';
  if (r === 4) return 'yellow';
  if (r === 3) return 'orange';
  return 'red';
}

export function payloadList(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  for (const key of ['payload', 'items', 'data', 'lessons', 'activities']) {
    if (Array.isArray(json[key])) return json[key];
  }
  return [];
}

// ------------------------------------------------------------------- даты --

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => isoOf(new Date());

export function toIso(value) {
  const text = asString(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return '';
}

export function parseIso(iso) {
  const [y, mo, d] = toIso(iso).split('-').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1);
}

export function addDays(iso, days) {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

/** По умолчанию ДЗ на завтра; в пятницу–воскресенье — на понедельник. */
export function defaultHomeworkDate(base = today()) {
  const wd = parseIso(base).getDay(); // 0 — воскресенье
  if (wd === 5) return addDays(base, 3);
  if (wd === 6) return addDays(base, 2);
  return addDays(base, 1);
}

// ------------------------------------------------------------------ токен --

const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/;

export function looksLikeToken(value) {
  const text = asString(value).trim();
  if (text.length < 20 || /\s/.test(text)) return false;
  if (JWT_RE.test(text)) return true;
  return /^[A-Za-z0-9._~+/=-]{24,}$/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text);
}

/** Токен из вставленного текста: голый JWT, JSON {token}, URL с ?token= или cookie-строка. */
export function extractToken(source) {
  const text = asString(source).trim();
  if (!text) return null;
  const cookie = /aupd_token=([^;\s]+)/.exec(text);
  if (cookie) return cookie[1];
  const urlParam = /[?#&](?:token|access_token|auth_token)=([^&#\s]+)/i.exec(text);
  if (urlParam) {
    const decoded = decodeURIComponent(urlParam[1]);
    if (looksLikeToken(decoded)) return decoded;
  }
  try {
    const json = JSON.parse(text);
    const found = findTokenInJson(json, 0);
    if (found) return found;
  } catch { /* не JSON */ }
  const jwt = JWT_RE.exec(text);
  if (jwt) return jwt[0];
  return looksLikeToken(text) ? text : null;
}

function findTokenInJson(node, depth) {
  if (node === null || depth > 6) return null;
  if (typeof node === 'string') return looksLikeToken(node) ? node.trim() : null;
  if (Array.isArray(node)) {
    for (const v of node) { const t = findTokenInJson(v, depth + 1); if (t) return t; }
    return null;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/^(token|access_token|accessToken|auth_token|authToken|jwt)$/i.test(k) && looksLikeToken(v)) return String(v).trim();
    }
    for (const v of Object.values(node)) { const t = findTokenInJson(v, depth + 1); if (t) return t; }
  }
  return null;
}

export function decodeJwt(token) {
  const parts = asString(token).split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function maskToken(token) {
  const t = asString(token);
  if (!t) return '—';
  return t.length <= 12 ? '•'.repeat(t.length) : `${t.slice(0, 6)}…${t.slice(-4)}`;
}

// ---------------------------------------------------------------- профиль --

const personName = (...parts) => parts.map((p) => asString(p).trim()).filter(Boolean).join(' ');

export function normalizeChild(child) {
  const school = child.school || {};
  const last = firstDefined(child.last_name, child.lastName);
  const first = firstDefined(child.first_name, child.firstName);
  const middle = firstDefined(child.middle_name, child.middleName);
  const name = personName(last, first, middle) || asString(firstDefined(child.name, 'Ученик'));
  return {
    id: asString(firstDefined(child.id, child.user_id, child.student_id)),
    personId: asString(firstDefined(child.contingent_guid, child.person_id, child.personId)),
    name,
    shortName: asString(first) || name,
    className: asString(firstDefined(child.class_name, child.className)),
    schoolName: asString(firstDefined(child.school_name, child.schoolName, school.name, school.short_name)),
  };
}

export function normalizeProfile(json) {
  const children = (json?.children || []).map(normalizeChild);
  const rep = json?.children?.[0]?.representatives?.[0] || json?.profile || {};
  return {
    parent: { name: personName(rep.last_name, rep.first_name, rep.middle_name) },
    children,
    defaultChild: children[0] || null,
  };
}

// ----------------------------------------------------------------- оценки --

export function normalizeMark(mark) {
  const raw = firstDefined(mark.value, mark.mark);
  return {
    id: asString(firstDefined(mark.id, mark.mark_id)),
    value: asNumber(raw),
    markText: asString(raw),
    subjectId: asString(firstDefined(mark.subject_id, mark.subjectId)),
    subjectName: asString(firstDefined(mark.subject_name, mark.subjectName, '—')),
    controlForm: asString(firstDefined(mark.control_form_name, mark.controlForm, '—')),
    weight: asNumber(mark.weight) ?? 1,
    date: toIso(asString(firstDefined(mark.created_at, mark.date))) || today(),
    comment: asString(mark.comment),
    isExam: asBool(firstDefined(mark.is_exam, mark.isExam)),
  };
}

export function summarizeMarks(marks) {
  const values = marks.map((m) => m.value).filter((v) => v !== null);
  let ws = 0;
  let w = 0;
  for (const m of marks) {
    if (m.value === null) continue;
    const weight = m.weight > 0 ? m.weight : 1;
    ws += m.value * weight;
    w += weight;
  }
  const groups = new Map();
  for (const m of marks) {
    const key = m.subjectId || m.subjectName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const bySubject = [...groups.values()].map((group) => {
    const vs = group.map((m) => m.value).filter((v) => v !== null);
    const avg = round(mean(vs));
    return {
      subjectId: group[0].subjectId,
      subjectName: group[0].subjectName,
      count: group.length,
      average: avg,
      color: gradeColor(avg),
      marks: [...group].sort((a, b) => b.date.localeCompare(a.date)),
    };
  }).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  return {
    count: marks.length,
    average: round(mean(values)),
    weightedAverage: w > 0 ? round(ws / w) : null,
    bySubject,
    byValue: [5, 4, 3, 2].map((value) => ({ value, count: values.filter((v) => Math.round(v) === value).length })),
  };
}

// ------------------------------------------------------------- расписание --

export function normalizeSchedule(json, defaultDate) {
  const lessons = [];
  const push = (item, dayIso) => {
    if (!item) return;
    const lesson = item.lesson || {};
    const type = asString(item.type).toUpperCase();
    if (['BREAK', 'WINDOW', 'EMPTY', 'LUNCH'].includes(type)) return;
    const begin = asString(firstDefined(item.begin_time, item.start_time, item.time));
    const end = asString(firstDefined(item.end_time, item.finish_time));
    const subject = asString(firstDefined(lesson.subject_name, item.subject_name, item.subject?.name));
    if (!subject || subject === '—' || (!begin && !end)) return;
    const teacherObj = lesson.teacher || item.teacher || {};
    const teacher = asString(firstDefined(
      teacherObj.fio, item.teacher_name,
      personName(teacherObj.last_name, teacherObj.first_name, teacherObj.middle_name),
    ));
    const roomNumber = asString(firstDefined(item.room_number, lesson.room_number, item.room?.number));
    const roomName = asString(firstDefined(item.room_name, lesson.room_name, item.room?.name));
    const marks = (lesson.marks || item.marks || []).map(normalizeMark);
    const markRaw = firstDefined(lesson.mark, item.mark);
    if (!marks.length && !isNil(markRaw)) marks.push({ value: asNumber(markRaw), markText: asString(markRaw), weight: 1 });
    lessons.push({
      date: toIso(firstDefined(item.date, dayIso, defaultDate)),
      number: asNumber(firstDefined(item.lesson_number, item.number, lesson.lesson_number)),
      begin: begin ? begin.slice(0, 5) : null,
      end: end ? end.slice(0, 5) : null,
      subjectId: asString(firstDefined(lesson.subject_id, item.subject_id)),
      subject,
      teacher,
      room: roomNumber ? (/каб|зал|спорт/i.test(roomNumber) ? roomNumber : `каб. ${roomNumber}`) : roomName,
      homework: asString(firstDefined(lesson.homework, item.homework, item.home_task)).trim(),
      marks,
      isCancelled: asBool(firstDefined(lesson.is_cancelled, item.is_cancel, item.isCancelled)),
    });
  };
  if (Array.isArray(json?.activities)) {
    json.activities.forEach((a) => push(a, defaultDate));
  } else {
    for (const entry of payloadList(json)) {
      const day = asString(firstDefined(entry.date, entry.day));
      const nested = entry.lessons || entry.items;
      if (Array.isArray(nested)) nested.forEach((l) => push(l, day));
      else push(entry, day || null);
    }
  }
  return lessons.sort((a, b) => a.date.localeCompare(b.date) || asString(a.begin).localeCompare(asString(b.begin)));
}

// ------------------------------------------------------------- рейтинг ----

export function buildRankTable(members, names, meId) {
  return members.map((member, i) => {
    const rank = member.rank || {};
    const prev = member.previousRank || member.previous_rank || {};
    const personId = asString(firstDefined(member.personId, member.person_id));
    const average = asNumber(firstDefined(rank.averageMarkFive, rank.average_mark, member.averageMarkFive));
    const place = asNumber(firstDefined(rank.rankPlace, rank.place)) ?? i + 1;
    const prevPlace = asNumber(firstDefined(prev.rankPlace, prev.place));
    return {
      personId,
      place,
      average,
      placeDelta: prevPlace === null ? null : prevPlace - place,
      name: names[personId] || 'Без имени',
      isMe: !!meId && personId === meId,
      color: gradeColor(average),
    };
  }).sort((a, b) => a.place - b.place || (b.average ?? 0) - (a.average ?? 0));
}

// ------------------------------------------------------------------ ЦДЗ ----
// docs/mesh-cdz-api.md: §5 additional_materials, §6 LRS, §7 launch.

export const Cdz = {
  WORK_TYPE_HOMEWORK: '1',
  PURPOSE_HOME: 'for_home',
  TYPE_FIZIKON: 'fizikon_module',
  TYPE_TEST_TASK: 'test_task_binding',
  TYPE_TEST_SPEC: 'test_spec_binding',
};

const KNOWN_CDZ = new Set([Cdz.TYPE_FIZIKON, Cdz.TYPE_TEST_TASK, Cdz.TYPE_TEST_SPEC]);
const ATTACHMENT_TYPES = new Set(['attachment', 'attachments', 'file', 'files']);

export function isCdz(material) {
  const type = asString(material?.type).toLowerCase();
  if (ATTACHMENT_TYPES.has(type)) return false;
  if (!asString(material?.uuid)) return false;
  return KNOWN_CDZ.has(type) || asString(material.selected_mode).toLowerCase() === 'execute' || Number(material.action_id) === 1;
}

/** Подпись типа как в веб-дневнике. `t` — функция перевода. */
export function cdzTypeLabel(type, fallback, t = (k) => k) {
  switch (asString(type).toLowerCase()) {
    case Cdz.TYPE_FIZIKON: return t('cdz.type.selfWork');
    case Cdz.TYPE_TEST_TASK: return t('cdz.type.task');
    case Cdz.TYPE_TEST_SPEC: return t('cdz.type.topicTest');
    default: return asString(fallback).trim();
  }
}

export const cdzStartsTimer = (type) => asString(type).toLowerCase() === Cdz.TYPE_FIZIKON;

export function absoluteUrl(raw) {
  const text = asString(raw).trim();
  if (!text || text === 'null') return '';
  if (text.startsWith('//')) return `https:${text}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  return HOST + (text.startsWith('/') ? text : `/${text}`);
}

function materialUrls(material) {
  const out = new Set();
  const walk = (v, depth) => {
    if (isNil(v) || depth > 5) return;
    if (typeof v === 'string') { const u = absoluteUrl(v); if (u) out.add(u); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v === 'object') {
      for (const k of ['url', 'link', 'href', 'urls', 'action', 'target', 'resource']) if (k in v) walk(v[k], depth + 1);
    }
  };
  walk(material, 0);
  return [...out];
}

export function normalizeHomework(item, t) {
  const materials = [];
  const attachments = [];
  for (const m of item.materials || []) {
    const type = asString(m.type);
    const title = asString(firstDefined(m.title, m.name));
    const urls = materialUrls(m);
    const cdz = isCdz(m);
    materials.push({
      type,
      typeName: cdzTypeLabel(type, m.type_name, t),
      title,
      actionName: asString(m.action_name),
      uuid: asString(m.uuid),
      selectedMode: asString(m.selected_mode),
      isCdz: cdz,
      // Ссылки ЦДЗ без контекста ДЗ не засчитываются — только launch (§5, §12.5).
      url: cdz ? '' : (urls[0] || ''),
    });
    if (ATTACHMENT_TYPES.has(type.toLowerCase())) {
      urls.forEach((url, i) => attachments.push({ name: urls.length > 1 ? `${title} ${i + 1}` : title, url }));
    }
  }
  for (const a of item.attachments || []) {
    attachments.push({
      name: asString(firstDefined(a.name, a.file_name)),
      url: absoluteUrl(firstDefined(a.url, a.link, a.href)),
    });
  }
  const due = asString(firstDefined(item.date_prepared_for, item.date_prepared, item.deadline));
  const assigned = asString(firstDefined(item.date_assigned_on, item.date_assigned, item.date));
  return {
    id: asString(firstDefined(item.homework_entry_student_id, item.homework_id, item.id)),
    // Launch и LRS — homework_entry_id; «выполнено» и additional_materials —
    // homework_entry_student_id. Их легко перепутать (§12.1).
    homeworkEntryId: asString(item.homework_entry_id),
    entryStudentId: asString(item.homework_entry_student_id),
    entryType: asString(firstDefined(item.type, 'oo')).toUpperCase(),
    subjectId: asString(item.subject_id),
    subjectName: asString(firstDefined(item.subject_name, '—')),
    description: asString(firstDefined(item.description, item.homework, item.text)).trim(),
    assignedOn: assigned ? toIso(assigned) : null,
    dueDate: due ? toIso(due) : null,
    isDone: asBool(item.is_done),
    materials,
    attachments,
  };
}

export function additionalMaterialsBody(entryStudentId, materials) {
  const entry = /^\d+$/.test(String(entryStudentId)) ? Number(entryStudentId) : entryStudentId;
  return {
    materials: materials.filter((m) => m.uuid).map((m) => ({
      uuid: m.uuid,
      purpose: Cdz.PURPOSE_HOME,
      selected_mode: m.selectedMode || 'execute',
      homework_entry_student_id: entry,
    })),
  };
}

export function normalizeAdditionalMaterials(json, t) {
  const out = {};
  for (const purpose of json?.additional_materials || []) {
    for (const group of purpose.material_groups || []) {
      for (const m of group.materials || []) {
        if (!m.uuid) continue;
        let viewUrl = '';
        let launchUrl = '';
        for (const u of m.urls || []) {
          const url = asString(u?.url).trim();
          if (!url || url === 'null') continue;
          if (u.type === 'view') viewUrl = url;
          if (u.type === 'launch') launchUrl = url;
        }
        const partner = m.partner || m.publishing_house || {};
        out[m.uuid] = {
          uuid: m.uuid,
          type: asString(m.type),
          typeName: cdzTypeLabel(m.type, m.type_name, t),
          title: asString(m.title),
          description: asString(m.description).trim(),
          partnerName: asString(partner.name),
          partnerIcon: asString(partner.icon_url) === 'null' ? '' : asString(partner.icon_url),
          viewUrl,
          launchUrl,
        };
      }
    }
  }
  return out;
}

/** `context` для LRS: work_type — строка "1", work_id — homework_entry_id числом. */
export function lrsContext(materialId, personId, homeworkEntryId) {
  const workId = /^\d+$/.test(String(homeworkEntryId)) ? Number(homeworkEntryId) : String(homeworkEntryId);
  return JSON.stringify({ material_id: materialId, person_id: personId, work_type: Cdz.WORK_TYPE_HOMEWORK, work_id: workId });
}

const finished = (a) => a.final === true || Number(a.status) === 2;

export function normalizeLrsResults(json) {
  const attempts = Array.isArray(json?.content) ? json.content.filter(Boolean) : [];
  if (!attempts.length) return { done: false, started: false, attempts: 0 };
  const best = [...attempts].sort((a, b) =>
    Number(finished(b)) - Number(finished(a)) || asString(b.started_at).localeCompare(asString(a.started_at)))[0];
  let score = null;
  let maxScore = null;
  if (Array.isArray(best.items) && best.items.length) {
    let s = 0; let mx = 0; let any = false;
    for (const it of best.items) {
      const sc = asNumber(it?.score); const ms = asNumber(it?.max_score);
      if (sc !== null) { s += sc; any = true; }
      if (ms !== null) { mx += ms; any = true; }
    }
    if (any) { score = s; maxScore = mx; }
  }
  if (score === null) { score = asNumber(best.score); maxScore = asNumber(best.max_score); }
  const url = (v) => { const s = asString(v).trim(); return s === 'null' ? '' : s; };
  return {
    done: finished(best),
    started: true,
    success: isNil(best.success) ? null : !!best.success,
    startedAt: url(best.started_at),
    duration: asNumber(best.duration),
    score,
    maxScore,
    mark: asNumber(best.recommended_mark),
    markScale: asNumber(best.recommended_mark_scale),
    resultUrl: url(best.url_details),
    attempts: attempts.length,
  };
}

export function formatDuration(seconds, t) {
  const s0 = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s0 / 3600);
  const m = Math.floor((s0 % 3600) / 60);
  const s = s0 % 60;
  const parts = [];
  if (h) { parts.push(t('dur.h', h)); if (m) parts.push(t('dur.m', m)); }
  else if (m) { parts.push(t('dur.m', m)); if (s) parts.push(t('dur.s', s)); }
  else parts.push(t('dur.s', s));
  return parts.join(' ');
}

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «Выполнено 20 ноя в 18:39 за 1 м 46 с». `timeZone` — IANA (по умолчанию — браузера). */
export function cdzStatusText(result, t, lang = 'ru', timeZone) {
  if (!result) return '';
  if (!result.started) return t('cdz.notDone');
  if (!result.done) return t('cdz.inProgress');
  const date = result.startedAt ? new Date(result.startedAt) : null;
  let base = t('cdz.done');
  if (date && !Number.isNaN(date.getTime())) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]));
    const day = lang === 'ru'
      ? `${Number(parts.day)} ${RU_MONTHS[Number(parts.month) - 1]}`
      : new Intl.DateTimeFormat(lang, { timeZone, day: 'numeric', month: 'short' }).format(date);
    base = t('cdz.doneAt', day, `${parts.hour}:${parts.minute}`);
  }
  return result.duration > 0 ? `${base} ${t('cdz.inDuration', formatDuration(result.duration, t))}` : base;
}

export function cdzScoreText(result, t) {
  if (!result?.done || result.score === null || result.score === undefined) return '';
  const fmt = (v) => String(round(v, 1));
  return result.maxScore > 0 ? t('cdz.score', fmt(result.score), fmt(result.maxScore)) : t('cdz.scoreOnly', fmt(result.score));
}
