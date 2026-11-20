# Прокси MESHFOSS Web

`school.mos.ru` не отдаёт CORS-заголовки, поэтому браузерному клиенту нужен
посредник. [`worker.js`](worker.js):

- пропускает **только** пути API, которые использует клиент (профиль, расписание,
  оценки, ДЗ и отметка «выполнено», ЦДЗ: `additional_materials`, LRS, launch,
  рейтинг, обновление токена) — остальное 404;
- пересылает только нужные заголовки (`Authorization`, `Profile-Id`,
  `X-Mes-*`, …);
- для school.mos.ru запрос выглядит как запрос самой страницы веб-дневника:
  `Referer` нужной страницы дневника, `Origin: https://school.mos.ru` (для
  POST/DELETE, как в Chrome), `Sec-Fetch-Site: same-origin`, `sec-ch-ua`,
  User-Agent Chrome и те же куки, что ставит фронтенд (`aupd_token`, …).
  Из браузера так сделать нельзя: скриптам запрещено задавать эти заголовки;
- превращает любой 3xx в `200` с `X-Mesh-Status` / `X-Mesh-Location` — иначе
  браузер не даст прочитать тело ответа `partners/v1/homeworks/launch`, где МЭШ
  передаёт ссылку на ЦДЗ;
- отвечает CORS только разрешённым origin (по умолчанию
  `https://meshfoss.fourtexec.site` и `http://localhost:8787`);
- ничего не логирует и не хранит.

> Токен МЭШ проходит через прокси. Используйте только прокси, который
> развернули сами.

## Cloudflare Workers

Через панель: **Workers & Pages → Create → Worker**, вставьте содержимое
`worker.js`, нажмите **Deploy**. Свои сайты добавьте в переменную
`ALLOWED_ORIGINS` (через запятую) в настройках воркера.

Или через wrangler — в каталоге уже есть [`wrangler.toml`](wrangler.toml):

```bash
cd proxy && npx wrangler deploy
```

Адрес вида `https://mesh-proxy.<аккаунт>.workers.dev` укажите в поле «Адрес
прокси» на экране входа.

## Локально

```bash
node proxy/server.mjs
```

Сервер отдаёт приложение на <http://127.0.0.1:8787> и проксирует `/mesh/*`.
`PORT` и `HOST` меняются переменными окружения.
