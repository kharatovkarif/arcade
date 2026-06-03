# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Полная документация проекта для Claude Code и разработчика.
Читай это ПЕРВЫМ перед любыми правками.

---

## Что это за проект

**ARCADE** — Telegram Mini App (веб-приложение внутри Telegram).
Пользователи зарабатывают монеты **ARC** и играют в PvP рулетку, ставя ARC.

**Бот:** @arc_tonbot
**Канал:** https://t.me/arcare_ton
**Поддержка:** https://t.me/Ventlp
**Хостинг:** Railway (`https://arcade-production-f79b.up.railway.app`)
**БД:** Supabase (PostgreSQL)

---

## Запуск

```bash
npm install
npm start          # node server/index.js
```

Требуется `.env` по образцу `.env.example`:

| Переменная | Описание |
|---|---|
| `BOT_TOKEN` | Токен бота от @BotFather |
| `ADMIN_ID` | Telegram ID владельца (число) |
| `BOT_USERNAME` | arc_tonbot |
| `APP_URL` | URL хостинга (адрес Railway) |
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_SERVICE_KEY` | service_role ключ из Supabase (не anon!) |
| `PROJECT_WALLET` | TON кошелёк платформы |
| `PORT` | 3000 |

Тесты, линтер и CI/CD отсутствуют.

---

## Стек технологий

- **Backend:** Node.js ≥18 + Express, **ES-модули** (`"type": "module"` в package.json)
- **База данных:** Supabase (PostgreSQL) через `@supabase/supabase-js`
- **Telegram Bot:** `node-telegram-bot-api` (polling-режим)
- **Frontend:** Единый `public/index.html` (HTML + CSS + vanilla JS, без фреймворков)
- **Крипта:** TON Connect UI v2 для подключения кошельков; tonapi.io v2 для мониторинга депозитов

---

## Структура репозитория

```
arcade/
├── server/
│   ├── index.js      — Express-сервер, все API-маршруты, точка входа
│   ├── auth.js       — HMAC-SHA256 валидация Telegram initData
│   ├── db.js         — Supabase клиент
│   ├── helpers.js    — getOrCreateUser, changeArc, changeTon, checkinMultiplier
│   ├── game.js       — PvP рулетка (in-memory состояние, игровой цикл)
│   └── deposits.js   — Polling tonapi.io каждые 8 сек, зачисление TON
├── bot/
│   └── bot.js        — Telegram бот, /start, админские команды
├── public/
│   ├── index.html    — единая страница Mini App (5 табов)
│   ├── js/
│   │   ├── app.js    — UI-логика, fetch-обёртки, переключение табов
│   │   └── i18n.js   — переводы RU/EN (window.I18N)
│   └── css/
│       └── style.css — тёмная тема (#000 фон, белые акценты, #ffd60a золото)
├── db/
│   └── schema.sql    — DDL схемы PostgreSQL
└── package.json
```

---

## Архитектура бэкенда

### Авторизация

Все защищённые маршруты проходят через `auth` middleware (`server/index.js:22`).
Middleware читает заголовок `x-init-data`, проверяет HMAC-SHA256 подпись Telegram (`server/auth.js`),
получает или создаёт пользователя в БД, кладёт `req.user` и `req.tgUser` в request.
Незарегистрированные пользователи создаются автоматически при первом запросе.

### Изменение балансов

**Никогда не обновляй `balance_arc` или `balance_ton` напрямую через UPDATE.**
Всегда используй `changeArc(tgId, amount, type, note)` и `changeTon(tgId, amount, type, note, txHash)` из `server/helpers.js` — они атомарно обновляют баланс и записывают транзакцию.
Отрицательный `amount` — списание, положительный — зачисление.

### PvP рулетка (`server/game.js`)

Состояние раунда хранится **в памяти** в переменной `current`. При рестарте сервера — новый раунд.
Цикл запускается в `initGameLoop()` через `setInterval(1000ms)`.

Жизненный цикл раунда:
1. `waiting` — ждём первого игрока
2. `counting` (15 сек) — 2+ игроков, идёт обратный отсчёт
3. `spinning` → определяем победителя, начисляем приз
4. `done` (3 сек) → `newRound()`

Победитель: `HMAC-SHA256(serverSeed, gameId)` → hex → float [0,1) → ticket по весам ставок.
Комиссия: 10% от пула (сгорает).
Ставка: 10–1000 ARC, макс. 10 игроков.

### Депозиты TON (`server/deposits.js`)

Polling tonapi.io каждые 8 сек. Комментарий к переводу = `tg_id` пользователя (чисто цифры).
Дедупликация по `tx_hash` в таблице `transactions`.
Лимит: 50 TON/день на пользователя, мин. депозит 0.1 TON.

---

## API маршруты

Все маршруты — POST. Все (кроме статики) требуют авторизации через `x-init-data`.

```
POST /api/me                — регистрация/обновление, возвращает данные пользователя
POST /api/language          — смена языка {language: 'ru'|'en'}
POST /api/checkin/status    — статус чек-ина
POST /api/checkin/claim     — получить чек-ин
POST /api/promo             — использовать промокод {code}
POST /api/tasks             — список активных заданий
POST /api/tasks/check       — выполнить задание {task_id}
POST /api/referrals         — список рефералов и реф-ссылка
POST /api/pvp/state         — текущее состояние PvP раунда
POST /api/pvp/bet           — поставить ставку {amount}
POST /api/wallet/connect    — подключить кошелёк {wallet}
POST /api/wallet/disconnect — отключить кошелёк
POST /api/deposit/info      — адрес и инструкция для депозита
```

---

## База данных

Схема в `db/schema.sql`. Таблицы:

- **users** — `tg_id` (bigint PK), балансы `balance_arc`/`balance_ton`, `wallet`, `referrer_id`, `checkin_day`, `checkin_last`, `language`, `is_banned`, `is_admin`
- **games** — раунды PvP, `server_seed`/`server_seed_hash` для provably fair
- **game_bets** — ставки в раундах (FK → games)
- **transactions** — все движения средств, `type`: `pvp`/`deposit`/`task`/`promo`/`referral` и т.д.
- **tasks** — задания с `title_ru`/`title_en`, `type`: `subscribe`/`link`
- **task_completions** — UNIQUE(task_id, tg_id), защита от дублей
- **promocodes** — промокоды, `limit_mode`: `global`/`count`/`time`
- **promo_uses** — UNIQUE(promo_id, tg_id)
- **settings** — ключ-значение: `round_counter`, `ton_usd`, `arc_usd`, `pvp_commission`, `exchange_daily_limit_ton`
- **exchange_daily** — дневной лимит обмена по пользователю

---

## Как работает чек-ин

6 дней подряд, сброс в 00:00 МСК. Пропустил день — серия с дня 1.
Множитель влияет только на будущие начисления (сейчас используется фронтом как информация).

| День | Множитель |
|------|-----------|
| 1 | ×1.0 |
| 2 | ×1.1 |
| 3 | ×1.2 |
| 4 | ×1.3 |
| 5 | ×1.4 |
| 6+ | ×1.5 |

---

## Реферальная система

Реф-ссылка: `t.me/arc_tonbot?startapp=<tgId>`
При регистрации нового пользователя `start_param` парсится как `referrer_id`.
Комиссионные начисляются через `changeArc(..., 'referral', ...)` при событиях (логика на стороне разработчика).
- Уровень 1 (прямые рефералы): 20%
- Уровень 2 (рефералы рефералов): 10%

---

## Фронтенд (`public/`)

SPA с 5 табами, переключаются через `data-tab` / `data-page` атрибуты в `app.js`.
Порядок навигации снизу:
1. **PvP** — рулетка, ставки, provably fair хэш
2. **Задания** — чек-ин (6 дней), промокод, задания из бота
3. **Главная** (центр) — баланс ARC/TON, основная информация
4. **Друзья** — реф-ссылка, список, уровни 20%/10%
5. **Профиль** — кошелёк TON, история транзакций

**i18n:** переводы в `public/js/i18n.js`, объект `window.I18N`. Язык сохраняется через `/api/language`.
**PvP polling:** фронтенд дёргает `/api/pvp/state` каждые 1.5 сек.
**Тема:** чёрный фон (#000000), белые акценты, золотой (#ffd60a).

---

## Команды бота (только для ADMIN_ID)

```
/admin                                       — список команд
/promo_add CODE REWARD MODE [num]            — создать промокод (modes: global|count|time)
/promo_del CODE                              — отключить промокод
/task_add subscribe @chan 50 | RU | EN       — задание-подписка
/task_add link https://... 50 | RU | EN      — задание-ссылка
/task_del ID                                 — отключить задание
/stats                                       — количество пользователей
```

---

## Важные детали

- Проект использует **ES-модули**: везде `import`/`export`, не `require`. Node.js ≥18 обязателен.
- `mskDate()` в `server/index.js` — вспомогательная функция для дат в часовом поясе МСК (+3ч UTC).
- Supabase клиент использует `service_role` ключ — RLS на таблицах не применяется.
- `bot.js` запускается в том же процессе, что и Express (`startBot()` вызывается в `app.listen`).
- Состояние PvP (`current`) — только в памяти: при рестарте незавершённые раунды теряются.
