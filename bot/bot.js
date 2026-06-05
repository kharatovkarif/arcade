import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { supabase } from '../server/db.js';
dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const APP_URL = process.env.APP_URL;

let bot = null;
const pendingWithdrawals = new Map();

export function startBot() {
  if (!TOKEN) { console.warn('BOT_TOKEN not set'); return; }
  bot = new TelegramBot(TOKEN, { polling: true });
  bot.on('polling_error', (e) => console.log('polling_error:', e.message));
  console.log('Bot started');

  bot.onText(/\/start/, (msg) => {
    const text =
      '🎮 *Welcome to ARCADE*\n\n' +
      'The ultimate PvP gaming platform on TON.\n\n' +
      '⚔️ Battle players in real-time PvP roulette\n' +
      '🪙 Earn ARC by watching ads & completing tasks\n' +
      '👥 Invite friends and earn from referrals\n' +
      '💎 Deposit & withdraw TON\n\n' +
      'Tap the button below to start playing 👇';
    bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '▶️ Launch ARCADE', web_app: { url: APP_URL } }],
          [
            { text: '📢 Channel', url: 'https://t.me/arcare_ton' },
            { text: '💬 Support', url: 'https://t.me/Ventlp' },
          ],
        ],
      },
    }).catch(e => console.log('send error:', e.message));
  });

  bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id,
      '🛠 Admin\n\n' +
      '/promo_add CODE REWARD MODE [num]  (modes: global|count|time)\n' +
      '/promo_del CODE\n' +
      '/task_add subscribe @chan 50 | RU | EN\n' +
      '/task_del ID\n' +
      '/stats'
    ).catch(() => {});
  });

  bot.onText(/\/promo_add (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const [code, reward, mode, count] = m[1].trim().split(/\s+/);
    if (!code || !reward) return bot.sendMessage(msg.chat.id, '❌ /promo_add CODE REWARD MODE [num]').catch(()=>{});
    const { error } = await supabase.from('promocodes').insert({
      code, reward_arc: Number(reward), limit_mode: mode || 'global',
      limit_count: count ? Number(count) : null, is_active: true,
    });
    bot.sendMessage(msg.chat.id, error ? `❌ ${error.message}` : `✅ Promo ${code} created (+${reward} ARC)`).catch(()=>{});
  });

  bot.onText(/\/promo_del (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    await supabase.from('promocodes').update({ is_active: false }).eq('code', m[1].trim());
    bot.sendMessage(msg.chat.id, `🗑 Promo ${m[1].trim()} disabled`).catch(()=>{});
  });

  bot.onText(/\/task_add (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const [head, ru, en] = m[1].split('|').map(s => s.trim());
    const [type, target, reward] = head.split(/\s+/);
    if (!type || !reward) return bot.sendMessage(msg.chat.id, '❌ /task_add subscribe @chan 50 | RU | EN').catch(()=>{});
    const { error } = await supabase.from('tasks').insert({
      type, target: target && target.startsWith('@') ? target : null,
      reward_arc: Number(reward), title_ru: ru || 'Task', title_en: en || 'Task', is_active: true,
    });
    bot.sendMessage(msg.chat.id, error ? `❌ ${error.message}` : `✅ Task created (+${reward} ARC)`).catch(()=>{});
  });

  bot.onText(/\/task_del (\d+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    await supabase.from('tasks').update({ is_active: false }).eq('id', Number(m[1]));
    bot.sendMessage(msg.chat.id, `🗑 Task ${m[1]} disabled`).catch(()=>{});
  });

  bot.onText(/\/stats/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    bot.sendMessage(msg.chat.id, `📊 Users: ${count}`).catch(()=>{});
  });

  bot.on('callback_query', async (q) => {
    const d = q.data || '';
    if (!d.startsWith('wd_ok:')) return;
    await bot.answerCallbackQuery(q.id).catch(() => {});
    const parts = d.split(':');
    const tgId = Number(parts[1]);
    const amount = Number(parts[2]);
    const pending = pendingWithdrawals.get(tgId);
    const wallet = pending?.wallet;
    pendingWithdrawals.delete(tgId);
    try {
      await bot.editMessageText(
        q.message.text + '\n\n✅ ПОДТВЕРЖДЕНО',
        { chat_id: q.message.chat.id, message_id: q.message.message_id }
      );
    } catch {}
    try { await bot.sendMessage(tgId, `✅ Ваш вывод ${amount} TON подтверждён!\n\nTON будет отправлен на ваш кошелёк в ближайшее время.`); } catch {}
    if (wallet) {
      const nanotons = Math.round(amount * 1e9);
      await bot.sendMessage(ADMIN_ID, `💸 Отправьте ${amount} TON:\nhttps://app.tonkeeper.com/transfer/${wallet}?amount=${nanotons}`).catch(() => {});
    } else {
      await bot.sendMessage(ADMIN_ID, `⚠️ Кошелёк для вывода не найден (ID: ${tgId})`).catch(() => {});
    }
  });
}

export async function botCheckMember(channel, tgId) {
  if (!bot) return false;
  try {
    const member = await bot.getChatMember(channel, tgId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

export async function notifyAdmin(text) {
  if (!bot || !ADMIN_ID) return;
  try { await bot.sendMessage(ADMIN_ID, text); } catch {}
}

export async function notifyUser(tgId, text) {
  if (!bot) return;
  try { await bot.sendMessage(tgId, text); } catch {}
}

export async function notifyAdminWithdraw(tgId, username, amount, wallet, newBal, datetime) {
  if (!bot || !ADMIN_ID) return;
  pendingWithdrawals.set(tgId, { amount, wallet });
  try {
    await bot.sendMessage(ADMIN_ID,
      `💸 Новый вывод\n\n` +
      `👤 @${username || 'нет'} (ID: ${tgId})\n` +
      `💎 Сумма: ${amount} TON\n` +
      `💼 Кошелёк: ${wallet}\n` +
      `📊 Баланс после: ${newBal} TON\n` +
      `🕐 ${datetime}`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Подтвердить вывод', callback_data: `wd_ok:${tgId}:${amount}` }
          ]]
        }
      }
    );
  } catch {}
}