import crypto from 'crypto';
import { supabase } from './db.js';
import { getSetting, setSetting } from './helpers.js';

const TICKET_PRICE = 750;
const MAX_PLAYERS = 5;
const PRO_DAYS = 7;
const SHOW_RESULT_MS = 6000;

let current = null;
let notifyFn = null;

export function setLotteryNotifier(fn) { notifyFn = fn; }

async function newRound() {
  const roundNo = Number(await getSetting('lottery_round_counter')) || 1;
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const seedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');
  const { data: round } = await supabase.from('lottery_rounds').insert({
    round_no: roundNo, status: 'open',
    server_seed: serverSeed, server_seed_hash: seedHash,
  }).select().single();
  current = { id: round.id, roundNo, status: 'open', tickets: [], seedHash, serverSeed };
}

async function drawRound() {
  if (!current || current.status !== 'open') return;
  current.status = 'spinning';
  await supabase.from('lottery_rounds').update({ status: 'spinning' }).eq('id', current.id);

  const h = crypto.createHmac('sha256', current.serverSeed)
    .update(String(current.id)).digest('hex');
  const roll = parseInt(h.slice(0, 13), 16) / Math.pow(2, 52);
  const winnerIndex = Math.floor(roll * MAX_PLAYERS);
  const winner = current.tickets[winnerIndex];

  await supabase.rpc('try_add_pro', { p_tg_id: winner.tg_id, p_days: PRO_DAYS });
  await supabase.from('transactions').insert({
    tg_id: winner.tg_id, type: 'lottery_win', currency: 'ARC', amount: 0,
    note: `lottery win round ${current.roundNo}`,
  });
  await supabase.from('lottery_rounds').update({
    status: 'done', winner_tg_id: winner.tg_id,
    result_index: winnerIndex, result_roll: roll,
    finished_at: new Date().toISOString(),
  }).eq('id', current.id);
  await setSetting('lottery_round_counter', current.roundNo + 1);

  current.status = 'done';
  current.winnerIndex = winnerIndex;
  current.winner = winner;
  current.roll = roll;

  if (notifyFn) {
    try { await notifyFn(current.tickets, winner, current.roundNo); } catch {}
  }

  setTimeout(newRound, SHOW_RESULT_MS);
}

export async function getLotteryState() {
  if (!current) await initLottery();
  return view();
}

export async function buyTicket(tgId, username, firstName) {
  if (!current) await initLottery();
  if (current.status !== 'open') return { ok: false, error: 'round_closed' };
  if (current.tickets.some(t => t.tg_id === tgId)) return { ok: false, error: 'already_in' };
  if (current.tickets.length >= MAX_PLAYERS) return { ok: false, error: 'full' };

  const { data: newBal, error: decErr } = await supabase.rpc('try_decrement_arc', {
    p_tg_id: tgId, p_amount: TICKET_PRICE,
  });
  if (decErr || newBal === null) return { ok: false, error: 'not_enough' };

  await supabase.from('transactions').insert({
    tg_id: tgId, type: 'lottery', currency: 'ARC', amount: -TICKET_PRICE,
    note: `lottery ticket round ${current.roundNo}`,
  });

  const { error: insErr } = await supabase.from('lottery_tickets').insert({
    round_id: current.id, tg_id: tgId, username, first_name: firstName,
  });
  if (insErr) {
    // Concurrent duplicate — refund
    await supabase.rpc('increment_arc', { p_tg_id: tgId, p_amount: TICKET_PRICE });
    return { ok: false, error: 'already_in' };
  }

  current.tickets.push({ tg_id: tgId, username, first_name: firstName });

  if (current.tickets.length >= MAX_PLAYERS) {
    setTimeout(drawRound, 0);
  }

  const { data: u } = await supabase.from('users').select('balance_arc').eq('tg_id', tgId).single();
  return { ok: true, balance_arc: Number(u.balance_arc), state: view() };
}

function view() {
  if (!current) return {
    status: 'open', roundNo: 0, tickets: [],
    maxPlayers: MAX_PLAYERS, ticketPrice: TICKET_PRICE, seedHash: null,
  };
  const showResult = current.status === 'spinning' || current.status === 'done';
  return {
    roundNo: current.roundNo,
    status: current.status,
    tickets: current.tickets,
    maxPlayers: MAX_PLAYERS,
    ticketPrice: TICKET_PRICE,
    seedHash: current.seedHash,
    winner: showResult ? current.winner : null,
    winnerIndex: showResult ? current.winnerIndex : null,
    roll: current.status === 'done' ? current.roll : null,
    serverSeed: current.status === 'done' ? current.serverSeed : null,
  };
}

export async function initLottery() {
  const { data: row } = await supabase.from('lottery_rounds')
    .select('id, round_no, status, server_seed, server_seed_hash')
    .in('status', ['open', 'spinning'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  if (row) {
    const { data: tickets } = await supabase.from('lottery_tickets')
      .select('tg_id, username, first_name').eq('round_id', row.id);
    current = {
      id: row.id, roundNo: row.round_no, status: 'open',
      tickets: tickets || [], seedHash: row.server_seed_hash, serverSeed: row.server_seed,
    };
    if ((tickets || []).length >= MAX_PLAYERS) {
      setTimeout(drawRound, 0);
    }
  } else {
    await newRound();
  }
}
