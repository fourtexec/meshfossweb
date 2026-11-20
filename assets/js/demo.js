// Демо-режим: мок school.mos.ru прямо в браузере. Отвечает на те же пути, что
// настоящий МЭШ (и прокси), поэтому MeshClient работает без изменений.
// Данные синтетические и детерминированные (как DemoMeshServer.kt в Android).

import { Paths, addDays, today, parseIso } from './core.js';

export const DEMO_TOKEN = 'demo-token-mesh-foss-0001';
const ME = { id: '17234613', personId: '11111111-1111-4111-8111-111111111111' };

const SUBJECTS = [
  [1, 'Алгебра'], [2, 'Геометрия'], [3, 'Русский язык'], [4, 'Литература'], [5, 'Английский язык'],
  [6, 'История'], [7, 'Обществознание'], [8, 'География'], [9, 'Биология'], [10, 'Физика'],
  [11, 'Химия'], [12, 'Информатика'],
];
const TEACHERS = ['Соколова И. П.', 'Гаврилов А. Н.', 'Мельникова О. В.', 'Ткачук Д. С.', 'Васильева Е. А.'];
const FORMS = ['Контрольная работа', 'Самостоятельная работа', 'Ответ на уроке', 'Домашняя работа', 'Тест'];
const NAMES = ['Анна К', 'Максим Б', 'София Л', 'Иван Д', 'Ева М', 'Егор Н', 'Полина О', 'Кирилл П', 'Дарья Р',
  'Никита С', 'Алиса Т', 'Лев У', 'Вера Ф', 'Пётр Х', 'Мария Ц', 'Артём Ч', 'Ксения Ш', 'Дмитрий Щ', 'Виктория Э', 'Александр Ю'];

const CDZ = [
  { type: 'fizikon_module', typeName: 'Самостоятельная работа', title: 'Воздух и его состав', partner: 'Облако Знаний',
    description: 'Интерактивная работа с автоматической проверкой по теме урока.' },
  { type: 'test_task_binding', typeName: 'Задание', title: 'Основные компоненты воздуха', partner: 'Библиотека МЭШ',
    description: 'Задание из Библиотеки МЭШ.' },
  { type: 'test_spec_binding', typeName: 'Тематический тест', title: 'Входное тестирование', partner: 'Библиотека МЭШ',
    description: 'Тест по теме урока.' },
];

