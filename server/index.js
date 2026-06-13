import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from './db.js';
import { verifyTelegramData } from './auth.js';
import {
  getOrCreateUser, getSetting, setSetting,
  checkinMultiplier, changeArc, changeTon,
  isPro, adMultiplier, payReferrals,
} from './helpers.js';
import { startBot, botCheckMember, notifyAdminWithdraw, getUserPhotoBuffer, notifyLotteryResult, notifyPvpRound } from '../bot/bot.js';
import { initGameLoop, getGameState, placeBet, setPvpNotifier } from './game.js';
import { initDeposits } from './deposits.js';
import { initInactivityLoop } from './inactivity.js';
import { initLottery, getLotteryState, buyTicket, setLotteryNotifier } from './lottery.js';
import { initReminderLoop } from './reminders.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

const onlineUsers = new Map(); // tgId → timestamp of last request

function getOnlineCount() {
  const threshold = Date.now() - 15_000;
  let count = 0;
  for (const ts of onlineUsers.values()) { if (ts > threshold) count++; }
  return count;
}

async function auth(req, res, next) {
  const initData = req.headers['x-init-data'] || req.body?.initData;
  if (!initData) return res.status(401).json({ error: 'no_init_data' });
  const tgUser = verifyTelegramData(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'bad_init_data' });
  const user = await getOrCreateUser(tgUser, tgUser.start_param);
  if (user.is_banned) return res.status(403).json({ error: 'banned' });
  onlineUsers.set(tgUser.id, Date.now());
  req.tgUser = tgUser;
  req.user = user;
  next();
}

// Serves a user's Telegram profile photo, proxied through the bot so the bot token
// (embedded in Telegram's file link) is never exposed to the client. Cached in memory
// for an hour. Profile photos are public in Telegram, so no auth is required here.
const avatarCache = new Map(); // tgId -> { buf, exp }
app.get('/api/avatar/:tgId', async (req, res) => {
  const tgId = Number(req.params.tgId);
  if (!tgId) return res.status(404).end();
  const cached = avatarCache.get(tgId);
  if (cached && cached.exp > Date.now()) {
    if (!cached.buf) return res.status(404).end();
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.end(cached.buf);
  }
  const buf = await getUserPhotoBuffer(tgId);
  avatarCache.set(tgId, { buf, exp: Date.now() + 3600 * 1000 });
  if (!buf) return res.status(404).end();
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=3600');
  res.end(buf);
});

app.post('/api/me', auth, async (req, res) => {
  const todayStart = mskDate() + 'T00:00:00+03:00';
  const [{ data: u }, { count: adCount }, { count: adShortCount }, { count: adTaskCount }, { count: ad4Count }] = await Promise.all([
    supabase.from('users').select('*').eq('tg_id', req.user.tg_id).single(),
    supabase.from('transactions').select('*', { count: 'exact', head: true })
      .eq('tg_id', req.user.tg_id).eq('type', 'ad').gte('created_at', todayStart),
    supabase.from('transactions').select('*', { count: 'exact', head: true })
      .eq('tg_id', req.user.tg_id).eq('type', 'ad_short').gte('created_at', todayStart),
    supabase.from('transactions').select('*', { count: 'exact', head: true })
      .eq('tg_id', req.user.tg_id).eq('type', 'ad_task').gte('created_at', todayStart),
    supabase.from('transactions').select('*', { count: 'exact', head: true })
      .eq('tg_id', req.user.tg_id).eq('type', 'ad4').gte('created_at', todayStart),
  ]);
  const pro = isPro(u);
  // While PRO is active the checkin streak is maintained automatically at max,
  // so after expiry the user keeps ×1.5 as long as they claim daily as usual.
  if (pro && u.checkin_last !== mskDate()) {
    u.checkin_day = Math.max(u.checkin_day || 0, 6);
    await supabase.from('users')
      .update({ checkin_day: u.checkin_day, checkin_last: mskDate(), last_active_at: new Date().toISOString() })
      .eq('tg_id', req.user.tg_id);
  } else {
    await supabase.from('users').update({ last_active_at: new Date().toISOString() }).eq('tg_id', req.user.tg_id);
  }
  res.json({
    tg_id: u.tg_id, username: u.username, first_name: u.first_name,
    language: u.language, balance_arc: Number(u.balance_arc),
    balance_ton: Number(u.balance_ton), wallet: u.wallet,
    is_admin: u.is_admin, checkin_day: u.checkin_day,
    is_pro: pro, pro_until: u.pro_until,
    adsgram_block_id: process.env.ADSGRAM_BLOCK_ID || '',
    adsgram_block_id_short: process.env.ADSGRAM_BLOCK_ID_SHORT || '',
    adsgram_block_id_task: process.env.ADSGRAM_BLOCK_ID_TASK || 'task-34678',
    onclicka_spot_id: process.env.ONCLICKA_SPOT_ID || '', // ad slot 4 — OnClickA TMA Rewarded
    ad_daily_count: adCount || 0,
    ad_short_daily_count: adShortCount || 0,
    ad_task_daily_count: adTaskCount || 0,
    ad4_daily_count: ad4Count || 0,
  });
});

