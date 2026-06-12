import { supabase } from './db.js';
import { sendAppMessage } from '../bot/bot.js';

// Daily comeback reminder: fires for users inactive for 24h–5d. From day 5 on,
// inactivity.js takes over with the balance-burn warnings, so the windows never overlap.

const TEXTS = {
  ru: (u) => `🎯 Твой ежедневный чек-ин ждёт!\n\nПропустишь день — серия сгорит и множитель вернётся к ×1.0.\nНа балансе: ${Math.floor(u.balance_arc)} ARC. Заходи и зарабатывай 👇`,
  en: (u) => `🎯 Your daily check-in is waiting!\n\nMiss a day and your streak resets to ×1.0.\nBalance: ${Math.floor(u.balance_arc)} ARC. Come back and earn 👇`,
  hi: (u) => `🎯 आपका दैनिक चेक-इन इंतज़ार कर रहा है!\n\nएक दिन छोड़ा तो स्ट्रीक ×1.0 पर रीसेट हो जाएगी।\nबैलेंस: ${Math.floor(u.balance_arc)} ARC। वापस आएं और कमाएं 👇`,
  pt: (u) => `🎯 Seu check-in diário está esperando!\n\nPerca um dia e sua sequência volta para ×1.0.\nSaldo: ${Math.floor(u.balance_arc)} ARC. Volte e ganhe 👇`,
  id: (u) => `🎯 Check-in harianmu menunggu!\n\nLewatkan satu hari dan streak-mu kembali ke ×1.0.\nSaldo: ${Math.floor(u.balance_arc)} ARC. Kembali dan hasilkan 👇`,
  bn: (u) => `🎯 আপনার দৈনিক চেক-ইন অপেক্ষা করছে!\n\nএকদিন মিস করলে স্ট্রিক ×1.0-এ রিসেট হবে।\nব্যালেন্স: ${Math.floor(u.balance_arc)} ARC। ফিরে আসুন এবং আয় করুন 👇`,
  vi: (u) => `🎯 Check-in hàng ngày của bạn đang chờ!\n\nBỏ lỡ một ngày là chuỗi của bạn về lại ×1.0.\nSố dư: ${Math.floor(u.balance_arc)} ARC. Quay lại và kiếm thêm 👇`,
};

// No real timezone in Telegram data — approximate by language so reminders
// land in waking hours (point 8: HI/BN shifted east, PT shifted west).
const TZ_OFFSET_H = { ru: 3, en: 3, hi: 5.5, bn: 6, pt: -3, id: 7, vi: 7 };

function localHour(lang) {
  const off = TZ_OFFSET_H[lang] ?? 3;
  return new Date(Date.now() + off * 3600 * 1000).getUTCHours();
}

export async function runReminderCheck() {
  const now = Date.now();
  const from = new Date(now - 5 * 86400 * 1000).toISOString();
  const to = new Date(now - 24 * 3600 * 1000).toISOString();
  const { data: users } = await supabase
    .from('users')
    .select('tg_id, language, balance_arc, last_reminder_at')
    .eq('bot_blocked', false).eq('is_banned', false)
    .gte('last_active_at', from).lte('last_active_at', to);
  if (!users?.length) return;

  for (const u of users) {
    if (u.last_reminder_at && now - new Date(u.last_reminder_at).getTime() < 20 * 3600 * 1000) continue;
    const h = localHour(u.language);
    if (h < 10 || h >= 20) continue;
    // Mark before sending so an overlapping run can't double-send
    await supabase.from('users')
      .update({ last_reminder_at: new Date().toISOString() })
      .eq('tg_id', u.tg_id);
    const make = TEXTS[u.language] || TEXTS.en;
    await sendAppMessage(u.tg_id, make(u), '🎯 Check-in');
    await new Promise(r => setTimeout(r, 50));
  }
}

export function initReminderLoop() {
  setTimeout(runReminderCheck, 20000);
  setInterval(runReminderCheck, 60 * 60 * 1000); // every hour
}
