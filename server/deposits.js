import dotenv from 'dotenv';
import { supabase } from './db.js';
import { changeTon } from './helpers.js';
import { notifyAdmin } from '../bot/bot.js';
dotenv.config();

const WALLET = process.env.PROJECT_WALLET;
const MIN_DEPOSIT = 0.1;
const MAX_DEPOSIT_DAY = 50;
const POLL_MS = 8000;

const API = 'https://tonapi.io/v2';

function todayMsk() {
  const msk = new Date(Date.now() + 3 * 3600 * 1000);
  return msk.toISOString().slice(0, 10);
}

async function fetchEvents() {
  const url = `${API}/accounts/${encodeURIComponent(WALLET)}/events?limit=20`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('tonapi ' + res.status + ' ' + txt.slice(0, 120));
  }
  const data = await res.json();
  return data.events || [];
}

async function processEvent(ev) {
  const eventId = ev.event_id;
  if (!eventId) return;
  // Пропускаем незавершённые события — иначе tonapi пришлёт его повторно
  // с другим event_id и депозит зачислится дважды
  if (ev.in_progress) return;

  for (const act of (ev.actions || [])) {
    if (act.type !== 'TonTransfer') continue;
    const ton = act.TonTransfer;
    if (!ton) continue;
    if (!ton.recipient || ton.recipient.address == null) continue;

    const amountTon = Number(ton.amount || 0) / 1e9;
    if (amountTon < MIN_DEPOSIT) continue;

    const comment = (ton.comment || '').trim();
    if (!comment || !/^\d+$/.test(comment)) continue;
    const tgId = Number(comment);

    const txHash = eventId;
    const { data: exists } = await supabase
      .from('transactions').select('id').eq('tx_hash', txHash).maybeSingle();
    if (exists) continue;

    const { data: user } = await supabase
      .from('users').select('tg_id, username, wallet').eq('tg_id', tgId).maybeSingle();
    if (!user) continue;

    const day = todayMsk();
    const { data: deps } = await supabase
      .from('transactions').select('amount')
      .eq('tg_id', tgId).eq('type', 'deposit').eq('currency', 'TON')
      .gte('created_at', day + 'T00:00:00');
    const usedToday = (deps || []).reduce((s, d) => s + Number(d.amount), 0);
    if (usedToday + amountTon > MAX_DEPOSIT_DAY) {
      await notifyAdmin(`Депозит превысил лимит\nОт: @${user.username || tgId} (${tgId})\nСумма: ${amountTon} TON\nЗа день: ${usedToday} TON`);
      continue;
    }

    const senderAddr = ton.sender?.address || 'unknown';
    const newBal = await changeTon(tgId, amountTon, 'deposit', `deposit from ${senderAddr}`, txHash);

    const walletShown = user.wallet || senderAddr;
    const now = new Date(Date.now() + 3 * 3600 * 1000);
    const datetime = now.toISOString().replace('T', ' ').slice(0, 19) + ' МСК';
    await notifyAdmin(
      `💰 Новый депозит\n\n` +
      `👤 @${user.username || 'нет'} (ID: ${tgId})\n` +
      `💎 Сумма: ${amountTon} TON\n` +
      `💼 Кошелёк: ${walletShown}\n` +
      `📊 Баланс TON: ${newBal}\n` +
      `🕐 ${datetime}`
    );
  }
}

async function poll() {
  if (!WALLET) return;
  try {
    const events = await fetchEvents();
    for (const ev of events) {
      await processEvent(ev).catch(e => console.log('processEvent error:', e.message));
    }
  } catch (e) {
    console.log('deposit poll error:', e.message);
  }
}

export function initDeposits() {
  if (!WALLET) {
    console.warn('Deposits disabled: missing PROJECT_WALLET');
    return;
  }
  console.log('Deposit watcher started V2 tonapi');
  setInterval(poll, POLL_MS);
  }