app.post('/api/language', auth, async (req, res) => {
  const allowed = ['ru', 'en', 'hi', 'pt', 'id', 'bn', 'vi'];
  const lang = allowed.includes(req.body.language) ? req.body.language : 'en';
  await supabase.from('users').update({ language: lang }).eq('tg_id', req.user.tg_id);
  res.json({ ok: true, language: lang });
});

app.post('/api/checkin/status', auth, async (req, res) => {
  const { data: u } = await supabase.from('users')
    .select('checkin_day, checkin_last, pro_until').eq('tg_id', req.user.tg_id).single();
  const today = mskDate();
  if (isPro(u)) {
    // PRO keeps the streak at max automatically — nothing to claim
    return res.json({ day: Math.max(u.checkin_day || 0, 6), multiplier: 1.5, canClaim: false, pro: true });
  }
  res.json({
    day: u.checkin_day, multiplier: checkinMultiplier(u.checkin_day),
    canClaim: u.checkin_last !== today,
  });
});

app.post('/api/checkin/claim', auth, async (req, res) => {
  const { data: u } = await supabase.from('users')
    .select('checkin_day, checkin_last').eq('tg_id', req.user.tg_id).single();
  const today = mskDate();
  const yesterday = mskDate(-1);
  if (u.checkin_last === today) return res.json({ ok: false, error: 'already_claimed' });
  let newDay = (u.checkin_last === yesterday) ? u.checkin_day + 1 : 1;
  await supabase.from('users').update({ checkin_day: newDay, checkin_last: today }).eq('tg_id', req.user.tg_id);
  res.json({ ok: true, day: newDay, multiplier: checkinMultiplier(newDay) });
});

app.post('/api/promo', auth, async (req, res) => {
  const code = (req.body.code || '').trim();
  if (!code) return res.json({ ok: false, error: 'empty' });
  const { data: promo } = await supabase.from('promocodes')
    .select('*').eq('code', code).eq('is_active', true).single();
  if (!promo) return res.json({ ok: false, error: 'not_found' });
  if (promo.limit_mode === 'time' && promo.expires_at && new Date(promo.expires_at) < new Date())
    return res.json({ ok: false, error: 'expired' });
  if (promo.limit_mode === 'count' && promo.used_count >= promo.limit_count)
    return res.json({ ok: false, error: 'limit_reached' });
  const { data: used } = await supabase.from('promo_uses')
    .select('id').eq('promo_id', promo.id).eq('tg_id', req.user.tg_id).single();
  if (used) return res.json({ ok: false, error: 'already_used' });
  await supabase.from('promo_uses').insert({ promo_id: promo.id, tg_id: req.user.tg_id });
  await supabase.from('promocodes').update({ used_count: promo.used_count + 1 }).eq('id', promo.id);
  const newBal = await changeArc(req.user.tg_id, promo.reward_arc, 'promo', `promo ${code}`);
  res.json({ ok: true, reward: Number(promo.reward_arc), balance_arc: newBal });
});

