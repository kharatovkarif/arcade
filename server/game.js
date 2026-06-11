import crypto from 'crypto';
import { supabase } from './db.js';
import { getSetting, setSetting, changeArc } from './helpers.js';

const COUNTDOWN = 15;
const SPIN_DURATION = 4;
const SHOW_RESULT = 3;
const COMMISSION = 0.10;
const MIN_BET = 10, MAX_BET = 1000;

// Special no-risk round: losers get refunds, winner gets pot -10% + bonus
const SPECIAL_ROUND_NO = 200;
const SPECIAL_COUNTDOWN = 15 * 60;
const SPECIAL_BONUS = 500;
const SPECIAL_MAX_PLAYERS = 150;

function isSpecial(roundNo) {
  return roundNo === SPECIAL_ROUND_NO;
}

let current = null;
let loopTimer = null;
let waitingStartedAt = null;

async function newRound() {
  const roundNo = Number(await getSetting('round_counter')) || 1;
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const seedHash = crypto.createHash('sha256').update(serverSeed).digest('hex');

  const { data: game } = await supabase.from('games').insert({
    round_no: roundNo,
    status: 'waiting',
    server_seed: serverSeed,
    server_seed_hash: seedHash,
  }).select().single();

  current = {
    gameId: game.id,
    roundNo,
    status: 'waiting',
    bets: [],
    pot: 0,
    countdownEnd: null,
    seedHash,
    serverSeed,
    winner: null,
  };
}

export async function placeBet(tgId, username, firstName, amount) {
  if (!current) await newRound();
  if (current.status === 'spinning' || current.status === 'done')
    return { ok: false, error: 'round_closed' };
  if (amount < MIN_BET || amount > MAX_BET)
    return { ok: false, error: 'bad_amount' };

  const special = isSpecial(current.roundNo);
  const existing = current.bets.find(b => b.tg_id === tgId);
  if (!existing && special && current.bets.length >= SPECIAL_MAX_PLAYERS)
    return { ok: false, error: 'max_players' };

  const { data: newBal, error: decErr } = await supabase.rpc('try_decrement_arc', {
    p_tg_id: tgId, p_amount: amount,
  });
  if (decErr || newBal === null) return { ok: false, error: 'not_enough' };
  await supabase.from('transactions').insert({
    tg_id: tgId, type: 'pvp', currency: 'ARC', amount: -amount,
    note: `bet round ${current.roundNo}`,
  });

  if (existing) existing.amount += amount;
  else current.bets.push({ tg_id: tgId, username, first_name: firstName, amount });
  current.pot += amount;
  if (current.status === 'waiting' && current.bets.length === 1) waitingStartedAt = Date.now();

  await supabase.from('game_bets').insert({
    game_id: current.gameId, tg_id: tgId, amount_arc: amount,
  });

  // Special round: 15-min countdown starts with the very first bet
  const enoughPlayers = special ? current.bets.length >= 1 : current.bets.length >= 2;
  if (enoughPlayers && current.status === 'waiting') {
    current.status = 'counting';
    current.countdownEnd = Date.now() + (special ? SPECIAL_COUNTDOWN : COUNTDOWN) * 1000;
    await supabase.from('games').update({ status: 'counting', pot_arc: current.pot }).eq('id', current.gameId);
  }

  return { ok: true, balance_arc: await balance(tgId), state: stateView() };
}

