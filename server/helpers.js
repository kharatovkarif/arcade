import { supabase } from './db.js';
import { sendWelcome } from '../bot/bot.js';

export async function getSetting(key) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).single();
  return data?.value ?? null;
}

export async function setSetting(key, value) {
  await supabase.from('settings').upsert({ key, value: String(value) });
}

export async function getOrCreateUser(tgUser, startParam) {
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('tg_id', tgUser.tg_id)
    .single();

  if (!user) {
    let referrerId = null;
    if (startParam && /^\d+$/.test(startParam)) {
      const refTgId = parseInt(startParam, 10);
      if (refTgId !== tgUser.tg_id) {
        const { data: ref } = await supabase
          .from('users').select('tg_id').eq('tg_id', refTgId).single();
        if (ref) referrerId = refTgId;
      }
    }

    const supported = ['ru', 'en', 'hi', 'pt', 'id', 'bn', 'vi'];
    const lang = supported.includes(tgUser.language_code) ? tgUser.language_code : 'en';
    const { data: created } = await supabase
      .from('users')
      .insert({
        tg_id: tgUser.tg_id,
        username: tgUser.username,
        first_name: tgUser.first_name,
        language: lang,
        referrer_id: referrerId,
        is_admin: tgUser.tg_id === Number(process.env.ADMIN_ID),
      })
      .select()
      .single();
    user = created;
    // Deep-link visitors never press /start, so greet them from the bot side now —
    // this opens the chat and makes future notifications deliverable.
    if (user) sendWelcome(user.tg_id);
  } else {
    await supabase
      .from('users')
      .update({
        username: tgUser.username,
        first_name: tgUser.first_name,
        last_seen: new Date().toISOString(),
        burn_warned: false,
      })
      .eq('tg_id', tgUser.tg_id);
  }
  return user;
}

export function checkinMultiplier(day) {
  const map = { 1: 1.0, 2: 1.1, 3: 1.2, 4: 1.3, 5: 1.4, 6: 1.5 };
  if (day >= 6) return 1.5;
  return map[day] || 1.0;
}

export function isPro(user) {
  return !!(user?.pro_until && new Date(user.pro_until) > new Date());
}

// Ad reward multiplier: PRO always gets max checkin ×1.5 plus +25% bonus
export function adMultiplier(user) {
  const base = isPro(user) ? 1.5 : checkinMultiplier(user?.checkin_day || 1);
  return isPro(user) ? base * 1.25 : base;
}

export async function changeArc(tgId, amount, type, note = '') {
  const { data, error } = await supabase.rpc('increment_arc', { p_tg_id: tgId, p_amount: Number(amount) });
  if (error) throw new Error(error.message);
  const newBal = Number(data);
  await supabase.from('transactions').insert({ tg_id: tgId, type, currency: 'ARC', amount, note });
  return newBal;
}

// Referral payouts from a reward: level 1 gets 20% (25% while PRO), level 2 gets 10%
export async function payReferrals(fromTgId, reward, referrerId) {
  if (!referrerId) return;
  const { data: ref } = await supabase.from('users')
    .select('referrer_id, pro_until').eq('tg_id', referrerId).single();
  if (!ref) return;
  const ref1Reward = Math.round(reward * (isPro(ref) ? 0.25 : 0.2));
  if (ref1Reward > 0) {
    await changeArc(referrerId, ref1Reward, 'referral', `from ${fromTgId}`);
    if (ref.referrer_id) {
      const ref2Reward = Math.round(reward * 0.1);
      if (ref2Reward > 0) await changeArc(ref.referrer_id, ref2Reward, 'referral', `from ${fromTgId}`);
    }
  }
}

export async function changeTon(tgId, amount, type, note = '', txHash = null) {
  const { data, error } = await supabase.rpc('increment_ton', { p_tg_id: tgId, p_amount: Number(amount) });
  if (error) throw new Error(error.message);
  const newBal = Number(data);
  await supabase.from('transactions').insert({ tg_id: tgId, type, currency: 'TON', amount, note, tx_hash: txHash });
  return newBal;
}