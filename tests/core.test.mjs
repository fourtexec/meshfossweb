import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHomework, additionalMaterialsBody, normalizeAdditionalMaterials, lrsContext, normalizeLrsResults,
  cdzStatusText, cdzScoreText, formatDuration, extractToken, defaultHomeworkDate, summarizeMarks, normalizeMark,
  normalizeSchedule,
} from '../assets/js/core.js';
import { t, setLang } from '../assets/js/i18n.js';

setLang('ru');

const RAW = {
  type: 'oo',
  description: 'Продолжение устного опроса + цдз',
  materials: [
    { uuid: 'aaaa-1', type: 'fizikon_module', selected_mode: 'execute', type_name: 'Облако знаний',
      title: 'Воздух и его состав', urls: [], action_id: 1, action_name: 'Пройти' },
    { uuid: 'aaaa-2', type: 'test_spec_binding', selected_mode: 'execute', title: 'Входное тестирование',
      urls: [{ type: 'view', url: 'https://uchebnik.mos.ru/exam/challenge/1' }], action_id: 1, action_name: 'Пройти' },
    { type: 'attachments', title: 'task.pdf', urls: [{ url: '/files/task.pdf' }] },
  ],
  homework_entry_student_id: 5305857296,
  homework_entry_id: 355435138,
  subject_name: 'Химия',
  date_prepared_for: '2026-11-24T00:00:00',
  is_done: false,
};

test('ДЗ: homework_entry_id и homework_entry_student_id не путаются', () => {
  const hw = normalizeHomework(RAW, t);
  assert.equal(hw.homeworkEntryId, '355435138');
  assert.equal(hw.entryStudentId, '5305857296');
  assert.equal(hw.dueDate, '2026-11-24');
});

test('ЦДЗ помечаются, прямых ссылок у них нет, вложения — файлы', () => {
  const hw = normalizeHomework(RAW, t);
  assert.equal(hw.materials[0].isCdz, true);
  assert.equal(hw.materials[0].typeName, 'Самостоятельная работа');
  assert.equal(hw.materials[1].typeName, 'Тематический тест');
  assert.equal(hw.materials[1].url, '');
  assert.equal(hw.materials[2].isCdz, false);
  assert.equal(hw.attachments[0].url, 'https://school.mos.ru/files/task.pdf');
});

test('тело additional_materials', () => {
  const hw = normalizeHomework(RAW, t);
  const body = additionalMaterialsBody(hw.entryStudentId, hw.materials.filter((m) => m.isCdz));
  assert.deepEqual(body.materials[0], {
    uuid: 'aaaa-1', purpose: 'for_home', selected_mode: 'execute', homework_entry_student_id: 5305857296,
  });
});

test('ответ additional_materials по uuid, "null" вместо ссылки игнорируется', () => {
  const map = normalizeAdditionalMaterials({ additional_materials: [{ purpose: 'for_home', material_groups: [{ materials: [{
    uuid: 'aaaa-1', type: 'fizikon_module', title: 'Воздух', description: 'Описание',
    partner: { name: 'Облако Знаний', icon_url: null },
    urls: [{ type: 'view', url: 'https://x/view' }, { type: 'edit', url: 'null' }, { type: 'launch', url: 'https://x/launch' }],
  }] }] }] }, t);
  assert.equal(map['aaaa-1'].partnerName, 'Облако Знаний');
  assert.equal(map['aaaa-1'].viewUrl, 'https://x/view');
  assert.equal(map['aaaa-1'].launchUrl, 'https://x/launch');
});

test('контекст LRS', () => {
  assert.equal(lrsContext('m', 'p', '355435138'), '{"material_id":"m","person_id":"p","work_type":"1","work_id":355435138}');
});

test('LRS: пусто — не выполнено', () => {
  const r = normalizeLrsResults({ content: [] });
  assert.equal(cdzStatusText(r, t), 'Не выполнено');
  assert.equal(cdzScoreText(r, t), '');
});

test('LRS: выполнено 20 ноя в 18:39 за 1 м 46 с, 1/1 баллов', () => {
  const r = normalizeLrsResults({ content: [
    { final: false, status: 1, started_at: '2026-11-21T10:00:00Z' },
    { final: true, status: 2, started_at: '2026-11-20T15:39:29.694538Z', duration: 106,
      url_details: 'https://uchebnik.mos.ru/exam/challenge/1/attempt/2', items: [{ score: 1, max_score: 1 }] },
  ] });
  assert.equal(r.done, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.resultUrl, 'https://uchebnik.mos.ru/exam/challenge/1/attempt/2');
  assert.equal(cdzStatusText(r, t, 'ru', 'Europe/Moscow'), 'Выполнено 20 ноя в 18:39 за 1 м 46 с');
  assert.equal(cdzScoreText(r, t), '1/1 баллов');
});

test('длительность', () => {
  assert.equal(formatDuration(106, t), '1 м 46 с');
  assert.equal(formatDuration(3720, t), '1 ч 2 м');
  assert.equal(formatDuration(40, t), '40 с');
});

test('токен из cookie-строки, JSON и голого JWT', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnop';
  assert.equal(extractToken(`foo=1; aupd_token=${jwt}; bar=2`), jwt);
  assert.equal(extractToken(JSON.stringify({ token: jwt })), jwt);
  assert.equal(extractToken(`  ${jwt}  `), jwt);
  assert.equal(extractToken('привет'), null);
});

test('дата ДЗ по умолчанию: пятница → понедельник', () => {
  assert.equal(defaultHomeworkDate('2026-11-20'), '2026-11-23');
  assert.equal(defaultHomeworkDate('2026-11-18'), '2026-11-19');
});

test('сводка оценок', () => {
  const s = summarizeMarks([
    normalizeMark({ value: '5', subject_id: 1, subject_name: 'А', weight: 2, date: '2026-11-01' }),
    normalizeMark({ value: '3', subject_id: 1, subject_name: 'А', weight: 1, date: '2026-11-02' }),
  ]);
  assert.equal(s.average, 4);
  assert.equal(s.weightedAverage, 4.33);
  assert.equal(s.bySubject[0].count, 2);
});

test('расписание без перемен', () => {
  const lessons = normalizeSchedule({ activities: [
    { type: 'BREAK', begin_time: '09:15', end_time: '09:25' },
    { type: 'LESSON', begin_time: '08:30', end_time: '09:15', room_number: '204',
      lesson: { subject_name: 'Химия', teacher: { fio: 'Иванова И. И.' } } },
  ] }, '2026-11-24');
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0].room, 'каб. 204');
});