app.post('/api/tasks', auth, async (req, res) => {
  const today = mskDate();
  const todayStart = today + 'T00:00:00+03:00';
  const { data: tasks } = await supabase.from('tasks')
    .select('*').eq('is_active', true).order('id', { ascending: true });
  const [{ data: doneAllData }, { data: doneTodayData }] = await Promise.all([
    supabase.from('task_completions').select('task_id').eq('tg_id', req.user.tg_id),
    supabase.from('task_completions').select('task_id').eq('tg_id', req.user.tg_id).gte('created_at', todayStart),
  ]);
  const doneAll = new Set((doneAllData || []).map(d => d.task_id));
  const doneToday = new Set((doneTodayData || []).map(d => d.task_id));

  // Gather progress counts in parallel
  const needsRef = (tasks || []).some(t => t.type === 'referral_milestone');
  const needsAd = (tasks || []).some(t => t.type === 'ad_milestone');
  const needsPvp = (tasks || []).some(t => t.type === 'pvp_milestone');
  const [refRes, adRes, pvpRes] = await Promise.all([
    needsRef ? supabase.from('users').select('*', { count: 'exact', head: true }).eq('referrer_id', req.user.tg_id) : null,
    needsAd ? supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('tg_id', req.user.tg_id).eq('type', 'ad').gte('created_at', todayStart) : null,
    null,
  ]);
  const refCount = refRes ? (refRes.count || 0) : null;
  const adCount = adRes ? (adRes.count || 0) : null;
  let pvpCount = null;
  if (needsPvp) {
    const { data: betsToday } = await supabase.from('game_bets')
      .select('game_id').eq('tg_id', req.user.tg_id).gte('created_at', todayStart);
    const gameIds = [...new Set((betsToday || []).map(b => b.game_id))];
    if (gameIds.length) {
      const { count } = await supabase.from('games').select('*', { count: 'exact', head: true })
        .in('id', gameIds).eq('status', 'done').not('winner_tg_id', 'is', null);
      pvpCount = count || 0;
    } else {
      pvpCount = 0;
    }
  }

  res.json((tasks || []).map(t => {
    const isDaily = t.limit_mode === 'daily';
    const completed = isDaily ? doneToday.has(t.id) : doneAll.has(t.id);
    const base = { id: t.id, title_ru: t.title_ru, title_en: t.title_en, type: t.type, target: t.target, reward_arc: Number(t.reward_arc), completed, is_partner: !!t.is_partner };
    if (t.type === 'referral_milestone') return { ...base, progress: refCount, need: Number(t.target || 0) };
    if (t.type === 'ad_milestone') return { ...base, progress: adCount, need: Number(t.target || 0) };
    if (t.type === 'pvp_milestone') return { ...base, progress: pvpCount, need: Number(t.target || 0) };
    return base;
  }));
});

// Ad 1 — reward is credited only via S2S callback below; this route stays
// for backward compatibility with cached frontends but pays nothing.
app.post('/api/ads/watch', auth, async (req, res) => {
  res.json({ ok: false, error: 'use_s2s' });
});

// Ad 1 — Rewarded block, server-to-server callback from Adsgram (Reward URL).
// URL must include the secret token so it can't be called by anyone who guesses the path:
// https://<host>/api/adsgram/reward1?token=<ADSGRAM_S2S_SECRET>&userId={userid}
app.get('/api/adsgram/reward1', async (req, res) => {
  const secret = process.env.ADSGRAM_S2S_SECRET || '';
  if (!secret || req.query.token !== secret) return res.status(403).send('forbidden');
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).send('bad_request');

  const { data: u } = await supabase.from('users')
    .select('checkin_day, referrer_id, pro_until').eq('tg_id', userId).single();
  if (!u) return res.status(404).send('user_not_found');

  const todayStart = mskDate() + 'T00:00:00+03:00';
  const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
    .eq('tg_id', userId).eq('type', 'ad').gte('created_at', todayStart);
  if ((count || 0) >= (isPro(u) ? 15 : 10)) return res.status(200).send('daily_limit');

  const reward = Math.round(10 * adMultiplier(u));
  await changeArc(userId, reward, 'ad', 'adsgram reward1');
  await payReferrals(userId, reward, u.referrer_id);

  res.status(200).send('ok');
});

// Adsgram Task (server-to-server GET callback)
app.get('/api/adsgram/task-reward', async (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).send('bad_request');
  const todayStart = mskDate() + 'T00:00:00+03:00';
  const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
    .eq('tg_id', userId).eq('type', 'ad_task').gte('created_at', todayStart);
  if ((count || 0) >= 5) return res.status(200).send('already_rewarded');
  const { data: u } = await supabase.from('users').select('checkin_day, referrer_id, pro_until').eq('tg_id', userId).single();
  if (!u) return res.status(404).send('user_not_found');
  const reward = Math.round(5 * adMultiplier(u));
  await changeArc(userId, reward, 'ad_task', 'adsgram task');
  await payReferrals(userId, reward, u.referrer_id);
  res.status(200).send('ok');
});

// Minimum gap between client-triggered ad rewards of one type: a real ad takes
// at least this long to watch, so anything faster is a scripted replay.
const AD_COOLDOWN_MS = 15000;

async function adCooldownActive(tgId, type) {
  const { data: lastTx } = await supabase.from('transactions')
    .select('created_at').eq('tg_id', tgId).eq('type', type)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return !!(lastTx && Date.now() - new Date(lastTx.created_at).getTime() < AD_COOLDOWN_MS);
}

