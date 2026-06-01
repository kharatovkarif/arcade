# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
npm install

# Start the server (also starts the bot, game loop, and deposit watcher)
npm start
# or
node server/index.js
```

There is no build step, no linter, and no test suite configured. The project uses ES Modules (`"type": "module"` in package.json), so all files use `import`/`export` syntax and require Node.js ≥ 18.

## Environment Setup

Copy `.env.example` to `.env` and populate:

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram Bot API token |
| `ADMIN_ID` | Telegram user ID of the admin |
| `BOT_USERNAME` | Bot's Telegram username (without @) |
| `APP_URL` | Deployed Mini App URL |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `PROJECT_WALLET` | TON wallet address that receives deposits |
| `PORT` | HTTP port (default: 3000) |

Run `db/schema.sql` against the Supabase project once to create all tables and seed default settings.

## Architecture

This is a **Telegram Mini App** for a PvP gaming platform on the TON blockchain. A single Node.js process runs everything: the Express HTTP server, the Telegram bot (long-polling), the PvP game loop (in-memory), and the TON deposit watcher (polling TONApi every 8 s).

```
server/index.js      ← Entry point: wires Express, calls startBot/initGameLoop/initDeposits
server/auth.js       ← Telegram initData HMAC-SHA256 verification
server/db.js         ← Supabase client singleton
server/helpers.js    ← getOrCreateUser, changeArc/changeTon (balance mutations + transaction log)
server/game.js       ← In-memory PvP roulette state machine
server/deposits.js   ← TONApi v2 polling, deduplication via tx_hash
bot/bot.js           ← Telegram bot: /start, admin commands, notifyAdmin
public/              ← Static frontend (Vanilla JS, no framework)
  js/app.js          ← All frontend logic, polls /api/pvp/state every 1.5 s
  js/i18n.js         ← Russian + English translation strings
db/schema.sql        ← Full PostgreSQL schema + seed data
```

### Authentication flow

Every API route passes through the `auth` middleware in `server/index.js`. The client sends Telegram's `initData` in the `x-init-data` header (or request body). `verifyTelegramData` in `server/auth.js` validates the HMAC-SHA256 signature against `BOT_TOKEN`. On success, `getOrCreateUser` upserts the user row and attaches it to `req.user`.

### Balance mutations

**Never update `balance_arc` or `balance_ton` directly.** Always use `changeArc(tgId, amount, type, note)` or `changeTon(tgId, amount, type, note, txHash)` from `server/helpers.js`. These functions atomically update the balance and insert a row into `transactions` (the audit log). Negative `amount` values deduct balance.

### PvP game state

The game state lives entirely in-memory in `server/game.js` (the `current` object). The `initGameLoop` sets a 1-second interval that fires `finishRound` once the countdown expires. The game goes through states: `waiting → counting → spinning → done`, then a new round starts after a 3-second display window. The winning roll is derived from `HMAC-SHA256(serverSeed, gameId)` for provable fairness — the `server_seed_hash` is published to players before the round ends and the seed is revealed after.

### Deposit processing

`server/deposits.js` polls `https://tonapi.io/v2/accounts/{WALLET}/events` every 8 seconds. A deposit is credited only when:
1. Transfer amount ≥ 0.1 TON
2. The transaction comment is a valid `tg_id` matching an existing user
3. The `event_id` (used as `tx_hash`) has not been processed before
4. The user's daily deposit total would not exceed 50 TON

### Admin bot commands

Admin commands in `bot/bot.js` are gated to `process.env.ADMIN_ID`:

```
/promo_add CODE REWARD MODE [count]   — create promo (mode: global|count|time)
/promo_del CODE                       — deactivate promo
/task_add TYPE TARGET REWARD | RU title | EN title
/task_del ID
/stats
```

`TYPE` for tasks is `subscribe` (verifies Telegram channel membership via `botCheckMember`) or any other string (honour-system).

### Database conventions

- All timestamps are `timestamptz`; dates for daily limits use Moscow time (UTC+3), computed inline as `new Date(Date.now() + 3*3600*1000).toISOString().slice(0,10)`.
- The `settings` table is a simple key-value store accessed via `getSetting`/`setSetting`. Current keys: `round_counter`, `ton_usd`, `arc_usd`, `pvp_commission`, `exchange_daily_limit_ton`.
- Referral earnings are inferred from the `transactions` table (type=`referral`, note=`from <tg_id>`); there is no dedicated referral_earnings table.

### Frontend

`public/js/app.js` is a single file with all page logic. Pages are shown/hidden by toggling CSS classes. The PvP wheel is a CSS `conic-gradient` recomputed from the player list on each poll. TonConnect UI v2 is loaded from a CDN and communicates wallet events back to `/api/wallet/connect` and `/api/wallet/disconnect`.

Features marked **"coming soon"** in the UI (withdraw, TON→ARC exchange, ad watching) have placeholder buttons that trigger toast notifications — the backend endpoints do not yet exist.
