# MESHFOSS Web

Свободная (GPLv3) веб-версия [MESHFOSS](https://github.com/fourtexec/MESHFOSS) —
клиента **МЭШ** (Московская электронная школа) — прямо в браузере:
<https://meshfoss.fourtexec.site>.

- **Расписание** на день: время, кабинет, учитель, оценки за урок, ДЗ.
- **Домашние задания** «к уроку» и «задано» с отметкой «выполнено».
- **ЦДЗ** (цифровые домашние задания) — по
  [`docs/mesh-cdz-api.md`](https://github.com/fourtexec/MESHFOSS/blob/main/docs/mesh-cdz-api.md):
  тип, издатель и описание материала (§5), статус «Выполнено 20 ноя в 18:39
  за 1 м 46 с» и баллы из LRS (§6), запуск одноразовой ссылкой (§7) и кнопка
  «Результат», предупреждение о таймере «Облака Знаний», прогресс «ЦДЗ: 2 из 3».
- **Оценки** за 30 дней: средний и взвешенный балл, распределение, по предметам.
- **Рейтинг** класса.
- **Демо-режим** на синтетических данных — без аккаунта и прокси.
- 5 языков (ru, en, hu, es, fr), светлая и тёмная темы.
- **Жидкое стекло**: преломление по формуле
  [Liquid Glass Studio](https://github.com/iyinchao/liquid-glass-studio)
  (SDF скруглённого прямоугольника, закон Снеллиуса, RGB-дисперсия), запечённое
  в SVG-карту смещения и применённое как `backdrop-filter` к настоящему DOM.
  Нижняя панель с линзой, которую можно тянуть, — как в Android-версии.
  Браузеры без `backdrop-filter: url()` получают матовое стекло.
- Иконки — Lucide из [iconkit](https://github.com/fourtexec/iconkit) (ISC).

Без сборки и зависимостей: чистые ES-модули, хостится как статика (GitHub Pages).

## Как войти

Браузер не может обращаться к `school.mos.ru` напрямую — МЭШ не отдаёт
CORS-заголовки. Поэтому нужен **свой прокси**; токен идёт через него, так что
используйте только прокси, который запустили сами.

### Вариант 1. Локально (проще всего)

```bash
git clone https://github.com/photonest444/meshfossweb
```

```bash
cd meshfossweb && node proxy/server.mjs
```

Откройте <http://127.0.0.1:8787>. Сервер отдаёт приложение и проксирует
`/mesh/*` на `school.mos.ru` с того же адреса — поле «Адрес прокси» не нужно.
Нужен Node 18+.

### Вариант 2. Cloudflare Worker + сайт

Задеплойте [`proxy/worker.js`](proxy/worker.js) (инструкция —
[`proxy/README.md`](proxy/README.md)) и укажите его адрес на экране входа
<https://meshfoss.fourtexec.site>.

### Токен

1. Войдите на [school.mos.ru](https://school.mos.ru).
2. Откройте страницу токена (ссылка «Открыть страницу токена» на экране входа).
3. Скопируйте токен в поле «Токен МЭШ». Подойдёт и строка cookie с `aupd_token`.

Токен и настройки хранятся только в `localStorage` этого браузера. При ответе
401 клиент сам один раз обновляет токен (`/v2/token/refresh`).

### Про ЦДЗ

Ссылка запуска одноразовая и работает на cookie-сессии `school.mos.ru`
(OAuth к партнёру), поэтому материал открывается в новой вкладке, и чтобы
прохождение засчиталось, в этом же браузере нужно быть залогиненным на
school.mos.ru. После возврата на вкладку статус перечитывается из LRS.

## Структура

```
index.html              оболочка
assets/js/core.js       разбор ответов МЭШ и логика ЦДЗ (порт MeshCore.kt / Cdz.kt)
assets/js/api.js        HTTP-клиент через прокси (порт MeshClient.kt)
assets/js/demo.js       мок school.mos.ru для демо-режима
assets/js/glass.js      жидкое стекло (порт оптики Liquid Glass Studio)
assets/js/views.js      экраны
assets/js/main.js       состояние, маршруты, навигация с линзой
assets/js/i18n.js       переводы
assets/css/app.css      стили (токены цветов, светлая/тёмная тема)
proxy/worker.js         CORS-прокси (Cloudflare Worker)
proxy/server.mjs        локальный сервер: статика + прокси
tests/                  node --test
tools/build-icons.mjs   сборка SVG-спрайта из iconkit
```

## Разработка

```bash
npm test
```

```bash
npm start
```

Спрайт иконок пересобирается из клона iconkit:

```bash
node tools/build-icons.mjs ../iconkit
```

## Лицензия

GPLv3, см. [`LICENSE`](LICENSE). Иконки Lucide — ISC
([`assets/icons/LICENSE-lucide.txt`](assets/icons/LICENSE-lucide.txt)).
Оптика стекла основана на Liquid Glass Studio (MIT).