// Ad 2 — Interstitial (no S2S in this format), client-triggered with auth + daily limit
app.post('/api/ads/watch-short', auth, async (req, res) => {
  const todayStart = mskDate() + 'T00:00:00+03:00';
  const limit = isPro(req.user) ? 5 : 3;

  const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
    .eq('tg_id', req.user.tg_id).eq('type', 'ad_short').gte('created_at', todayStart);
  const current = count || 0;
  if (current >= limit) return res.json({ ok: false, error: 'daily_limit', daily_count: limit });
  if (await adCooldownActive(req.user.tg_id, 'ad_short'))
    return res.json({ ok: false, error: 'cooldown', daily_count: current });

  const reward = Math.round(5 * adMultiplier(req.user));
  const newBal = await changeArc(req.user.tg_id, reward, 'ad_short', 'ad short watch');
  await payReferrals(req.user.tg_id, reward, req.user.referrer_id);

  res.json({ ok: true, daily_count: current + 1, reward, balance_arc: newBal });
});

// Ad 4 — OnClickA TMA Rewarded video, client-triggered with auth + daily limit
app.post('/api/ads/watch4', auth, async (req, res) => {
  const todayStart = mskDate() + 'T00:00:00+03:00';
  const limit = isPro(req.user) ? 15 : 10;

  const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
    .eq('tg_id', req.user.tg_id).eq('type', 'ad4').gte('created_at', todayStart);
  const current = count || 0;
  if (current >= limit) return res.json({ ok: false, error: 'daily_limit', daily_count: limit });
  if (await adCooldownActive(req.user.tg_id, 'ad4'))
    return res.json({ ok: false, error: 'cooldown', daily_count: current });

  const reward = Math.round(5 * adMultiplier(req.user));
  const newBal = await changeArc(req.user.tg_id, reward, 'ad4', 'onclicka watch');
  await payReferrals(req.user.tg_id, reward, req.user.referrer_id);

  res.json({ ok: true, daily_count: current + 1, reward, balance_arc: newBal });
});

app.post('/api/tasks/check', auth, async (req, res) => {
  const taskId = req.body.task_id;
  const { data: task } = await supabase.from('tasks')
    .select('*').eq('id', taskId).eq('is_active', true).single();
  if (!task) return res.json({ ok: false, error: 'not_found' });

  const today = mskDate();
  const todayStart = today + 'T00:00:00+03:00';
  if (task.limit_mode === 'daily') {
    const { data: dc } = await supabase.from('task_completions')
      .select('id').eq('task_id', taskId).eq('tg_id', req.user.tg_id)
      .gte('created_at', todayStart).maybeSingle();
    if (dc) return res.json({ ok: false, error: 'already_done' });
  } else {
    const { data: c } = await supabase.from('task_completions')
      .select('id').eq('task_id', taskId).eq('tg_id', req.user.tg_id).maybeSingle();
    if (c) return res.json({ ok: false, error: 'already_done' });
  }

  if (task.limit_mode === 'count' && task.used_count >= task.limit_count)
    return res.json({ ok: false, error: 'limit_reached' });
  if (task.limit_mode === 'time' && task.expires_at && new Date(task.expires_at) < new Date())
    return res.json({ ok: false, error: 'expired' });

  if (task.type === 'subscribe' && task.target) {
    const ok = await botCheckMember(task.target, req.user.tg_id);
    if (!ok) return res.json({ ok: false, error: 'not_subscribed' });
  }
  if (task.type === 'referral_milestone') {
    const required = Number(task.target || 0);
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('referrer_id', req.user.tg_id);
    if ((count || 0) < required) return res.json({ ok: false, error: 'not_enough_referrals', need: required, have: count || 0 });
  }
  if (task.type === 'ad_milestone') {
    const required = Number(task.target || 0);
    const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
      .eq('tg_id', req.user.tg_id).eq('type', 'ad').gte('created_at', todayStart);
    if ((count || 0) < required) return res.json({ ok: false, error: 'not_enough_views', need: required, have: count || 0 });
  }
  if (task.type === 'pvp_milestone') {
    const required = Number(task.target || 0);
    const { data: betsToday } = await supabase.from('game_bets')
      .select('game_id').eq('tg_id', req.user.tg_id).gte('created_at', todayStart);
    const gameIds = [...new Set((betsToday || []).map(b => b.game_id))];
    let pvpDone = 0;
    if (gameIds.length) {
      const { count } = await supabase.from('games').select('*', { count: 'exact', head: true })
        .in('id', gameIds).eq('status', 'done').not('winner_tg_id', 'is', null);
      pvpDone = count || 0;
    }
    if (pvpDone < required) return res.json({ ok: false, error: 'not_enough_pvp', need: required, have: pvpDone });
  }

  // For daily tasks: upsert so the unique constraint doesn't block re-completion the next day.
  // The pre-check above (gte todayStart) is the guard against same-day duplicates.
  // For non-daily tasks: plain insert — the unique constraint is the atomic race guard.
  if (task.limit_mode === 'daily') {
    await supabase.from('task_completions')
      .upsert({ task_id: taskId, tg_id: req.user.tg_id, created_at: new Date().toISOString() },
               { onConflict: 'task_id,tg_id' });
  } else {
    const { error: insErr } = await supabase
      .from('task_completions')
      .insert({ task_id: taskId, tg_id: req.user.tg_id });
    if (insErr) return res.json({ ok: false, error: 'already_done' });
  }
  await supabase.from('tasks').update({ used_count: task.used_count + 1 }).eq('id', taskId);
  const newBal = await changeArc(req.user.tg_id, task.reward_arc, 'task', `task ${taskId}`);
  res.json({ ok: true, reward: Number(task.reward_arc), balance_arc: newBal });
});

