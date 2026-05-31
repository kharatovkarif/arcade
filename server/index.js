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
import { startBot, botCheckMember } from '../bot/bot.js';
import { initGameLoop, getGameState, placeBet } from './game.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

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
  const { data: tasks } = await supabase.from('tasks')
    .select('*').eq('is_active', true).order('created_at', { ascending: false });
  const { data: done } = await supabase.from('task_completions')
    .select('task_id').eq('tg_id', req.user.tg_id);
  const doneIds = new Set((done || []).map(d => d.task_id));
  res.json((tasks || []).map(t => ({
    id: t.id, title_ru: t.title_ru, title_en: t.title_en,
    type: t.type, target: t.target, reward_arc: Number(t.reward_arc),
    completed: doneIds.has(t.id),
  })));
});

app.post('/api/tasks/check', auth, async (req, res) => {
  const taskId = req.body.task_id;
  const { data: task } = await supabase.from('tasks')
    .select('*').eq('id', taskId).eq('is_active', true).single();
  if (!task) return res.json({ ok: false, error: 'not_found' });
  const { data: c } = await supabase.from('task_completions')
    .select('id').eq('task_id', taskId).eq('tg_id', req.user.tg_id).single();
  if (c) return res.json({ ok: false, error: 'already_done' });
  if (task.limit_mode === 'count' && task.used_count >= task.limit_count)
    return res.json({ ok: false, error: 'limit_reached' });
  if (task.limit_mode === 'time' && task.expires_at && new Date(task.expires_at) < new Date())
    return res.json({ ok: false, error: 'expired' });
  if (task.type === 'subscribe' && task.target) {
    const ok = await botCheckMember(task.target, req.user.tg_id);
    if (!ok) return res.json({ ok: false, error: 'not_subscribed' });
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

function mskDate(offsetDays = 0) {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return msk.toISOString().slice(0, 10);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ARCADE server running on :${PORT}`);
  startBot();
  initGameLoop();
});