async function finishRound() {
  if (current.status !== 'counting') return;

  // Special round ended with a single player: refund and restart same round
  if (isSpecial(current.roundNo) && current.bets.length < 2) {
    const bet = current.bets[0];
    if (bet) await changeArc(bet.tg_id, bet.amount, 'pvp_refund', `refund round ${current.roundNo}`);
    await supabase.from('games').update({ status: 'done' }).eq('id', current.gameId);
    await newRound();
    return;
  }

  current.status = 'spinning';
  await supabase.from('games').update({ status: 'spinning' }).eq('id', current.gameId);

  const h = crypto.createHmac('sha256', current.serverSeed)
    .update(String(current.gameId)).digest('hex');
  const roll = parseInt(h.slice(0, 13), 16) / Math.pow(2, 52);

  let acc = 0;
  const target = roll * current.pot;
  let winner = current.bets[0];
  for (const b of current.bets) {
    acc += b.amount;
    if (target <= acc) { winner = b; break; }
  }

  const special = isSpecial(current.roundNo);
  const chance = (winner.amount / current.pot) * 100;
  const commission = current.pot * COMMISSION;
  const prize = (current.pot - commission) + (special ? SPECIAL_BONUS : 0);

  current.winner = {
    tg_id: winner.tg_id,
    username: winner.username,
    chance: chance.toFixed(2),
    prize: prize.toFixed(2),
    roll,
  };
  current.spinEndsAt = Date.now() + SPIN_DURATION * 1000;

  await changeArc(winner.tg_id, prize, 'pvp', `win round ${current.roundNo}${special ? ' (special +' + SPECIAL_BONUS + ')' : ''}`);

  // Special round: every loser gets their stake back
  if (special) {
    for (const b of current.bets) {
      if (b.tg_id === winner.tg_id) continue;
      await changeArc(b.tg_id, b.amount, 'pvp_refund', `special round ${current.roundNo} refund`);
    }
  }

  await supabase.from('games').update({
    status: 'spinning',
    pot_arc: current.pot,
    winner_tg_id: winner.tg_id,
    winner_chance: chance,
    commission_arc: commission,
    result_roll: roll,
    finished_at: new Date().toISOString(),
  }).eq('id', current.gameId);

  await setSetting('round_counter', current.roundNo + 1);
}

async function balance(tgId) {
  const { data } = await supabase.from('users').select('balance_arc').eq('tg_id', tgId).single();
  return Number(data.balance_arc);
}

function stateView() {
  if (!current) return { status: 'waiting', roundNo: 0, players: [], pot: 0 };
  const players = current.bets.map(b => ({
    tg_id: b.tg_id,
    username: b.username,
    first_name: b.first_name,
    amount: b.amount,
    chance: current.pot ? ((b.amount / current.pot) * 100).toFixed(2) : '0',
  }));
  let secondsLeft = null;
  if (current.status === 'counting' && current.countdownEnd) {
    secondsLeft = Math.max(0, Math.ceil((current.countdownEnd - Date.now()) / 1000));
  }
  const showWinner = current.status === 'done' || current.status === 'spinning';
  return {
    status: current.status,
    roundNo: current.roundNo,
    pot: current.pot,
    players,
    secondsLeft,
    seedHash: current.seedHash,
    winner: showWinner ? current.winner : null,
    serverSeed: current.status === 'done' ? current.serverSeed : null,
    special: isSpecial(current.roundNo) ? { bonus: SPECIAL_BONUS, maxPlayers: SPECIAL_MAX_PLAYERS } : null,
  };
}

export async function getGameState() {
  if (!current) await newRound();
  return stateView();
}

async function refundPendingGames() {
  const { data: games } = await supabase.from('games')
    .select('id, round_no').in('status', ['waiting', 'counting']);
  if (!games?.length) return;
  for (const game of games) {
    const { data: bets } = await supabase.from('game_bets')
      .select('tg_id, amount_arc').eq('game_id', game.id);
    if (bets?.length) {
      const totals = {};
      for (const b of bets) totals[b.tg_id] = (totals[b.tg_id] || 0) + Number(b.amount_arc);
      for (const [tgId, amount] of Object.entries(totals)) {
        await changeArc(Number(tgId), amount, 'pvp_refund', `refund round ${game.round_no}`);
      }
    }
    await supabase.from('games').update({ status: 'done' }).eq('id', game.id);
  }
}

export function initGameLoop() {
  refundPendingGames().then(() => newRound());
  loopTimer = setInterval(async () => {
    if (!current) return;

    // Refund lone player after 1 minute of waiting (normal rounds only —
    // special round runs its own 15-min countdown from the first bet)
    if (!isSpecial(current.roundNo) &&
        current.status === 'waiting' && current.bets.length === 1 &&
        waitingStartedAt && Date.now() - waitingStartedAt >= 60000) {
      const bet = current.bets[0];
      await changeArc(bet.tg_id, bet.amount, 'pvp_refund', `refund round ${current.roundNo}`);
      await supabase.from('games').update({ status: 'done' }).eq('id', current.gameId);
      waitingStartedAt = null;
      await newRound();
      return;
    }

    if (current.status === 'counting' && Date.now() >= current.countdownEnd) {
      await finishRound();
    }
    if (current.status === 'spinning' && current.spinEndsAt && Date.now() >= current.spinEndsAt) {
      current.status = 'done';
      await supabase.from('games').update({ status: 'done' }).eq('id', current.gameId);
      setTimeout(() => newRound(), SHOW_RESULT * 1000);
    }
  }, 1000);
}