app.post('/api/referrals', auth, async (req, res) => {
  const { data: lvl1 } = await supabase.from('users')
    .select('tg_id, username').eq('referrer_id', req.user.tg_id);
  const lvl1Ids = (lvl1 || []).map(u => u.tg_id);
  let lvl2 = [];
  if (lvl1Ids.length) {
    const { data } = await supabase.from('users')
      .select('tg_id, username').in('referrer_id', lvl1Ids);
    lvl2 = data || [];
  }
  const earnings = await referralEarnings(req.user.tg_id);
  res.json({
    link: `https://t.me/${process.env.BOT_USERNAME || 'arc_tonbot'}?startapp=${req.user.tg_id}`,
    level1: (lvl1 || []).map(u => ({ username: u.username, earned: earnings[u.tg_id] || 0 })),
    level2: lvl2.map(u => ({ username: u.username, earned: earnings[u.tg_id] || 0 })),
  });
});

async function referralEarnings(tgId) {
  const { data } = await supabase.from('transactions')
    .select('amount, note').eq('tg_id', tgId).eq('type', 'referral');
  const map = {};
  (data || []).forEach(t => {
    const from = (t.note || '').replace('from ', '');
    map[from] = (map[from] || 0) + Number(t.amount);
  });
  return map;
}

app.post('/api/online', auth, (req, res) => {
  res.json({ count: getOnlineCount() });
});

app.post('/api/pvp/state', auth, async (req, res) => {
  const state = await getGameState();
  state.onlineCount = getOnlineCount();
  res.json(state);
});

app.post('/api/pvp/bet', auth, async (req, res) => {
  const amount = Number(req.body.amount);
  const pro = isPro(req.user);
  const maxBet = pro ? 2000 : 1000;
  if (!(amount >= 10 && amount <= maxBet)) return res.json({ ok: false, error: 'bad_amount' });
  const result = await placeBet(req.user.tg_id, req.user.username, req.user.first_name, amount, pro);
  res.json(result);
});

// PRO subscription: atomic purchase — TON is deducted and pro_until extended
// in a single DB statement, so PRO can never appear without payment.
const PRO_PRICE_TON = 0.2;
const PRO_DAYS = 7;

app.post('/api/pro/buy', auth, async (req, res) => {
  const { data: newUntil, error } = await supabase.rpc('try_buy_pro', {
    p_tg_id: req.user.tg_id, p_price: PRO_PRICE_TON, p_days: PRO_DAYS,
  });
  if (error) return res.json({ ok: false, error: 'server' });
  if (!newUntil) return res.json({ ok: false, error: 'not_enough_ton', price: PRO_PRICE_TON });
  await supabase.from('transactions').insert({
    tg_id: req.user.tg_id, type: 'pro', currency: 'TON', amount: -PRO_PRICE_TON,
    note: `PRO +${PRO_DAYS}d`,
  });
  const { data: u } = await supabase.from('users').select('balance_ton').eq('tg_id', req.user.tg_id).single();
  res.json({ ok: true, pro_until: newUntil, balance_ton: Number(u.balance_ton) });
});

app.post('/api/lottery/state', auth, async (req, res) => {
  res.json(await getLotteryState());
});

app.post('/api/lottery/buy', auth, async (req, res) => {
  const result = await buyTicket(req.user.tg_id, req.user.username, req.user.first_name);
  res.json(result);
});

