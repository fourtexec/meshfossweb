import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshClient } from '../assets/js/api.js';
import { createDemoFetch, DEMO_TOKEN } from '../assets/js/demo.js';
import { today, addDays } from '../assets/js/core.js';
import { t, setLang } from '../assets/js/i18n.js';

setLang('ru');

const client = () => new MeshClient({ base: '', token: DEMO_TOKEN, fetch: createDemoFetch() });

test('демо: вход, ДЗ с ЦДЗ, статусы и запуск', async () => {
  const c = client();
  const { profile } = await c.signIn(DEMO_TOKEN);
  const me = profile.defaultChild;
  assert.ok(me.personId);
  const list = await c.homeworks(me.id, addDays(today(), -14), today(), t);
  const hw = list.find((h) => h.materials.filter((m) => m.isCdz).length >= 2);
  assert.ok(hw, 'есть ДЗ с несколькими ЦДЗ');
  const status = await c.cdzStatus(hw, me.personId, t);
  const first = status[hw.materials[0].uuid];
  assert.equal(first.partnerName, 'Облако Знаний');
  assert.equal(first.result.done, true);
  assert.equal(status[hw.materials[1].uuid].result.done, false);

  const a = await c.launchMaterial(hw.homeworkEntryId, hw.materials[1].uuid);
  const b = await c.launchMaterial(hw.homeworkEntryId, hw.materials[1].uuid);
  assert.notEqual(a, b, 'ссылка одноразовая — каждый раз новая');
  // После запуска в демо материал засчитывается.
  const again = await c.materialResult(hw.materials[1].uuid, me.personId, hw.homeworkEntryId);
  assert.equal(again.done, true);
});

test('демо: launch с homework_entry_student_id → 400', async () => {
  const c = client();
  await assert.rejects(() => c.launchMaterial('5305857296-x', 'cdz-1-0'), (e) => e.status === 400);
});

test('демо: расписание, оценки, рейтинг', async () => {
  const c = client();
  const { profile } = await c.signIn(DEMO_TOKEN);
  const me = profile.defaultChild;
  let day = today();
  while ([0, 6].includes(new Date(day).getDay())) day = addDays(day, 1);
  assert.ok((await c.schedule(me.id, day)).length > 0);
  assert.ok((await c.marks(me.id, addDays(today(), -30), today())).length > 0);
  const board = await c.rankBoard(me.personId, today());
  assert.ok(board.some((r) => r.isMe));
});
