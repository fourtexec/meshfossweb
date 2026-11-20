import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../proxy/worker.js';

const ORIGIN = 'https://meshfoss.fourtexec.site';

test('прокси: чужие пути и origin отклоняются', async () => {
  let res = await handle(new Request('https://p.example/api/secret', { headers: { Origin: ORIGIN } }));
  assert.equal(res.status, 404);
  res = await handle(new Request('https://p.example/api/lrs/v2/results', { headers: { Origin: 'https://evil.example' } }));
  assert.equal(res.status, 403);
});

test('прокси: preflight', async () => {
  const res = await handle(new Request('https://p.example/api/lrs/v2/results', { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Expose-Headers'), /X-Mesh-Status/);
});

test('прокси: 302 с URL в теле → 200 + X-Mesh-Status, заголовки пересылаются', async () => {
  const seen = {};
  const fake = mock.method(globalThis, 'fetch', async (url, init) => {
    seen.url = url;
    seen.auth = init.headers.get('authorization');
    seen.cookie = init.headers.get('cookie');
    seen.redirect = init.redirect;
    return new Response('https://school.mos.ru/api/launcher/v1/launch?x=1', { status: 302, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const res = await handle(new Request('https://p.example/api/ej/partners/v1/homeworks/launch?homework_entry_id=1&material_id=m', {
      headers: { Origin: ORIGIN, Authorization: 'Bearer abc.def.ghi', 'Profile-Id': '17' },
    }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Mesh-Status'), '302');
    assert.equal(await res.text(), 'https://school.mos.ru/api/launcher/v1/launch?x=1');
    assert.equal(seen.url, 'https://school.mos.ru/api/ej/partners/v1/homeworks/launch?homework_entry_id=1&material_id=m');
    assert.equal(seen.auth, 'Bearer abc.def.ghi');
    assert.equal(seen.cookie, 'aupd_token=abc.def.ghi');
    assert.equal(seen.redirect, 'manual');
  } finally {
    fake.mock.restore();
  }
});