app.post('/api/lottery/history', auth, async (req, res) => {
  const { data: rounds } = await supabase.from('lottery_rounds')
    .select('id, round_no, winner_tg_id, result_index, result_roll, server_seed, server_seed_hash, finished_at')
    .eq('status', 'done').not('winner_tg_id', 'is', null)
    .order('finished_at', { ascending: false }).limit(20);

  const winnerIds = [...new Set((rounds || []).map(r => r.winner_tg_id).filter(Boolean))];
  let userMap = {};
  if (winnerIds.length) {
    const { data: us } = await supabase.from('users').select('tg_id, username').in('tg_id', winnerIds);
    (us || []).forEach(u => { userMap[u.tg_id] = u.username; });
  }

  const roundIds = (rounds || []).map(r => r.id);
  let ticketsMap = {};
  if (roundIds.length) {
    const { data: tks } = await supabase.from('lottery_tickets')
      .select('round_id, tg_id, username').in('round_id', roundIds);
    (tks || []).forEach(t => {
      if (!ticketsMap[t.round_id]) ticketsMap[t.round_id] = [];
      ticketsMap[t.round_id].push(t);
    });
  }

  res.json((rounds || []).map(r => ({
    round_no: r.round_no,
    winner: userMap[r.winner_tg_id] || '...',
    winner_tg_id: r.winner_tg_id,
    winner_index: r.result_index,
    result_roll: r.result_roll,
    seed_hash: r.server_seed_hash,
    server_seed: r.server_seed,
    time: r.finished_at,
    tickets: (ticketsMap[r.id] || []).map(t => ({ tg_id: t.tg_id, username: t.username })),
  })));
});

app.post('/api/wallet/connect', auth, async (req, res) => {
  const wallet = (req.body.wallet || '').trim();
  if (!wallet) return res.json({ ok: false });
  await supabase.from('users').update({ wallet }).eq('tg_id', req.user.tg_id);
  res.json({ ok: true });
});

app.post('/api/wallet/disconnect', auth, async (req, res) => {
  await supabase.from('users').update({ wallet: null }).eq('tg_id', req.user.tg_id);
  res.json({ ok: true });
});

app.post('/api/withdraw', auth, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!(amount >= 0.1)) return res.json({ ok: false, error: 'bad_amount' });
  const { data: u } = await supabase.from('users')
    .select('balance_ton, wallet, username').eq('tg_id', req.user.tg_id).single();
  if (!u.wallet) return res.json({ ok: false, error: 'no_wallet' });
  if (Number(u.balance_ton) < amount) return res.json({ ok: false, error: 'not_enough' });
  const newBal = await changeTon(req.user.tg_id, -amount, 'withdraw', `withdraw to ${u.wallet}`);
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const datetime = now.toISOString().replace('T', ' ').slice(0, 19) + ' МСК';
  await notifyAdminWithdraw(req.user.tg_id, u.username, amount, u.wallet, newBal, datetime);
  res.json({ ok: true, balance_ton: newBal });
});

app.post('/api/transactions/history', auth, async (req, res) => {
  const { data } = await supabase.from('transactions')
    .select('type, currency, amount, note, created_at')
    .eq('tg_id', req.user.tg_id)
    .in('type', ['deposit', 'withdraw', 'exchange'])
    .order('created_at', { ascending: false })
    .limit(100);
  res.json(data || []);
});

app.post('/api/pvp/history', auth, async (req, res) => {
  const { data: games } = await supabase.from('games')
    .select('round_no, pot_arc, winner_tg_id, winner_chance, commission_arc, finished_at')
    .eq('status', 'done').not('winner_tg_id', 'is', null)
    .order('finished_at', { ascending: false }).limit(30);
  const winnerIds = [...new Set((games || []).map(g => g.winner_tg_id).filter(Boolean))];
  let usernameMap = {};
  if (winnerIds.length) {
    const { data: us } = await supabase.from('users').select('tg_id, username').in('tg_id', winnerIds);
    (us || []).forEach(u => { usernameMap[u.tg_id] = u.username; });
  }
  res.json((games || []).map(g => ({
    round_no: g.round_no,
    winner: usernameMap[g.winner_tg_id] || '...',
    chance: Number(g.winner_chance).toFixed(1),
    prize: (Number(g.pot_arc) - Number(g.commission_arc)).toFixed(0),
    pot: Number(g.pot_arc),
    time: g.finished_at,
  })));
});