/** Детерминированный ГПСЧ (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (iso) => Number(iso.replaceAll('-', ''));
const isWeekend = (iso) => [0, 6].includes(parseIso(iso).getDay());

function json(status, body, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Mesh-Status': String(status), ...headers },
  });
}

export function createDemoFetch() {
  const done = new Map(); // entryStudentId → bool
  const launched = new Set(); // uuid → «выполнен» после запуска в демо

  function homeworksOn(day) {
    if (isWeekend(day)) return [];
    const r = rng(seedOf(day) * 7);
    const count = 3 + Math.floor(r() * 3);
    const list = [];
    for (let i = 0; i < count; i++) {
      const [subjectId, subjectName] = SUBJECTS[Math.floor(r() * SUBJECTS.length)];
      const entryId = seedOf(day) * 100 + subjectId * 10 + i;
      const entryStudentId = `${entryId}7`;
      const cdzCount = i === 0 ? 1 + (entryId % 3) : 0;
      list.push({
        type: 'oo',
        description: i === 0 ? 'Повторить параграф, выполнить ЦДЗ' : `Параграф ${10 + Math.floor(r() * 150)}, вопросы 1–4 письменно`,
        materials: Array.from({ length: cdzCount }, (_, k) => ({
          uuid: `cdz-${entryId}-${k}`, type: CDZ[k].type, selected_mode: 'execute',
          type_name: k === 0 ? 'Облако знаний' : 'Прочее', title: CDZ[k].title, urls: [],
          action_id: 1, action_name: 'Пройти',
        })),
        attachments: [],
        homework_entry_student_id: Number(entryStudentId),
        homework_entry_id: entryId,
        subject_id: subjectId,
        subject_name: subjectName,
        date_assigned_on: addDays(day, -2),
        date_prepared_for: `${day}T00:00:00`,
        is_done: done.get(entryStudentId) ?? r() > 0.6,
      });
    }
    return list;
  }

  function lrs(materialId, workId) {
    const slot = Number(materialId.split('-').pop());
    const finished = launched.has(materialId) || slot === 0 || (slot === 2 && workId % 2 === 0);
    if (!finished) return { content: [], totalElements: 0, empty: true };
    const max = slot === 0 ? 5 : 1;
    const score = slot === 0 ? 4 : 1;
    return {
      content: [{
        result_id: 360000000 + slot, final: true, status: 2, success: true,
        started_at: `${addDays(today(), -1)}T15:39:29.694538Z`, duration: 106 + slot * 40,
        recommended_mark: slot === 0 ? 4 : 1, recommended_mark_scale: slot === 0 ? 5 : 1,
        url_details: `demo:result/${materialId}`,
        items: Array.from({ length: max }, (_, n) => ({ task_number: 800000000 + n, score: n < score ? 1 : 0, max_score: 1 })),
      }],
      totalElements: 1,
    };
  }

  return async function demoFetch(input, init = {}) {
    const url = new URL(String(input), 'https://demo.invalid');
    const path = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    const method = (init.method || 'GET').toUpperCase();
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

    if (path === Paths.TOKEN_REFRESH) return json(200, { token: DEMO_TOKEN });

    if (path === Paths.PROFILE) {
      return json(200, {
        profile: { last_name: 'Демо', first_name: 'Родитель' },
        children: [{
          id: Number(ME.id), contingent_guid: ME.personId, last_name: 'Демо', first_name: 'Ученик',
          class_name: '8-Б', school: { name: 'ГБОУ Школа № 1 (демо)' },
          representatives: [{ last_name: 'Демо', first_name: 'Родитель' }],
        }],
      });
    }

    if (path === Paths.SCHEDULE) {
      const date = q.date || today();
      if (isWeekend(date)) return json(200, { activities: [] });
      const r = rng(seedOf(date));
      const pool = [...SUBJECTS].sort(() => r() - 0.5).slice(0, 6);
      const begins = ['08:30', '09:25', '10:30', '11:25', '12:30', '13:25'];
      const ends = ['09:15', '10:10', '11:15', '12:10', '13:15', '14:10'];
      const hw = homeworksOn(date);
      return json(200, {
        activities: pool.map(([id, name], i) => ({
          type: 'LESSON', begin_time: begins[i], end_time: ends[i], room_number: String(200 + Math.floor(r() * 120)),
          lesson: {
            subject_id: id, subject_name: name, lesson_number: i + 1,
            teacher: { fio: TEACHERS[Math.floor(r() * TEACHERS.length)] },
            homework: hw.find((h) => h.subject_id === id)?.description || '',
            marks: r() > 0.8 ? [{ value: String(3 + Math.floor(r() * 3)), weight: 1 }] : [],
          },
        })),
      });
    }

    if (path === Paths.MARKS) {
      const to = q.to || today();
      const from = q.from || addDays(to, -30);
      const list = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (isWeekend(d)) continue;
        const r = rng(seedOf(d) * 13);
        const n = Math.floor(r() * 3);
        for (let i = 0; i < n; i++) {
          const [sid, sname] = SUBJECTS[Math.floor(r() * SUBJECTS.length)];
          const v = r() > 0.85 ? 3 : r() > 0.4 ? 5 : 4;
          list.push({ id: `${seedOf(d)}${i}`, value: String(v), subject_id: sid, subject_name: sname,
            control_form_name: FORMS[Math.floor(r() * FORMS.length)], weight: 1 + Math.floor(r() * 2), date: d });
        }
      }
      return json(200, { payload: list });
    }

    if (path === Paths.HOMEWORKS) {
      const from = q.from || addDays(today(), -7);
      const to = q.to || addDays(today(), 7);
      const payload = [];
      for (let d = from; d <= to; d = addDays(d, 1)) payload.push(...homeworksOn(d));
      return json(200, { payload });
    }

    const doneMatch = /^\/api\/family\/web\/v1\/homeworks\/(\d+)\/done$/.exec(path);
    if (doneMatch) {
      done.set(doneMatch[1], method === 'POST');
      return json(200, { success: true });
    }

    if (path === Paths.ADDITIONAL_MATERIALS && method === 'POST') {
      const asked = JSON.parse(init.body || '{}').materials || [];
      const materials = asked.map((m) => {
        const slot = Number(String(m.uuid).split('-').pop());
        const info = CDZ[slot];
        if (!info) return null;
        return {
          uuid: m.uuid, type: info.type, type_name: info.typeName, title: info.title, description: info.description,
          action_id: 1, action_name: 'Пройти', partner: { id: 282, name: info.partner, icon_url: null },
          urls: [{ type: 'view', url: 'https://uchebnik.mos.ru/material/demo' }, { type: 'edit', url: 'null' }],
        };
      }).filter(Boolean);
      return json(200, { additional_materials: [{ purpose: 'for_home', material_groups: [{
        selected_mode: 'execute', homework_entry_student_id: asked[0]?.homework_entry_student_id ?? null,
        amount: materials.length, materials,
      }] }] });
    }

    if (path === Paths.LRS_RESULTS) {
      const ctx = JSON.parse(q.context || '{}');
      return json(200, lrs(String(ctx.material_id || ''), Number(ctx.work_id || 0)));
    }

    if (path === Paths.HOMEWORK_LAUNCH) {
      const entry = q.homework_entry_id || '';
      const material = q.material_id || '';
      if (!/^\d+$/.test(entry) || !material) {
        return json(400, { code: 400, error_text: 'argument "content" is null' });
      }
      launched.add(material);
      // Как МЭШ: 302 без Location, ссылка в теле.
      return json(302, `demo:launch/${material}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`);
    }

    if (path === Paths.RANK) {
      const r = rng(4242);
      const ids = [ME.personId, ...NAMES.map((_, i) => `demo-person-${i}`)];
      const rows = ids.map((id) => ({ personId: id, avg: Math.round((3.6 + r() * 1.4) * 100) / 100 }))
        .sort((a, b) => b.avg - a.avg)
        .map((row, i) => ({ personId: row.personId, rank: { averageMarkFive: row.avg, rankPlace: i + 1 },
          previousRank: { rankPlace: Math.max(1, i + 1 + Math.round((r() - 0.5) * 4)) } }));
      return json(200, { payload: rows });
    }

    if (path === Paths.PROFILE_BY_ID) {
      const id = q.personId || '';
      if (id === ME.personId) return json(200, { firstName: 'Ученик', lastName: 'Д' });
      const i = Number(id.split('-').pop());
      const [first, last] = (NAMES[i] || 'Без имени').split(' ');
      return json(200, { firstName: first, lastName: last });
    }

    return json(404, { message: `demo: unknown path ${path}` });
  };
}
