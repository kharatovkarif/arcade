import dotenv from 'dotenv';
import { supabase } from './db.js';
import { changeTon } from './helpers.js';
import { notifyAdmin } from '../bot/bot.js';
dotenv.config();

const API_KEY = process.env.TONCENTER_API_KEY;
const WALLET = process.env.PROJECT_WALLET;
const MIN_DEPOSIT = 0.1;
const MAX_DEPOSIT_DAY = 50;
const POLL_MS = 8000;

const API = 'https://toncenter.com/api/v2';

function todayMsk() {
  const msk = new Date(Date.now() + 3 * 3600 * 1000);
  return msk.toISOString().slice(0, 10);
}

async function fetchTransactions() {
  const url = `${API}/getTransactions?address=${encodeURIComponent(WALLET)}&limit=20&api_key=${API_KEY}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error('toncenter ' + res.status + ' ' + txt.slice(0, 120));
  }
  const data = await res.json();
  return data.result || [];
}

function parseComment(tx) {
  try {
    const msg = tx.in_msg;
    if (!msg) return null;
    if (msg.message != null && msg.message !== '') return String(msg.message).trim();
    return null;
  } catch { return null; }
}

async function processTx(tx) {
  const inMsg = tx.in_msg;
  if (!inMsg || !inMsg.source) return;
  const valueNano = Number(inMsg.value || 0);
  const amountTon = valueNano / 1e9;
  if (amountTon < MIN_DEPOSIT) return;

  const comment = parseComment(tx);
  if (!comment || !/^\d+$/.test(comment)) return;
  const tgId = Number(comment);

  const txHash = tx.transaction_id?.hash;
  if (!txHash) return;

  const { data: exists } = await supabase
    .from('transactions').select('id').eq('tx_hash', txHash).maybeSingle();
  if (exists) return;

  const { data: user } = await supabase
    .from('users').select('tg_id, username').eq('tg_id', tgId).maybeSingle();
  if (!user) return;

  const day = todayMsk();
  const { data: deps } = await supabase
    .from('transactions').select('amount')
    .eq('tg_id', tgId).eq('type', 'deposit').eq('currency', 'TON')
    .gte('created_at', day + 'T00:00:00');
  const usedToday = (deps || []).reduce((s, d) => s + Number(d.amount), 0);
  if (usedToday + amountTon > MAX_DEPOSIT_DAY) {
    await notifyAdmin(`⚠️ Депозит превысил дневной лимит\nОт: @${user.username || tgId} (${tgId})\nСумма: ${amountTon} TON\nУже за день: ${usedToday} TON\nTX: ${txHash}`);
    return;
  }

  const newBal = await changeTon(tgId, amountTon, 'deposit', `deposit from ${inMsg.source}`, txHash);

  await notifyAdmin(
    `💰 *Новый депозит*\n\n` +
    `От: @${user.username || 'нет'} (ID ${tgId})\n` +
    `Сумма: *${amountTon} TON*\n` +
    `Кошелёк: \`${inMsg.source}\`\n` +
    `Время: ${new Date().toLocaleString('ru-RU')}\n` +
    `Баланс юзера: ${newBal} TON`
  );
}

async function poll() {
  if (!API_KEY || !WALLET) return;
  try {
    const txs = await fetchTransactions();
    for (const tx of txs) {
      await processTx(tx).catch(e => console.log('processTx error:', e.message));
    }
  } catch (e) {
    console.log('deposit poll error:', e.message);
  }
}

export function initDeposits() {
  if (!API_KEY || !WALLET) {
    console.warn('Deposits disabled: missing TONCENTER_API_KEY or PROJECT_WALLET');
    return;
  }
  console.log('Deposit watcher started');
  setInterval(poll, POLL_MS);
}
