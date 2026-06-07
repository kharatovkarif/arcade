import { supabase } from './db.js';
import { changeArc } from './helpers.js';
import { notifyUser } from '../bot/bot.js';

const APP_URL = process.env.APP_URL || '';

function daysDiff(from, to) {
  return Math.floor((to - from) / (24 * 60 * 60 * 1000));
}

function mskToday() {
  const now = new Date();
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function penaltyAppliedToday(lastPenaltyAt) {
  if (!lastPenaltyAt) return false;
  const d = new Date(new Date(lastPenaltyAt).getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return d === mskToday();
}

async function sendWithButton(tgId, text) {
  await notifyUser(tgId, text + (APP_URL ? `\n\n▶️ ${APP_URL}` : ''));
}

export async function runInactivityCheck() {
  const now = new Date();

  const { data: users } = await supabase
    .from('users')
    .select('tg_id, username, balance_arc, last_active_at, last_penalty_at')
    .gt('balance_arc', 0);

  if (!users?.length) return;

  for (const user of users) {
    const lastActive = user.last_active_at ? new Date(user.last_active_at) : now;
    const inactive = daysDiff(lastActive, now);

    if (inactive < 5) continue;
    if (penaltyAppliedToday(user.last_penalty_at)) continue;

    const bal = Number(user.balance_arc);
    if (bal <= 0) continue;

    if (inactive === 5) {
      await sendWithButton(user.tg_id,
        `⚠️ Вы не заходили в ARCADE 5 дней!\n\n` +
        `Осталось 2 дня — и 20% вашего баланса ARC сгорят.\n` +
        `Сейчас у вас: ${bal} ARC\n\n` +
        `Зайдите чтобы сохранить баланс 👇`
      );
    } else if (inactive === 6) {
      await sendWithButton(user.tg_id,
        `🚨 Последний день!\n\n` +
        `Вы не заходили 6 дней. Завтра сгорит 20% — ${Math.floor(bal * 0.20)} ARC.\n` +
        `Сейчас у вас: ${bal} ARC\n\n` +
        `Зайдите прямо сейчас 👇`
      );
    } else if (inactive === 7) {
      const penalty = Math.floor(bal * 0.20);
      if (penalty > 0) {
        await changeArc(user.tg_id, -penalty, 'inactivity', '7 days inactive -20%');
        await sendWithButton(user.tg_id,
          `😔 7 дней без активности.\n\n` +
          `Списано 20% — ${penalty} ARC сгорело.\n` +
          `Осталось: ${bal - penalty} ARC\n\n` +
          `Заходите каждый день чтобы не терять монеты 👇`
        );
      }
    } else {
      // day 8+: -5% each day
      const penalty = Math.floor(bal * 0.05);
      if (penalty > 0) {
        await changeArc(user.tg_id, -penalty, 'inactivity', `${inactive} days inactive -5%`);
        await sendWithButton(user.tg_id,
          `📉 Ещё один день без активности.\n\n` +
          `Списано 5% — ${penalty} ARC.\n` +
          `Осталось: ${bal - penalty} ARC\n\n` +
          `Зайдите чтобы остановить ежедневное списание 👇`
        );
      }
    }

    await supabase.from('users')
      .update({ last_penalty_at: now.toISOString() })
      .eq('tg_id', user.tg_id);
  }
}

export function initInactivityLoop() {
  setTimeout(runInactivityCheck, 10000);
  setInterval(runInactivityCheck, 60 * 60 * 1000); // every hour
}
