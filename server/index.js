import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { supabase } from './db.js';
import { verifyTelegramData } from './auth.js';
import {
  getOrCreateUser, getSetting, setSetting,
  checkinMultiplier, changeArc, changeTon,
} from './helpers.js';
import { startBot, botCheckMember, notifyAdminWithdraw } from '../bot/bot.js';
import { initGameLoop, getGameState, placeBet } from './game.js';
import { initDeposits } from './deposits.js';

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

async function auth(req, res, next) {
  const initData = req.headers['x-init-data'] || req.body?.initData;
  if (!initData) return res.status(401).json({ error: 'no_init_data' });
  const tgUser = verifyTelegramData(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'bad_init_data' });
  const user = await getOrCreateUser(tgUser, tgUser.start_param);
  if (user.is_banned) return res.status(403).json({ error: 'banned' });
  req.tgUser = tgUser;
  req.user = user;
  next();
}

app.post('/api/me', auth, async (req, res) => {
  const { data: u } = await supabase.from('users').select('*').eq('tg_id', req.user.tg_id).single();
  res.json({
    tg_id: u.tg_id, username: u.username, first_name: u.first_name,
    language: u.language, balance_arc: Number(u.balance_arc),
    balance_ton: Number(u.balance_ton), wallet: u.wallet,
    is_admin: u.is_admin, checkin_day: u.checkin_day,
    adsgram_block_id: process.env.ADSGRAM_BLOCK_ID || '',
  });
});

app.post('/api/language', auth, async (req, res) => {
  const lang = req.body.language === 'en' ? 'en' : 'ru';
  await supabase.from('users').update({ language: lang }).eq('tg_id', req.user.tg_id);
  res.json({ ok: true, language: lang });
});

app.post('/api/checkin/status', auth, async (req, res) => {
  const { data: u } = await supabase.from('users')
    .select('checkin_day, checkin_last').eq('tg_id', req.user.tg_id).single();
  const today = mskDate();
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
  const { data: done } = await supabase.from('task_completions')
    .select('task_id, created_at').eq('tg_id', req.user.tg_id);
  const doneAll = new Set((done || []).map(d => d.task_id));
  const doneToday = new Set((done || []).filter(d => d.created_at >= todayStart).map(d => d.task_id));

  // Gather progress counts in parallel
  const needsRef = (tasks || []).some(t => t.type === 'referral_milestone');
  const needsAd = (tasks || []).some(t => t.type === 'ad_milestone');
  const needsPvp = (tasks || []).some(t => t.type === 'pvp_milestone');
  const [refRes, adRes, pvpRes] = await Promise.all([
    needsRef ? supabase.from('users').select('*', { count: 'exact', head: true }).eq('referrer_id', req.user.tg_id) : null,
    needsAd ? supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('tg_id', req.user.tg_id).eq('type', 'ad').gte('created_at', todayStart) : null,
    needsPvp ? supabase.from('transactions').select('*', { count: 'exact', head: true }).eq('tg_id', req.user.tg_id).eq('type', 'pvp').eq('currency', 'ARC').lt('amount', 0).gte('created_at', todayStart) : null,
  ]);
  const refCount = refRes ? (refRes.count || 0) : null;
  const adCount = adRes ? (adRes.count || 0) : null;
  const pvpCount = pvpRes ? (pvpRes.count || 0) : null;

  res.json((tasks || []).map(t => {
    const isDaily = t.limit_mode === 'daily';
    const completed = isDaily ? doneToday.has(t.id) : doneAll.has(t.id);
    const base = { id: t.id, title_ru: t.title_ru, title_en: t.title_en, type: t.type, target: t.target, reward_arc: Number(t.reward_arc), completed };
    if (t.type === 'referral_milestone') return { ...base, progress: refCount, need: Number(t.target || 0) };
    if (t.type === 'ad_milestone') return { ...base, progress: adCount, need: Number(t.target || 0) };
    if (t.type === 'pvp_milestone') return { ...base, progress: pvpCount, need: Number(t.target || 0) };
    return base;
  }));
});

app.post('/api/ads/watch', auth, async (req, res) => {
  const todayStart = mskDate() + 'T00:00:00+03:00';
  const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
    .eq('tg_id', req.user.tg_id).eq('type', 'ad').gte('created_at', todayStart);
  const current = count || 0;
  if (current >= 30) return res.json({ ok: false, error: 'daily_limit', daily_count: 30 });
  await supabase.from('transactions').insert({ tg_id: req.user.tg_id, type: 'ad', currency: 'ARC', amount: 0, note: 'ad watch' });
  res.json({ ok: true, daily_count: current + 1 });
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
    const { count } = await supabase.from('transactions').select('*', { count: 'exact', head: true })
      .eq('tg_id', req.user.tg_id).eq('type', 'pvp').eq('currency', 'ARC').lt('amount', 0).gte('created_at', todayStart);
    if ((count || 0) < required) return res.json({ ok: false, error: 'not_enough_pvp', need: required, have: count || 0 });
  }

  await supabase.from('task_completions').insert({ task_id: taskId, tg_id: req.user.tg_id });
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

app.post('/api/pvp/state', auth, async (req, res) => {
  res.json(await getGameState());
});

app.post('/api/pvp/bet', auth, async (req, res) => {
  const amount = Number(req.body.amount);
  if (!(amount >= 10 && amount <= 1000)) return res.json({ ok: false, error: 'bad_amount' });
  const { data: u } = await supabase.from('users')
    .select('balance_arc').eq('tg_id', req.user.tg_id).single();
  if (Number(u.balance_arc) < amount) return res.json({ ok: false, error: 'not_enough' });
  const result = await placeBet(req.user.tg_id, req.user.username, amount);
  res.json(result);
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

app.post('/api/leaderboard/pvp', auth, async (req, res) => {
  const { data: txs } = await supabase.from('transactions')
    .select('tg_id, amount').eq('type', 'pvp').eq('currency', 'ARC').lt('amount', 0);
  const totals = {};
  for (const t of txs || []) totals[t.tg_id] = (totals[t.tg_id] || 0) + Math.abs(Number(t.amount));
  const sorted = Object.entries(totals).map(([id, total]) => ({ tg_id: Number(id), total }))
    .sort((a, b) => b.total - a.total);
  const top50Ids = sorted.slice(0, 50).map(x => x.tg_id);
  let usernameMap = {};
  if (top50Ids.length) {
    const { data: us } = await supabase.from('users').select('tg_id, username').in('tg_id', top50Ids);
    (us || []).forEach(u => { usernameMap[u.tg_id] = u.username; });
  }
  const top = sorted.slice(0, 50).map((x, i) => ({
    rank: i + 1, username: usernameMap[x.tg_id] || '...', total: x.total,
  }));
  const myIdx = sorted.findIndex(x => x.tg_id === req.user.tg_id);
  const myRank = myIdx >= 0 ? { rank: myIdx + 1, total: sorted[myIdx].total } : null;
  res.json({ top, myRank });
});

app.post('/api/leaderboard/ads', auth, async (req, res) => {
  res.json({ top: [], myRank: null });
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
  if (!await getSetting('arc_usd')) await setSetting('arc_usd', '0.0003');
  if (!await getSetting('exchange_daily_limit_ton')) await setSetting('exchange_daily_limit_ton', '5');
  await updateTonPrice();
  setInterval(updateTonPrice, 10 * 60 * 1000);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ARCADE server running on :${PORT}`);
  startBot();
  initGameLoop();
  initDeposits();
  initSettings();
});
