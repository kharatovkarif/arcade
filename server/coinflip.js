import { supabase } from './db.js';
import { changeArc } from './helpers.js';

const WIN_CHANCE = 1 / 3;
const PAYOUT_MULT = 1.92;
const FREE_STAKE = 10;
const FREE_COOLDOWN_MS = 10 * 60 * 1000;

function rollWin() {
  return Math.random() < WIN_CHANCE;
}

export async function flipPaid(tgId, side, amount) {
  const { data: afterStake, error } = await supabase.rpc('try_decrement_arc', {
    p_tg_id: tgId, p_amount: amount,
  });
  if (error || afterStake === null) return { ok: false, error: 'not_enough' };

  await supabase.from('transactions').insert({
    tg_id: tgId, type: 'coinflip', currency: 'ARC', amount: -amount, note: `flip ${side} bet`,
  });

  const win = rollWin();
  let balance = Number(afterStake);
  let payout = 0;
  if (win) {
    payout = Math.round(amount * PAYOUT_MULT);
    balance = await changeArc(tgId, payout, 'coinflip', `flip ${side} win`);
  }
  return { ok: true, win, side, amount, payout, balance_arc: balance };
}

export async function flipFreeStatus(tgId) {
  const { data: lastTx } = await supabase.from('transactions')
    .select('created_at').eq('tg_id', tgId).eq('type', 'coinflip_free')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!lastTx) return { available: true, msLeft: 0 };
  const elapsed = Date.now() - new Date(lastTx.created_at).getTime();
  const msLeft = Math.max(0, FREE_COOLDOWN_MS - elapsed);
  return { available: msLeft <= 0, msLeft };
}

export async function flipFree(tgId, side) {
  const status = await flipFreeStatus(tgId);
  if (!status.available) return { ok: false, error: 'cooldown', msLeft: status.msLeft };

  const win = rollWin();
  const payout = win ? Math.round(FREE_STAKE * PAYOUT_MULT) : 0;
  const balance = await changeArc(tgId, payout, 'coinflip_free', `free flip ${side} ${win ? 'win' : 'lose'}`);
  return { ok: true, win, side, amount: FREE_STAKE, payout, balance_arc: balance };
}