app.post('/api/pvp/round', auth, async (req, res) => {
  const roundNo = Number(req.body.round_no);
  if (!roundNo) return res.json({ ok: false, error: 'bad_round' });
  const { data: game } = await supabase.from('games')
    .select('id, round_no, pot_arc, winner_tg_id, winner_chance, commission_arc, result_roll, finished_at, server_seed, server_seed_hash')
    .eq('round_no', roundNo).eq('status', 'done').not('winner_tg_id', 'is', null)
    .order('finished_at', { ascending: false }).limit(1).single();
  if (!game) return res.json({ ok: false, error: 'not_found' });

  const { data: bets } = await supabase.from('game_bets')
    .select('tg_id, amount_arc').eq('game_id', game.id);
  // Aggregate multiple bets from the same player into one entry
  const totals = {};
  (bets || []).forEach(b => { totals[b.tg_id] = (totals[b.tg_id] || 0) + Number(b.amount_arc); });

  const ids = Object.keys(totals).map(Number);
  let userMap = {};
  if (ids.length) {
    const { data: us } = await supabase.from('users').select('tg_id, username, first_name').in('tg_id', ids);
    (us || []).forEach(u => { userMap[u.tg_id] = u; });
  }

  const pot = Number(game.pot_arc);
  const players = ids.map(id => ({
    tg_id: id,
    username: userMap[id]?.username || null,
    first_name: userMap[id]?.first_name || null,
    amount: totals[id],
    chance: pot ? ((totals[id] / pot) * 100).toFixed(2) : '0',
    is_winner: id === game.winner_tg_id,
  })).sort((a, b) => b.amount - a.amount);

  res.json({
    ok: true,
    round_no: game.round_no,
    pot,
    commission: Number(game.commission_arc),
    prize: pot - Number(game.commission_arc),
    winner_chance: Number(game.winner_chance).toFixed(2),
    result_roll: game.result_roll,
    seed_hash: game.server_seed_hash,
    server_seed: game.server_seed,
    finished_at: game.finished_at,
    players,
  });
});

app.post('/api/leaderboard/arc', auth, async (req, res) => {
  const { data: users } = await supabase.from('users')
    .select('tg_id, username, balance_arc, pro_until')
    .order('balance_arc', { ascending: false })
    .limit(50);
  const top = (users || []).map((u, i) => ({
    rank: i + 1,
    username: u.username || '...',
    arc: Number(u.balance_arc),
    pro: isPro(u),
  }));

  // Find my rank — works whether or not I'm in the top 50
  const inTop = (users || []).findIndex(u => u.tg_id === req.user.tg_id);
  let myRank = null;
  if (inTop !== -1) {
    myRank = { rank: inTop + 1, username: users[inTop].username || '...', arc: Number(users[inTop].balance_arc), pro: isPro(users[inTop]) };
  } else {
    const { data: me } = await supabase.from('users')
      .select('username, balance_arc, pro_until').eq('tg_id', req.user.tg_id).single();
    if (me) {
      // My rank = number of users with strictly higher balance, +1
      const { count } = await supabase.from('users')
        .select('*', { count: 'exact', head: true })
        .gt('balance_arc', me.balance_arc);
      myRank = { rank: (count || 0) + 1, username: me.username || '...', arc: Number(me.balance_arc), pro: isPro(me) };
    }
  }
  res.json({ top, myRank });
});

app.post('/api/leaderboard/refs', auth, async (req, res) => {
  const CONTEST_START = '2026-06-09T00:00:00+03:00';
  // Get new users since contest start
  const { data: newUsers } = await supabase.from('users')
    .select('tg_id, referrer_id, wallet').gte('created_at', CONTEST_START);
  if (!newUsers?.length) return res.json({ top: [], myRank: null, contestEnd: '2026-06-23' });

  // Check activity for each new user: 3+ ads OR wallet connected OR any PvP bet
  const newIds = newUsers.map(u => u.tg_id);
  const { data: adCounts } = await supabase.from('transactions')
    .select('tg_id').eq('type', 'ad').in('tg_id', newIds);
  const { data: pvpPlays } = await supabase.from('transactions')
    .select('tg_id').eq('type', 'pvp').lt('amount', 0).in('tg_id', newIds);

  const adMap = {};
  (adCounts || []).forEach(r => { adMap[r.tg_id] = (adMap[r.tg_id] || 0) + 1; });
  const pvpSet = new Set((pvpPlays || []).map(r => r.tg_id));

  const activeNewUserIds = new Set(
    newUsers.filter(u =>
      (adMap[u.tg_id] || 0) >= 3 || u.wallet || pvpSet.has(u.tg_id)
    ).map(u => u.tg_id)
  );

  // Count active refs per referrer
  const refCount = {};
  newUsers.forEach(u => {
    if (u.referrer_id && activeNewUserIds.has(u.tg_id)) {
      refCount[u.referrer_id] = (refCount[u.referrer_id] || 0) + 1;
    }
  });

  // Get usernames for referrers
  const referrerIds = Object.keys(refCount).map(Number);
  if (!referrerIds.length) return res.json({ top: [], myRank: null, contestEnd: '2026-06-23' });

  const { data: referrers } = await supabase.from('users')
    .select('tg_id, username').in('tg_id', referrerIds);

  const top = (referrers || [])
    .map(u => ({ tg_id: u.tg_id, username: u.username || '...', refs: refCount[u.tg_id] || 0 }))
    .sort((a, b) => b.refs - a.refs)
    .map((u, i) => ({ ...u, rank: i + 1 }))
    .slice(0, 50);

  const myEntry = top.find(u => u.tg_id === req.user.tg_id);
  const myRank = myEntry || null;
  res.json({ top, myRank, contestEnd: '2026-06-23' });
});

