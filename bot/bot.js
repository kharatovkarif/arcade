import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { supabase } from '../server/db.js';
dotenv.config();

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const APP_URL = process.env.APP_URL;

let bot = null;
const pendingWithdrawals = new Map();

const WELCOME_TEXT =
  '🎮 *Welcome to ARCADE*\n\n' +
  'The ultimate PvP gaming platform on TON.\n\n' +
  '⚔️ Battle players in real-time PvP roulette\n' +
  '🪙 Earn ARC by watching ads & completing tasks\n' +
  '👥 Invite friends and earn from referrals\n' +
  '💎 Deposit & withdraw TON\n\n' +
  'Tap the button below to start playing 👇';

const WELCOME_KEYBOARD = () => ({
  inline_keyboard: [
    [{ text: '▶️ Launch ARCADE', web_app: { url: APP_URL } }],
    [
      { text: '📢 Channel', url: 'https://t.me/arcare_ton' },
      { text: '💬 Support', url: 'https://t.me/Ventlp' },
    ],
  ],
});

// Telegram rejects messages to users who blocked the bot or never opened a chat
// with it — remember that so notification loops skip them instead of retrying.
function isPermanentSendError(e) {
  const m = (e?.message || '').toLowerCase();
  return m.includes('blocked') || m.includes('chat not found') || m.includes('deactivated');
}

async function markBotBlocked(tgId) {
  await supabase.from('users').update({ bot_blocked: true }).eq('tg_id', tgId).then(() => {}, () => {});
}

