// HTTP-клиент МЭШ для браузера. Порт MeshClient.kt.
//
// school.mos.ru не отдаёт CORS-заголовки, поэтому запросы идут через прокси
// (proxy/worker.js или proxy/server.mjs): он пересылает разрешённые пути на
// school.mos.ru и превращает 3xx в 200 с заголовком X-Mesh-Status, чтобы можно
// было прочитать тело (ссылка запуска ЦДЗ приходит в теле 302 — §7.1).

import {
  Paths, ROLE_ID, SUBSYSTEM, payloadList, normalizeProfile, normalizeMark, normalizeHomework,
  normalizeSchedule, additionalMaterialsBody, normalizeAdditionalMaterials, lrsContext,
  normalizeLrsResults, buildRankTable, extractToken, absoluteUrl, firstDefined, asString,
} from './core.js';

export class MeshError extends Error {
  constructor(message, code = 'error', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class MeshClient {
  /**
   * @param {object} o
   * @param {string} o.base     адрес прокси (без завершающего /), напр. https://proxy.example.org
   * @param {string} [o.token]  aupd_token
   * @param {string} [o.profileId] id ученика (Profile-Id)
   * @param {(token:string)=>void} [o.onToken] вызывается при автообновлении токена
   * @param {typeof fetch} [o.fetch] реализация fetch (демо-режим подменяет её)
   */
  constructor({ base, token = null, profileId = null, onToken = null, fetch: fetchImpl = null, timeoutMs = 20000 }) {
    this.base = String(base || '').replace(/\/+$/, '');
    this.token = token;
    this.profileId = profileId;
    this.onToken = onToken;
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    this.timeoutMs = timeoutMs;
    this.nameCache = new Map();
  }

  url(path, params = {}) {
    const q = Object.entries(params)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    return `${this.base}${path}${q ? `?${q}` : ''}`;
  }

  headers({ profile = true, json = false, extra = {} } = {}) {
    const h = {
      Accept: 'application/json, text/plain, */*',
      'X-Mes-Subsystem': SUBSYSTEM,
      'X-Mes-RoleId': ROLE_ID,
      ...extra,
    };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    if (profile) {
      h['Profile-Type'] = 'student';
      if (this.profileId) h['Profile-Id'] = this.profileId;
    }
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  /** Обмен с прокси: ошибки сети → MeshError, 401 → одно обновление токена и повтор. */
  async exchange(method, path, { params = {}, body = null, headerOpts = {}, retry = true } = {}) {
    for (let attempt = 1; attempt <= (retry ? 2 : 1); attempt++) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
      let res;
      try {
        res = await this.fetchImpl(this.url(path, params), {
          method,
          headers: this.headers({ ...headerOpts, json: body !== null }),
          body: body === null ? undefined : JSON.stringify(body),
          signal: controller?.signal,
          credentials: 'omit',
        });
      } catch (e) {
        if (e?.name === 'AbortError') throw new MeshError('МЭШ не ответил вовремя', 'timeout');
        throw new MeshError('Нет связи с прокси МЭШ', 'network');
      } finally {
        if (timer) clearTimeout(timer);
      }
      const status = Number(res.headers.get('X-Mesh-Status')) || res.status;
      const text = await res.text();
      if (status === 401 && attempt === 1 && retry) {
        if (await this.refreshToken()) continue;
        throw new MeshError('Токен устарел и не обновился', 'unauthorized', 401);
      }
      if (status === 401) throw new MeshError('Требуется вход', 'unauthorized', 401);
      if (status === 403) throw new MeshError('Доступ запрещён', 'forbidden', 403);
      if (status === 404) throw new MeshError(`Метод не найден: ${path}`, 'not-found', 404);
      if (status >= 400) throw new MeshError(`Ошибка МЭШ (HTTP ${status})`, `http-${status}`, status);
      return { status, text, location: res.headers.get('X-Mesh-Location') || '' };
    }
    throw new MeshError('Запрос не выполнен', 'exhausted');
  }

  async json(path, params = {}, opts = {}) {
    const { text, status } = await this.exchange('GET', path, { params, ...opts });
    if (!text.trim()) return null;
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? { payload: parsed } : parsed;
    } catch {
      throw new MeshError('Неожиданный ответ МЭШ', 'invalid-json', status);
    }
  }

  async refreshToken() {
    if (!this.token) return null;
    try {
      const { text } = await this.exchange('GET', Paths.TOKEN_REFRESH, {
        params: { roleId: ROLE_ID, subsystem: '2' }, headerOpts: { profile: false }, retry: false,
      });
      const fresh = extractToken(text) || (() => { try { return JSON.parse(text).token; } catch { return null; } })();
      if (fresh && fresh !== this.token) {
        this.token = fresh;
        this.onToken?.(fresh);
        return fresh;
      }
    } catch { /* обновить не удалось */ }
    return null;
  }

  // ------------------------------------------------------------- методы --

  async signIn(rawToken) {
    const token = extractToken(rawToken) || String(rawToken || '').trim();
    if (!token) throw new MeshError('Пустой токен', 'bad-token');
    this.token = token;
    const profile = normalizeProfile(await this.json(Paths.PROFILE) || {});
    this.profileId = profile.defaultChild?.id || null;
    return { token: this.token, profile };
  }

  async profile() {
    return normalizeProfile(await this.json(Paths.PROFILE) || {});
  }

  async schedule(studentId, date) {
    return normalizeSchedule(await this.json(Paths.SCHEDULE, { student_id: studentId, date }), date);
  }

  async marks(studentId, from, to) {
    const json = await this.json(Paths.MARKS, { student_id: studentId, from, to });
    return payloadList(json).map(normalizeMark).sort((a, b) => b.date.localeCompare(a.date));
  }

  async homeworks(studentId, from, to, t) {
    const json = await this.json(Paths.HOMEWORKS, { student_id: studentId, from, to });
    return payloadList(json).map((item) => normalizeHomework(item, t));
  }

  async setHomeworkDone(homework, done) {
    const entry = homework.entryStudentId || homework.id;
    if (!entry) throw new MeshError('Нет идентификатора ДЗ', 'bad-homework');
    await this.exchange(done ? 'POST' : 'DELETE', Paths.homeworkDone(entry), { params: { type: homework.entryType || 'OO' } });
    return true;
  }

  // ---------------------------------------------------------------- ЦДЗ --

  /** §5: расширенные карточки по uuid. Заголовки без Profile-*, но с X-Mes-GlobalRoleId. */
  async additionalMaterials(entryStudentId, materials, t) {
    if (!entryStudentId || !materials.length) return {};
    const body = additionalMaterialsBody(entryStudentId, materials);
    if (!body.materials.length) return {};
    const { text } = await this.exchange('POST', Paths.ADDITIONAL_MATERIALS, {
      body,
      headerOpts: { profile: false, extra: { 'X-Mes-GlobalRoleId': ROLE_ID } },
    });
    return text.trim() ? normalizeAdditionalMaterials(JSON.parse(text), t) : {};
  }

  /** §6: статус материала в LRS. work_id = homework_entry_id. */
  async materialResult(materialId, personId, homeworkEntryId) {
    if (!materialId || !personId || !homeworkEntryId) throw new MeshError('Нет данных материала', 'bad-material');
    const json = await this.json(Paths.LRS_RESULTS, { context: lrsContext(materialId, personId, homeworkEntryId), size: 20 });
    return normalizeLrsResults(json);
  }

  /** Карточки и статусы всех ЦДЗ одного ДЗ; ошибка одного запроса не роняет остальные. */
  async cdzStatus(homework, personId, t) {
    const cdz = homework.materials.filter((m) => m.isCdz && m.uuid);
    if (!cdz.length) return {};
    const [extended, ...results] = await Promise.all([
      this.additionalMaterials(homework.entryStudentId, cdz, t).catch(() => ({})),
      ...cdz.map((m) => this.materialResult(m.uuid, personId, homework.homeworkEntryId)
        .then((result) => ({ result }), (e) => ({ error: e.message }))),
    ]);
    const out = {};
    cdz.forEach((m, i) => {
      out[m.uuid] = { uuid: m.uuid, ...(extended[m.uuid] || {}), ...(results[i].result ? { result: results[i].result } : { resultError: results[i].error }) };
    });
    return out;
  }

  /**
   * §7.1: одноразовая подписанная ссылка запуска. МЭШ отвечает 302 без Location,
   * URL — в теле. Ссылку не кэшируем: на каждое открытие — новый вызов.
   */
  async launchMaterial(homeworkEntryId, materialId) {
    if (!homeworkEntryId || !materialId) throw new MeshError('Нет данных материала', 'bad-material');
    const { text, location } = await this.exchange('GET', Paths.HOMEWORK_LAUNCH, {
      params: { homework_entry_id: homeworkEntryId, material_id: materialId },
    });
    if (location) return absoluteUrl(location);
    const body = text.trim().replace(/^"|"$/g, '');
    if (/^(https?:\/\/|demo:)/.test(body)) return body;
    try {
      const json = JSON.parse(body);
      const url = firstDefined(json.url, json.link, json.location, json.redirect);
      if (url) return absoluteUrl(url);
    } catch { /* не JSON */ }
    throw new MeshError('МЭШ не вернул ссылку на материал', 'invalid-json');
  }

  // ------------------------------------------------------------ рейтинг --

  async name(personId) {
    if (this.nameCache.has(personId)) return this.nameCache.get(personId);
    try {
      const json = await this.json(Paths.PROFILE_BY_ID, { personId });
      const name = [json?.firstName ?? json?.first_name, json?.lastName ?? json?.last_name]
        .map((x) => asString(x).trim()).filter(Boolean).join(' ');
      if (name) this.nameCache.set(personId, name);
      return name || 'Без имени';
    } catch {
      return 'Без имени';
    }
  }

  async rankBoard(personId, date) {
    const members = payloadList(await this.json(Paths.RANK, { personId, date }));
    const ids = members.map((m) => asString(m.personId ?? m.person_id)).filter(Boolean);
    const names = {};
    // Не больше 6 параллельных запросов имён.
    for (let i = 0; i < ids.length; i += 6) {
      const chunk = ids.slice(i, i + 6);
      (await Promise.all(chunk.map((id) => this.name(id)))).forEach((n, j) => { names[chunk[j]] = n; });
    }
    return buildRankTable(members, names, personId);
  }
}
