// MESHFOSS Web — CORS-прокси к school.mos.ru.
//
// Деплой как Cloudflare Worker (см. proxy/README.md) или локально через
// proxy/server.mjs. Пропускает только пути API, которые использует клиент,
// ничего не логирует и не хранит. Токен идёт в заголовке Authorization от
// браузера пользователя и пересылается в МЭШ как есть.
//
// Особенность МЭШ: partners/v1/homeworks/launch отвечает 302 без Location, а
// ссылку кладёт в тело (docs/mesh-cdz-api.md §7.1). Браузерный fetch не даёт
// прочитать тело редиректа, поэтому прокси превращает любой 3xx в 200 с
// заголовками X-Mesh-Status и X-Mesh-Location.

const UPSTREAM = 'https://school.mos.ru';

const ALLOWED_PATHS = [
  /^\/api\/family\/web\/v1\/(profile|marks|homeworks|schedule)(\/|$)/,
  /^\/api\/family\/web\/v1\/homeworks\/\d+\/done$/,
  /^\/api\/family\/materials\/v1\/additional_materials$/,
  /^\/api\/ej\/partners\/v1\/homeworks\/launch$/,
  /^\/api\/ej\/rating\/v1\/rank\/(class|subjects)$/,
  /^\/api\/lrs\/v2\/results$/,
  /^\/api\/gamification\/v1\/profiles$/,
  /^\/v2\/token\/refresh$/,
];

const FORWARD_HEADERS = [
  'authorization', 'profile-id', 'profile-type', 'x-mes-subsystem', 'x-mes-roleid',
  'x-mes-globalroleid', 'accept', 'content-type',
];

const DEFAULT_ORIGINS = [
  'https://meshfoss.fourtexec.site',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
];

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

function allowedOrigins(env) {
  const raw = env?.ALLOWED_ORIGINS;
  if (!raw) return DEFAULT_ORIGINS;
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const allow = origin && (list.includes('*') || list.includes(origin)) ? origin : null;
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': FORWARD_HEADERS.join(', '),
    'Access-Control-Expose-Headers': 'X-Mesh-Status, X-Mesh-Location',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allow) headers['Access-Control-Allow-Origin'] = allow;
  return { headers, allowed: !!allow };
}

/**
 * @param {Request} request
 * @param {{ALLOWED_ORIGINS?: string, PREFIX?: string}} [env]
 */
export async function handle(request, env = {}) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const { headers: cors, allowed } = corsHeaders(origin, env);
  // Без Origin — запрос с того же адреса (server.mjs) или не из браузера.
  if (origin && !allowed) return new Response('origin not allowed', { status: 403, headers: { Vary: 'Origin' } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const prefix = env.PREFIX || '';
  const path = prefix && url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
  if (path === '/' || path === '') {
    return new Response('MESHFOSS proxy: ok', { status: 200, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (!ALLOWED_PATHS.some((re) => re.test(path))) {
    return new Response(JSON.stringify({ message: 'path not allowed' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    return new Response('method not allowed', { status: 405, headers: cors });
  }

  const upstreamHeaders = new Headers({ 'User-Agent': USER_AGENT, 'Accept-Language': 'ru-RU,ru;q=0.9' });
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  // Часть методов МЭШ (как и веб-дневник) смотрит ещё и на cookie aupd_token.
  if (token && /^[A-Za-z0-9._~+/=-]+$/.test(token)) upstreamHeaders.set('Cookie', `aupd_token=${token}`);

  const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
  let upstream;
  try {
    upstream = await fetch(UPSTREAM + path + url.search, {
      method: request.method,
      headers: upstreamHeaders,
      body,
      redirect: 'manual',
    });
  } catch {
    return new Response(JSON.stringify({ message: 'upstream unreachable' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const outHeaders = new Headers(cors);
  outHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  outHeaders.set('Cache-Control', 'no-store');
  outHeaders.set('X-Mesh-Status', String(upstream.status));
  const location = upstream.headers.get('Location');
  if (location) outHeaders.set('X-Mesh-Location', location);
  const isRedirect = upstream.status >= 300 && upstream.status < 400;
  return new Response(await upstream.arrayBuffer(), {
    status: isRedirect ? 200 : upstream.status,
    headers: outHeaders,
  });
}

export default {
  fetch: (request, env) => handle(request, env),
};