export function startBot() {
  if (!TOKEN) { console.warn('BOT_TOKEN not set'); return; }
  bot = new TelegramBot(TOKEN, { polling: true });
  bot.on('polling_error', (e) => console.log('polling_error:', e.message));
  console.log('Bot started');




  bot.onText(/\/start/, (msg) => {
    // The user reached the bot directly — they're definitely messageable again
    supabase.from('users').update({ bot_blocked: false }).eq('tg_id', msg.chat.id).then(() => {}, () => {});
    bot.sendMessage(msg.chat.id, WELCOME_TEXT, {
      parse_mode: 'Markdown',
      reply_markup: WELCOME_KEYBOARD(),
    }).catch(e => console.log('send error:', e.message));
  });

  // Tells which build is actually running on Railway
  bot.onText(/\/version/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id, 'build: notify-v1').catch(() => {});
  });

  bot.onText(/\/admin/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id,
      '🛠 Admin\n\n' +
      '/promo_add CODE REWARD MODE [num]  (modes: global|count|time)\n' +
      '/promo_del CODE\n' +
      '/task_add subscribe @chan 50 | RU | EN\n' +
      '/task_add partner subscribe @chan 50 | RU | EN\n' +
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

  bot.onText(/\/promo_keep (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const keep = m[1].trim().toUpperCase();
    const { data } = await supabase.from('promocodes').select('code').eq('is_active', true);
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Нет активных промокодов').catch(()=>{});
    const toDelete = data.filter(p => p.code.toUpperCase() !== keep);
    for (const p of toDelete) {
      await supabase.from('promocodes').update({ is_active: false }).eq('code', p.code);
    }
    bot.sendMessage(msg.chat.id, `✅ Оставлен только ${keep}\n🗑 Удалено: ${toDelete.length} промокодов`).catch(()=>{});
  });

  bot.onText(/\/task_add (.+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const [head, ru, en] = m[1].split('|').map(s => s.trim());
    const parts = head.split(/\s+/);
    let is_partner = false, type, target, reward;
    if (parts[0] === 'partner') { is_partner = true; [, type, target, reward] = parts; }
    else { [type, target, reward] = parts; }
    if (!type || !reward) return bot.sendMessage(msg.chat.id, '❌ /task_add [partner] subscribe @chan 50 | RU | EN').catch(()=>{});
    const { error } = await supabase.from('tasks').insert({
      type, target: target && target.startsWith('@') ? target : null,
      reward_arc: Number(reward), title_ru: ru || 'Task', title_en: en || 'Task', is_active: true, is_partner,
    });
    bot.sendMessage(msg.chat.id, error ? `❌ ${error.message}` : `✅ Task created (+${reward} ARC)${is_partner ? ' [partner]' : ''}`).catch(()=>{});
  });

  bot.onText(/\/task_del (\d+)/, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    await supabase.from('tasks').update({ is_active: false }).eq('id', Number(m[1]));
    bot.sendMessage(msg.chat.id, `🗑 Task ${m[1]} disabled`).catch(()=>{});
  });

  bot.onText(/\/stats/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const now = new Date();
    const d1 = new Date(now - 86400e3).toISOString();
    const d7 = new Date(now - 7 * 86400e3).toISOString();
    const todayStart = new Date(now); todayStart.setUTCHours(0,0,0,0);

    const [
      { count: total },
      { count: new24h },
      { count: active24h },
      { count: active7d },
      { count: pro },
      { count: blocked },
      { data: balSums },
      { data: txToday },
      { data: pvpToday },
      { data: langBreak },
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', d1),
      supabase.from('users').select('*', { count: 'exact', head: true }).gte('last_active_at', d1),
      supabase.from('users').select('*', { count: 'exact', head: true }).gte('last_active_at', d7),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('is_pro', true),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('bot_blocked', true),
      supabase.from('users').select('balance_arc.sum()'),
      supabase.from('transactions').select('type, amount').gte('created_at', todayStart.toISOString()),
      supabase.from('games').select('pot_arc, commission_arc').gte('created_at', todayStart.toISOString()).eq('status', 'done'),
      supabase.from('users').select('language'),
    ]);

    const totalArc = Math.floor(balSums?.[0]?.sum ?? 0);

    let adArc = 0, adCount = 0, checkinArc = 0, promoArc = 0, refArc = 0;
    for (const tx of txToday || []) {
      const a = Number(tx.amount);
      if (tx.type === 'ad_short' || tx.type === 'ad4') { if (a > 0) { adArc += a; adCount++; } }
      else if (tx.type === 'checkin' && a > 0) checkinArc += a;
      else if (tx.type === 'promo' && a > 0) promoArc += a;
      else if (tx.type === 'referral' && a > 0) refArc += a;
    }

    let pvpCommission = 0, pvpRounds = 0;
    for (const g of pvpToday || []) {
      if (g.commission_arc) pvpCommission += Number(g.commission_arc);
      pvpRounds++;
    }

    const langs = {};
    for (const u of langBreak || []) langs[u.language || 'en'] = (langs[u.language || 'en'] || 0) + 1;
    const langLine = Object.entries(langs).sort((a,b)=>b[1]-a[1]).map(([l,c])=>`${l}:${c}`).join(' ');

    const lines = [
      `📊 *ARCADE Stats*`,
      ``,
      `👥 *Пользователи*`,
      `Всего: ${total} | Новых 24ч: +${new24h}`,
      `Активны 24ч: ${active24h} | 7д: ${active7d}`,
      `PRO: ${pro} | Заблокировали бота: ${blocked}`,
      ``,
      `🌐 *Языки*`,
      langLine,
      ``,
      `💰 *ARC в системе:* ${totalArc.toLocaleString()}`,
      ``,
      `📈 *Сегодня*`,
      `Реклама: +${Math.floor(adArc)} ARC (${adCount} просм.)`,
      `Чек-ин: +${Math.floor(checkinArc)} ARC`,
      `Промокоды: +${Math.floor(promoArc)} ARC`,
      `Рефералы: +${Math.floor(refArc)} ARC`,
      `PvP раунды: ${pvpRounds} | Комиссия: ${Math.floor(pvpCommission)} ARC`,
    ];
    bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' }).catch(()=>{});
  });

  bot.onText(/\/msg (\d+) (.+)/s, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const tgId = Number(m[1]);
    const text = m[2].replace(/\\n/g, '\n');
    try {
      await bot.sendMessage(tgId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '▶️ Открыть ARCADE', web_app: { url: APP_URL } }]] }
      });
      bot.sendMessage(msg.chat.id, `✅ Сообщение отправлено`).catch(()=>{});
    } catch(e) {
      bot.sendMessage(msg.chat.id, `❌ Ошибка: ${e.message}`).catch(()=>{});
    }
  });

  bot.onText(/\/broadcast (.+)/s, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const raw = m[1];
    const sepIdx = raw.indexOf('|||');
    const text = (sepIdx !== -1 ? raw.slice(0, sepIdx) : raw).replace(/\\n/g, '\n').trim();
    const postUrl = sepIdx !== -1 ? raw.slice(sepIdx + 3).trim() : 'https://t.me/arcare_ton';
    const { data: users } = await supabase.from('users').select('tg_id');
    if (!users?.length) return bot.sendMessage(msg.chat.id, '❌ No users').catch(()=>{});
    let ok = 0, fail = 0;
    for (const u of users) {
      try {
        await bot.sendMessage(u.tg_id, text, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '▶️ Играть в ARCADE', web_app: { url: APP_URL } }],
              [{ text: '📢 Смотреть пост', url: postUrl }],
            ],
          },
        });
        ok++;
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 50));
    }
    bot.sendMessage(msg.chat.id, `✅ Отправлено: ${ok}\n❌ Ошибок: ${fail}`).catch(()=>{});
  });

  bot.onText(/\/broadcast$/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id,
      'Используй: /broadcast текст\n\nПеренос строки: \\n\n\nПример:\n/broadcast 👀 @D1r2u1g уже набрал 303 ARC...\\n\\nДо победного приза — 0.5 TON — осталось всего 197 ARC.'
    ).catch(()=>{});
  });

  // Localized broadcast: sends each user a message in their own language.
  // Format: /lbroadcast ru:текст|en:text|hi:टेक्स्ट|pt:texto|id:teks|bn:টেক্সট|vi:văn bản
  // Language sections separated by |, each starting with "lang:".
  // Missing languages fall back to "en". Newlines: \n
  bot.onText(/\/lbroadcast (.+)/s, async (msg, m) => {
    if (msg.from.id !== ADMIN_ID) return;
    const raw = m[1];
    const texts = {};
    for (const part of raw.split('|')) {
      const colon = part.indexOf(':');
      if (colon === -1) continue;
      const lang = part.slice(0, colon).trim();
      const text = part.slice(colon + 1).replace(/\\n/g, '\n').trim();
      texts[lang] = text;
    }
    if (!texts.en && !texts.ru) {
      return bot.sendMessage(msg.chat.id,
        '❌ Нужен хотя бы один язык.\nФормат: /lbroadcast ru:текст|||en:text|||hi:...'
      ).catch(()=>{});
    }
    const fallback = texts.en || texts.ru;
    const { data: users } = await supabase.from('users').select('tg_id, language')
      .eq('bot_blocked', false).eq('is_banned', false);
    if (!users?.length) return bot.sendMessage(msg.chat.id, '❌ No users').catch(()=>{});
    let ok = 0, fail = 0;
    for (const u of users) {
      const text = texts[u.language] || fallback;
      try {
        await bot.sendMessage(u.tg_id, text, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '▶️ Open ARCADE', web_app: { url: APP_URL } }]] },
        });
        ok++;
      } catch (e) {
        fail++;
        if (e?.response?.statusCode === 403) {
          supabase.from('users').update({ bot_blocked: true }).eq('tg_id', u.tg_id).then(()=>{});
        }
      }
      await new Promise(r => setTimeout(r, 50));
    }
    bot.sendMessage(msg.chat.id, `✅ Отправлено: ${ok}\n❌ Ошибок: ${fail}`).catch(()=>{});
  });

  bot.onText(/\/lbroadcast$/, (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    bot.sendMessage(msg.chat.id,
      '*Локализованная рассылка*\n\n' +
      'Формат:\n`/lbroadcast ru:текст|en:text|hi:...|pt:...|id:...|bn:...|vi:...`\n\n' +
      'Разделитель языков: `|`\n' +
      'Перенос строки: `\\n`\n' +
      'Если язык не указан — используется en (или ru как запасной)\n\n' +
      'Пример:\n`/lbroadcast ru:🎰 Теперь есть лотерея!|en:🎰 Lottery is live!`',
      { parse_mode: 'Markdown' }
    ).catch(()=>{});
  });

  // Photo broadcast: admin sends a photo with caption starting with /photocast.
  // Format: /photocast text ;;; postUrl ;;; buttonText ;;; appQuery
  // (";;;" — Telegram auto-converts "||" pairs into spoiler markup, so pipes can't be used)
  // appQuery is appended to the Mini App URL (e.g. "pro=1" opens the PRO purchase modal).
  bot.on('message', async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    if (!msg.photo) return;
    const caption = msg.caption || '';
    if (!caption.startsWith('/photocast')) return;
    const raw = caption.slice('/photocast'.length).trim();
    const parts = raw.split(/\|\|\||;;;/).map(s => s.trim());
    const text = (parts[0] || '').replace(/\\n/g, '\n');
    const postUrl = parts[1] || 'https://t.me/arcare_ton';
    const btnText = parts[2] || '▶️ Играть в ARCADE';
    const appUrl = parts[3] ? `${APP_URL}?${parts[3]}` : APP_URL;
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const { data: users } = await supabase.from('users').select('tg_id');
    if (!users?.length) return bot.sendMessage(msg.chat.id, '❌ No users').catch(() => {});
    let ok = 0, fail = 0, firstErr = null;
    for (const u of users) {
      try {
        await bot.sendPhoto(u.tg_id, fileId, {
          caption: text,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: btnText, web_app: { url: appUrl } }],
              [{ text: '📢 Смотреть пост', url: postUrl }],
            ],
          },
        });
        ok++;
      } catch (e) {
        fail++;
        if (!firstErr) firstErr = e.message;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    bot.sendMessage(msg.chat.id,
      `✅ Отправлено: ${ok}\n❌ Ошибок: ${fail}${firstErr ? `\n\nПервая ошибка:\n${firstErr}` : ''}`
    ).catch(() => {});
  });

  bot.onText(/\/promo_list/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const { data } = await supabase.from('promocodes').select('*').eq('is_active', true).order('created_at', { ascending: false });
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Нет активных промокодов').catch(()=>{});
    const text = data.map(p => {
      const limit = p.limit_mode === 'count' ? ` | лимит: ${p.used_count}/${p.limit_count}` : p.limit_mode === 'time' ? ` | до: ${p.expires_at?.slice(0,10)}` : ' | глобальный';
      return `🎟 ${p.code} — +${p.reward_arc} ARC${limit}`;
    }).join('\n');
    bot.sendMessage(msg.chat.id, `📋 Активные промокоды:\n\n${text}`).catch(()=>{});
  });

  bot.onText(/\/task_list/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;
    const { data } = await supabase.from('tasks').select('*').eq('is_active', true).order('created_at', { ascending: false });
    if (!data?.length) return bot.sendMessage(msg.chat.id, 'Нет активных заданий').catch(()=>{});
    const text = data.map(t => {
      const limit = t.limit_mode === 'count' ? ` | ${t.used_count}/${t.limit_count} исп.` : t.limit_mode === 'time' ? ` | до ${t.expires_at?.slice(0,10)}` : t.limit_mode === 'daily' ? ' | ежедневное' : '';
      return `[${t.id}] ${t.type}${t.target ? ' ' + t.target : ''} — +${t.reward_arc} ARC${limit}\n  RU: ${t.title_ru} | EN: ${t.title_en}`;
    }).join('\n\n');
    bot.sendMessage(msg.chat.id, `📋 Активные задания:\n\n${text}`).catch(()=>{});
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

// Fetches the user's current Telegram profile photo as raw bytes via the bot.
// This works for every launch context (unlike WebApp initData photo_url, which is
// usually empty). Returns the largest available size, or null if the user has none.
export async function getUserPhotoBuffer(tgId) {
  if (!bot) return null;
  try {
    const photos = await bot.getUserProfilePhotos(tgId, { limit: 1 });
    if (!photos?.total_count) return null;
    const sizes = photos.photos[0];
    const fileId = sizes[sizes.length - 1].file_id; // last = highest resolution
    const link = await bot.getFileLink(fileId);     // contains bot token — keep server-side
    const res = await fetch(link);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
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
  try { await bot.sendMessage(tgId, text); }
  catch (e) { if (isPermanentSendError(e)) await markBotBlocked(tgId); }
}

// Sends a message with an "open the app" button; returns false when undeliverable.
export async function sendAppMessage(tgId, text, btnText = '▶️ ARCADE') {
  if (!bot) return false;
  try {
    await bot.sendMessage(tgId, text, {
      reply_markup: { inline_keyboard: [[{ text: btnText, web_app: { url: APP_URL } }]] },
    });
    return true;
  } catch (e) {
    if (isPermanentSendError(e)) await markBotBlocked(tgId);
    return false;
  }
}

// The same greeting as /start, sent automatically the first time a user opens
// the Mini App — deep-link visitors never press /start, and without this first
// message the bot can't notify them at all.
export async function sendWelcome(tgId) {
  if (!bot) return;
  try {
    await bot.sendMessage(tgId, WELCOME_TEXT, {
      parse_mode: 'Markdown',
      reply_markup: WELCOME_KEYBOARD(),
    });
  } catch (e) {
    if (isPermanentSendError(e)) await markBotBlocked(tgId);
  }
}

const PVP_NOTIFY_TEXTS = {
  ru: (n, pot) => `⚔️ PvP раунд #${n} начался!\n\nБанк: ${pot} ARC — успей сделать ставку!`,
  en: (n, pot) => `⚔️ PvP round #${n} has started!\n\nPot: ${pot} ARC — place your bet now!`,
  hi: (n, pot) => `⚔️ PvP राउंड #${n} शुरू हो गया है!\n\nपॉट: ${pot} ARC — अभी अपनी बेट लगाएं!`,
  pt: (n, pot) => `⚔️ A rodada PvP #${n} começou!\n\nPote: ${pot} ARC — faça sua aposta agora!`,
  id: (n, pot) => `⚔️ Ronde PvP #${n} telah dimulai!\n\nPot: ${pot} ARC — pasang taruhanmu sekarang!`,
  bn: (n, pot) => `⚔️ PvP রাউন্ড #${n} শুরু হয়েছে!\n\nপট: ${pot} ARC — এখনই বাজি ধরুন!`,
  vi: (n, pot) => `⚔️ Vòng PvP #${n} đã bắt đầu!\n\nQuỹ: ${pot} ARC — đặt cược ngay!`,
};

// Tells recently active users that a PvP round is live. Per-user throttle:
// at most one such ping every 24 hours, so it never feels like spam.
export async function notifyPvpRound(roundNo, playerIds, pot) {
  if (!bot) return;
  const activeSince = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const throttleBefore = Date.now() - 24 * 3600 * 1000;
  const { data: users } = await supabase.from('users')
    .select('tg_id, language, last_pvp_notify_at')
    .eq('bot_blocked', false).eq('is_banned', false)
    .gte('last_active_at', activeSince);
  const targets = (users || []).filter(u =>
    !playerIds.includes(u.tg_id) &&
    (!u.last_pvp_notify_at || new Date(u.last_pvp_notify_at).getTime() < throttleBefore)
  );
  if (!targets.length) return;
  // Mark everyone up front so a crash mid-send can't cause a second wave
  await supabase.from('users')
    .update({ last_pvp_notify_at: new Date().toISOString() })
    .in('tg_id', targets.map(u => u.tg_id));
  for (const u of targets) {
    const make = PVP_NOTIFY_TEXTS[u.language] || PVP_NOTIFY_TEXTS.en;
    await sendAppMessage(u.tg_id, make(roundNo, pot), '⚔️ PvP');
    await new Promise(r => setTimeout(r, 50));
  }
}

export async function notifyLotteryResult(tickets, winner, roundNo) {
  if (!bot) return;
  for (const t of tickets) {
    const isWinner = t.tg_id === winner.tg_id;
    const text = isWinner
      ? `🎟 *Ты выиграл лотерею!*\n\n👑 PRO на 7 дней активирован! Открой приложение — статус уже отображается в профиле.\n\n_Розыгрыш #${roundNo}_`
      : `🎟 *Итоги лотереи #${roundNo}*\n\nПобедил: @${winner.username || '...'} 🏆\n\nНе повезло в этот раз — но каждый раунд новый шанс! 🎫`;
    try {
      await bot.sendMessage(t.tg_id, text, {
        parse_mode: 'Markdown',
        reply_markup: isWinner ? {
          inline_keyboard: [[{ text: '👑 Открыть ARCADE', web_app: { url: APP_URL } }]],
        } : {
          inline_keyboard: [[{ text: '🎟 Участвовать снова', web_app: { url: APP_URL + '?tab=lottery' } }]],
        },
      });
    } catch {}
    await new Promise(r => setTimeout(r, 50));
  }
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