app.post('/api/deposit/info', auth, async (req, res) => {
  res.json({
    wallet: process.env.PROJECT_WALLET,
    comment: String(req.user.tg_id),
    min: 0.1,
    maxDay: 50,
  });
});

app.post('/api/exchange/info', auth, async (req, res) => {
  const [tonUsd, arcUsd, limitTon] = await Promise.all([
    getSetting('ton_usd'), getSetting('arc_usd'), getSetting('exchange_daily_limit_ton'),
  ]);
  const rate = (tonUsd && arcUsd) ? Math.round(Number(tonUsd) / Number(arcUsd)) : 0;
  const limit = Number(limitTon || 5);
  const today = mskDate();
  const { data: daily } = await supabase.from('exchange_daily')
    .select('used_ton').eq('tg_id', req.user.tg_id).eq('date', today).single();
  res.json({ rate, limit_ton: limit, used_ton: daily ? Number(daily.used_ton) : 0 });
});

app.post('/api/exchange/ton-arc', auth, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!(amount >= 0.1)) return res.json({ ok: false, error: 'bad_amount' });
  const [tonUsd, arcUsd, limitTon] = await Promise.all([
    getSetting('ton_usd'), getSetting('arc_usd'), getSetting('exchange_daily_limit_ton'),
  ]);
  if (!tonUsd || !arcUsd) return res.json({ ok: false, error: 'rate_unavailable' });
  const limit = Number(limitTon || 5);
  const { data: u } = await supabase.from('users').select('balance_ton').eq('tg_id', req.user.tg_id).single();
  if (Number(u.balance_ton) < amount) return res.json({ ok: false, error: 'not_enough_ton' });
  const today = mskDate();
  const { data: daily } = await supabase.from('exchange_daily')
    .select('used_ton').eq('tg_id', req.user.tg_id).eq('date', today).single();
  const usedTon = daily ? Number(daily.used_ton) : 0;
  if (usedTon + amount > limit) return res.json({ ok: false, error: 'limit_exceeded' });
  const rate = Math.round(Number(tonUsd) / Number(arcUsd));
  const arcAmount = Math.round(amount * rate);
  await changeTon(req.user.tg_id, -amount, 'exchange', `ton→arc ${amount}`);
  const newArc = await changeArc(req.user.tg_id, arcAmount, 'exchange', `ton→arc ${amount}`);
  if (daily) {
    await supabase.from('exchange_daily').update({ used_ton: usedTon + amount }).eq('tg_id', req.user.tg_id).eq('date', today);
  } else {
    await supabase.from('exchange_daily').insert({ tg_id: req.user.tg_id, date: today, used_ton: amount });
  }
  const { data: me } = await supabase.from('users').select('balance_ton').eq('tg_id', req.user.tg_id).single();
  res.json({ ok: true, arc_received: arcAmount, balance_arc: newArc, balance_ton: Number(me.balance_ton) });
});

function mskDate(offsetDays = 0) {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return msk.toISOString().slice(0, 10);
}

async function updateTonPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
    const data = await res.json();
    const price = data?.['the-open-network']?.usd;
    if (price) await setSetting('ton_usd', String(price));
  } catch (e) {
    console.log('price fetch error:', e.message);
  }
}

async function initSettings() {
  if (!await getSetting('arc_usd')) await setSetting('arc_usd', '0.0001');
  if (!await getSetting('exchange_daily_limit_ton')) await setSetting('exchange_daily_limit_ton', '5');
  await updateTonPrice();
  setInterval(updateTonPrice, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ARCADE server running on :${PORT}`);
  startBot();
  setLotteryNotifier(notifyLotteryResult);
  setPvpNotifier(notifyPvpRound);
  initGameLoop();
  initDeposits();
  initSettings();
  initInactivityLoop();
  initReminderLoop();
  initLottery();
});
