import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { supabase } from '../server/db.js';
dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const APP_URL = process.env.APP_URL;

let bot = null;

export function startBot() {
  if (!TOKEN) { console.warn('BOT_TOKEN не задан — бот не запущен'); return; }
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log('Telegram бот запущен');

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
    });
  });

  bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id,
      '🛠 Админ-панель\n\n' +
      'ПРОМОКОДЫ:\n' +
      '/promo_add КОД НАГРАДА РЕЖИМ [число]\n' +
      '  режимы: global | count | time\n' +
      '  пример: /promo_add JANI 80 count 500\n' +
      '  пример: /promo_add GIM60 80 global\n' +
      '/promo_del КОД\n\n' +
      'ЗАДАНИЯ:\n' +
      '/task_add subscribe @канал НАГРАДА | Текст RU | Текст EN\n' +
      '  пример: /task_add subscribe @mychan 50 | Подпишись | Subscribe\n' +
      '/task_del ID\n\n' +
      '/stats — статистика'
    );
  });

  bot.onText(/\/promo_add (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const parts = m[1].trim().split(/\s+/);
    const [code, reward, mode, count] = parts;
    if (!code || !reward) return bot.sendMessage(msg.chat.id, '❌ Формат: /promo_add КОД НАГРАДА РЕЖИМ [число]');
    const row = {
      code, reward_arc: Number(reward),
      limit_mode: mode || 'global',
      limit_count: count ? Number(count) : null,
      is_active: true,
    };
    const { error } = await supabase.from('promocodes').insert(row);
    bot.sendMessage(msg.chat.id, error ? `❌ ${error.message}` : `✅ Промокод ${code} создан (+${reward} ARC)`);
  });

  bot.onText(/\/promo_del (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const code = m[1].trim();
    await supabase.from('promocodes').update({ is_active: false }).eq('code', code);
    bot.sendMessage(msg.chat.id, `🗑 Промокод ${code} отключён`);
  });

  bot.onText(/\/task_add (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const [head, ru, en] = m[1].split('|').map(s => s.trim());
    const parts = head.split(/\s+/);
    const [type, target, reward] = parts;
    if (!type || !reward) return bot.sendMessage(msg.chat.id, '❌ Формат: /task_add subscribe @chan 50 | RU | EN');
    const { error } = await supabase.from('tasks').insert({
      type,
      target: target && target.startsWith('@') ? target : null,
      reward_arc: Number(reward),
      title_ru: ru || 'Задание',
      title_en: en || 'Task',
      is_active: true,
    });
    bot.sendMessage(msg.chat.id, error ? `❌ ${error.message}` : `✅ Задание создано (+${reward} ARC)`);
  });

  bot.onText(/\/task_del (\d+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    await supabase.from('tasks').update({ is_active: false }).eq('id', Number(m[1]));
    bot.sendMessage(msg.chat.id, `🗑 Задание ${m[1]} отключено`);
  });

  bot.onText(/\/stats/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const { count: users } = await supabase.from('users').select('*', { count: 'exact', head: true });
    bot.sendMessage(msg.chat.id, `📊 Пользователей: ${users}`);
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