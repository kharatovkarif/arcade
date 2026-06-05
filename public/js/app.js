const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const INIT_DATA = tg?.initData || '';
let LANG = 'ru';
let ME = null;
let pvpTimer = null;
let tonConnectUI = null;

async function api(path, body = {}) {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': INIT_DATA },
    body: JSON.stringify(body),
  });
  return res.json();
}

function t(key) { return (window.I18N[LANG] && window.I18N[LANG][key]) || key; }

function applyLang() {
  document.querySelectorAll('[data-i]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i'));
  });
  document.getElementById('langBtn').textContent = LANG.toUpperCase();
  document.documentElement.lang = LANG;
  renderCurrentTab();
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').hidden = false;
}
function closeModal() { document.getElementById('modal').hidden = true; }
document.getElementById('modalClose').onclick = closeModal;

function renderHeader() {
  if (!ME) return;
  const name = ME.username ? '@' + ME.username : (ME.first_name || 'Player');
  document.getElementById('topUsername').textContent = name;
  document.getElementById('topSubBal').textContent = fmt(ME.balance_ton, 2) + ' TON · ' + fmt(ME.balance_arc, 0) + ' ARC';
  const av = document.getElementById('topAvatar');
  if (av) av.textContent = (ME.username || ME.first_name || 'P')[0].toUpperCase();
}

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

let currentTab = 'main';
const PAGES = ['pvp', 'tasks', 'main', 'friends', 'profile'];

function switchTab(tab) {
  currentTab = tab;
  const ov = document.getElementById('winnerOverlay');
  if (ov) ov.style.display = 'none';
  PAGES.forEach(p => document.getElementById('page-' + p).hidden = (p !== tab));
  document.querySelectorAll('.tab, .tab-center').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (pvpTimer) { clearInterval(pvpTimer); pvpTimer = null; }
  renderCurrentTab();
}

function renderCurrentTab() {
  if (!ME) return;
  if (currentTab === 'main') renderMain();
  if (currentTab === 'tasks') renderTasks();
  if (currentTab === 'pvp') renderPvP();
  if (currentTab === 'friends') renderFriends();
  if (currentTab === 'profile') renderProfile();
}

document.querySelectorAll('.tab, .tab-center').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

function renderMain() {
  const walletHtml = ME.wallet
    ? `<div class="hero-wallet">${ME.wallet.slice(0,4)}...${ME.wallet.slice(-4)}</div>` : '';
  const ads = [1, 2, 3].map(n => `
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} ${n} — 5 ARC</span>
        <span class="sub">${t('ad_unavailable')}</span>
      </div>
      <button class="btn btn-sm btn-dark" disabled>${t('ad_watch')}</button>
    </div>`).join('');
  document.getElementById('page-main').innerHTML = `
    <div class="hero-card">
      ${walletHtml}
      <div class="hero-platform">TON PLATFORM</div>
      <div class="hero-name">ARCADE</div>
      <div class="hero-stats">
        <div class="hero-stat">
          <div class="hv">${fmt(ME.balance_ton, 2)}</div>
          <div class="hl">TON</div>
        </div>
        <div class="hero-stat">
          <div class="hv">${fmt(ME.balance_arc, 0)}</div>
          <div class="hl">ARC</div>
        </div>
      </div>
    </div>
    <div class="block">
      <div class="block-hdr">${t('about_title')}</div>
      <p class="muted">${t('about_text')}</p>
    </div>
    <div class="block">
      <div class="block-hdr">${t('watch_ads')}</div>
      ${ads}
    </div>`;
}

async function renderTasks() {
  const el = document.getElementById('page-tasks');
  el.innerHTML = `<div class="block"><p class="muted">${t('loading')}</p></div>`;
  const ci = await api('/checkin/status');
  const mult = {1:'1.0',2:'1.1',3:'1.2',4:'1.3',5:'1.4',6:'1.5'};
  const days = [1,2,3,4,5,6].map(d => {
    const cur = ci.day === d ? 'cur' : '';
    return `<div class="ci-day ${cur}"><span class="dn">Д${d}</span><span class="dx">×${mult[d]}</span></div>`;
  }).join('');
  const tasks = await api('/tasks');
  let tasksHtml = !tasks.length ? `<p class="muted">${t('no_tasks')}</p>` :
    tasks.map(tk => `
      <div class="row">
        <div class="info">
          <span class="title">${LANG === 'ru' ? tk.title_ru : tk.title_en}</span>
          <span class="sub">+${tk.reward_arc} ARC</span>
        </div>
        ${tk.completed
          ? `<span class="tag tag-done">✓</span>`
          : `<button class="btn btn-sm btn-green" onclick="checkTask(${tk.id}, this)">${t('check')}</button>`}
      </div>`).join('');
  el.innerHTML = `
    <div class="ci-card">
      <div class="ci-hdr">${t('daily_checkin')}</div>
      <div class="ci-stats">
        <div class="ci-stat"><div class="cv">${ci.day}</div><div class="cl">${t('day')}</div></div>
        <div class="ci-stat"><div class="cv">×${mult[ci.day] || '1.5'}</div><div class="cl">${t('multiplier')}</div></div>
      </div>
      <div class="ci-days">${days}</div>
      <div class="ci-hint">💡 ${t('checkin_hint')}</div>
      <button class="btn btn-white" id="checkinBtn" ${ci.canClaim ? '' : 'disabled'}>
        ${ci.canClaim ? t('claim') : t('checkin_done')}
      </button>
    </div>
    <div class="block">
      <div class="block-hdr">${t('promo_title')}</div>
      <input class="field" id="promoInput" placeholder="${t('promo_placeholder')}" />
      <button class="btn btn-blue" id="promoBtn">${t('activate')}</button>
    </div>
    <div class="block">
      <div class="block-hdr">${t('tasks_title')}</div>
      ${tasksHtml}
    </div>`;
  document.getElementById('checkinBtn').onclick = doCheckin;
  document.getElementById('promoBtn').onclick = doPromo;
}

async function doCheckin() {
  const r = await api('/checkin/claim');
  if (r.ok) { toast(`${t('checkin_claimed')} ×${r.multiplier}`); renderTasks(); }
  else if (r.error === 'already_claimed') toast(t('checkin_done'));
}

async function doPromo() {
  const code = document.getElementById('promoInput').value.trim();
  if (!code) return;
  const r = await api('/promo', { code });
  if (r.ok) {
    toast(t('promo_ok') + r.reward + ' ARC');
    ME.balance_arc = r.balance_arc; renderHeader();
    document.getElementById('promoInput').value = '';
  } else {
    const errMap = { not_found: 'promo_not_found', already_used: 'promo_used', expired: 'promo_expired', limit_reached: 'promo_limit' };
    toast(t(errMap[r.error] || 'promo_not_found'));
  }
}

window.checkTask = async (id, btn) => {
  btn.disabled = true;
  const r = await api('/tasks/check', { task_id: id });
  if (r.ok) { toast('+' + r.reward + ' ARC'); ME.balance_arc = r.balance_arc; renderHeader(); renderTasks(); }
  else { toast(r.error === 'not_subscribed' ? t('task_check_fail') : t('error')); btn.disabled = false; }
};

async function renderFriends() {
  const el = document.getElementById('page-friends');
  el.innerHTML = `<div class="block"><p class="muted">${t('loading')}</p></div>`;
  const r = await api('/referrals');
  const totalInvited = r.level1.length + r.level2.length;
  const totalEarned = [...r.level1, ...r.level2].reduce((s, u) => s + (u.earned || 0), 0);
  const col = (arr) => arr.length
    ? arr.map(u => `<div class="ref-item"><span class="ru">@${u.username || '...'}</span><span class="re">${fmt(u.earned,0)} ARC</span></div>`).join('')
    : `<p class="muted" style="font-size:13px">${t('no_referrals')}</p>`;
  el.innerHTML = `
    <div class="ref-card">
      <div class="ref-title">${t('friends_title')}</div>
      <div class="ref-sub">${t('friends_hint')}</div>
      <div class="ref-stats">
        <div class="ref-stat"><div class="rv">${totalInvited}</div><div class="rl">Приглашено</div></div>
        <div class="ref-stat"><div class="rv">${fmt(totalEarned,0)}</div><div class="rl">ARC заработано</div></div>
      </div>
      <input class="field" id="refLink" value="${r.link}" readonly style="margin-bottom:8px" />
      <div style="display:flex;gap:8px">
        <button class="btn btn-white" id="copyBtn">${t('copy')}</button>
        <button class="btn btn-blue" id="shareBtn">${t('share')}</button>
      </div>
    </div>
    <div class="block">
      <div class="ref-cols">
        <div class="ref-col">
          <div class="ref-col-hdr">${t('level1')} · 20%</div>
          ${col(r.level1)}
        </div>
        <div class="ref-col">
          <div class="ref-col-hdr">${t('level2')} · 10%</div>
          ${col(r.level2)}
        </div>
      </div>
    </div>`;
  document.getElementById('copyBtn').onclick = () => { navigator.clipboard?.writeText(r.link); toast(t('copied')); };
  document.getElementById('shareBtn').onclick = () => {
    const text = LANG === 'ru' ? 'Играй в ARCADE!' : 'Play ARCADE!';
    tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`);
  };
}

function shortWallet(w) { return !w ? '' : w.slice(0, 4) + '...' + w.slice(-4); }

window.disconnectWallet = async () => {
  try { if (tonConnectUI) await tonConnectUI.disconnect(); } catch(e) {}
  await api('/wallet/disconnect', {});
  ME.wallet = null;
  renderHeader();
  renderProfile();
  renderMain();
};

function renderProfile() {
  const el = document.getElementById('page-profile');
  const letter = (ME.username || ME.first_name || 'P')[0].toUpperCase();
  const walletBlock = ME.wallet
    ? `<div class="wallet-row">
        <div class="wallet-icon">💼</div>
        <div class="wallet-info">
          <div class="wallet-addr">${shortWallet(ME.wallet)}</div>
          <div class="wallet-status">● Подключён ✓</div>
        </div>
        <button class="btn btn-sm btn-dark" onclick="disconnectWallet()">${t('disconnect')}</button>
       </div>`
    : `<button class="btn btn-blue" style="margin-bottom:10px" id="connectBtn">${t('connect_wallet')}</button>`;
  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar">${letter}</div>
      <div class="profile-name">${ME.username ? '@' + ME.username : ME.first_name}</div>
      <div class="profile-stats">
        <div class="profile-stat"><div class="pv">${fmt(ME.balance_ton, 2)}</div><div class="pl">TON</div></div>
        <div class="profile-stat"><div class="pv">${fmt(ME.balance_arc, 0)}</div><div class="pl">ARC</div></div>
        <div class="profile-stat"><div class="pv">×${ME.checkin_day >= 6 ? '1.5' : Math.max(1.0, 1 + ((ME.checkin_day||1) - 1) * 0.1).toFixed(1)}</div><div class="pl">Множитель</div></div>
      </div>
    </div>
    ${walletBlock}
    <div class="block">
      <div class="block-hdr">Операции</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button class="btn btn-blue" id="depBtn">${t('deposit')}</button>
        <button class="btn btn-dark" id="wdBtn">${t('withdraw')}</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-white" id="exBtn">${t('exchange_ton_arc')}</button>
        <button class="btn btn-dark" disabled>${t('exchange_arc_ton')} <span class="tag tag-soon">${t('soon')}</span></button>
      </div>
    </div>
    <button class="btn btn-dark" id="lbBtn" style="margin-top:6px;font-size:15px">🏆 Лидерборд</button>
    <button class="btn btn-dark" id="histBtn" style="margin-top:6px;font-size:15px">📋 История операций</button>`;
  const conn = document.getElementById('connectBtn');
  if (conn) conn.onclick = () => tonConnectUI && tonConnectUI.openModal();
  document.getElementById('depBtn').onclick = openDeposit;
  document.getElementById('wdBtn').onclick = openWithdraw;
  document.getElementById('exBtn').onclick = openExchange;
  document.getElementById('lbBtn').onclick = openLeaderboard;
  document.getElementById('histBtn').onclick = openTxHistory;
}

function renderPvP() {
  const el = document.getElementById('page-pvp');
  el.innerHTML = `
    <div class="pvp-top">
      <div class="pvp-logo">
        <span class="pvp-logo-icon">⚔️</span>
        <span class="pvp-logo-text">PvP</span>
        <span class="pvp-round" id="roundLabel">ИГРА #—</span>
      </div>
    </div>
    <div class="pvp-banks">
      <div class="pvp-bank-side">
        <div class="pvp-bank-lbl">БАНК</div>
        <div class="pvp-bank-val"><span id="potVal">0</span> ARC</div>
      </div>
      <div class="pvp-bank-side" style="text-align:right">
        <div class="pvp-bank-lbl">МОЙ БАЛАНС</div>
        <div class="pvp-mybal-val" id="pvpMyBal">${fmt(ME?.balance_arc ?? 0, 0)} ARC</div>
      </div>
    </div>
    <div class="wheel-wrap">
      <div class="wheel-pointer"></div>
      <div class="wheel" id="wheel"></div>
      <div class="wheel-center" id="wheelCenter">${t('waiting')}</div>
    </div>
    <div class="pvp-input-row">
      <input class="pvp-input" id="betInput" type="number" min="10" max="1000" placeholder="0 ARC" />
      <button class="pvp-bet-btn" id="addBetBtn">+ ${t('add_bet')}</button>
    </div>
    <div class="pvp-amts">
      <div class="pvp-amt" onclick="setBet(10)">10</div>
      <div class="pvp-amt" onclick="setBet(50)">50</div>
      <div class="pvp-amt" onclick="setBet(100)">100</div>
      <div class="pvp-amt" onclick="setBet(500)">500</div>
    </div>
    <div class="pvp-section-lbl">
      <span>УЧАСТНИКИ</span>
      <span id="onlineLabel" style="color:var(--green)">0 онлайн</span>
    </div>
    <div id="playersList"></div>
    <div class="hash" id="hashLine"></div>
    <button class="btn btn-dark" style="margin-top:12px;width:100%" onclick="openPvPHistory()">📋 История игр</button>
    <div id="winnerOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:32px">
      <div style="font-size:56px">🏆</div>
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px">ПОБЕДИТЕЛЬ</div>
      <div id="woUsername" style="font-size:28px;font-weight:900;color:#fff"></div>
      <div id="woChance" style="font-size:14px;color:var(--muted2);margin-top:-4px"></div>
      <div id="woPrize" style="font-size:40px;font-weight:900;color:#ffd60a;margin-top:4px"></div>
    </div>`;
  document.getElementById('addBetBtn').onclick = doBet;
  loadPvP();
  pvpTimer = setInterval(loadPvP, 1500);
}

window.openPvPHistory = async () => {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">📋 История PvP</div>
      <button onclick="this.closest('[style]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div id="pvpHistContent" style="flex:1;overflow-y:auto;padding:12px 16px">
      <div class="pvp-empty">Загрузка...</div>
    </div>`;
  document.body.appendChild(ov);
  const data = await api('/pvp/history');
  const el = ov.querySelector('#pvpHistContent');
  if (!data.length) { el.innerHTML = '<div class="pvp-empty" style="padding:20px">Игр пока нет</div>'; return; }
  el.innerHTML = data.map(g => `
    <div class="player-card" style="justify-content:space-between;margin-bottom:6px">
      <span style="color:var(--muted2);font-size:12px;min-width:36px">#${g.round_no}</span>
      <span class="pname" style="flex:1">@${g.winner}</span>
      <span style="color:var(--muted2);font-size:12px;margin-right:8px">${g.chance}%</span>
      <span style="color:#ffd60a;font-weight:700">+${fmt(Number(g.prize),0)} ARC</span>
    </div>`).join('');
};

window.setBet = (v) => {
  const inp = document.getElementById('betInput');
  if (inp) inp.value = v;
};


async function doBet() {
  const amount = Number(document.getElementById('betInput')?.value);
  if (!(amount >= 10 && amount <= 1000)) return toast(t('pvp_min_max'));
  const r = await api('/pvp/bet', { amount });
  if (r.ok) { ME.balance_arc = r.balance_arc; renderHeader(); loadPvP(); }
  else toast(r.error === 'not_enough' ? t('not_enough') : t('error'));
}

async function loadPvP() {
  const s = await api('/pvp/state');
  const roundEl = document.getElementById('roundLabel');
  if (roundEl) roundEl.textContent = `ИГРА #${s.roundNo}`;
  const potEl = document.getElementById('potVal');
  if (potEl) potEl.textContent = fmt(s.pot, 0);
  const onlineEl = document.getElementById('onlineLabel');
  if (onlineEl) onlineEl.textContent = s.players.length + ' ' + t('online');
  const center = document.getElementById('wheelCenter');
  if (center) {
    if (s.status === 'counting' && s.secondsLeft != null) center.textContent = '00:' + String(s.secondsLeft).padStart(2, '0');
    else if (s.status === 'spinning') center.textContent = '🎰';
    else if (s.status === 'done' && s.winner) center.textContent = '🏆';
    else center.textContent = t('waiting');
  }
  const myBalEl = document.getElementById('pvpMyBal');
  if (myBalEl) myBalEl.textContent = fmt(ME.balance_arc, 0) + ' ARC';

  if (s.status === 'spinning') {
    if (!spinTriggered && s.winner?.roll != null) {
      spinTriggered = true;
      spinWheel(s.players, s.winner.roll);
    }
  } else if (s.status === 'done') {
    if (!spinTriggered) drawWheel(s.players);
    if (s.winner && prevPvpStatus !== 'done' && !winnerShown) {
      winnerShown = true;
      showWinnerOverlay(s.winner);
    }
  } else {
    spinTriggered = false;
    winnerShown = false;
    drawWheel(s.players);
  }
  prevPvpStatus = s.status;
  const pl = document.getElementById('playersList');
  if (pl) {
    pl.innerHTML = s.players.length
      ? s.players.map(p => `
          <div class="player-card">
            <span class="pname">@${p.username || '...'}</span>
            <span class="pchance">${p.chance}% · ${fmt(p.amount,0)} ARC</span>
          </div>`).join('')
      : `<div class="pvp-empty">Будь первым — сделай ставку!</div>`;
  }
  const hl = document.getElementById('hashLine');
  if (hl) {
    if (s.status === 'done' && s.winner) {
      hl.textContent = `${t('winner')}: @${s.winner.username || '...'} · ${s.winner.chance}% · +${s.winner.prize} ARC`;
    } else if (s.seedHash) {
      hl.textContent = '🔒 ' + s.seedHash.slice(0,8) + '...' + s.seedHash.slice(-6);
    }
  }
}

const WHEEL_COLORS = ['#3b82f6','#ffd60a','#22c55e','#ef4444','#a855f7','#f97316','#06b6d4','#ec4899','#84cc16','#f43f5e'];
const WHEEL_EMPTY = `conic-gradient(
  #1f1f1f 0deg 44deg,   #0d0d0d 44deg 46deg,
  #303030 46deg 89deg,  #0d0d0d 89deg 91deg,
  #1f1f1f 91deg 134deg, #0d0d0d 134deg 136deg,
  #303030 136deg 179deg,#0d0d0d 179deg 181deg,
  #1f1f1f 181deg 224deg,#0d0d0d 224deg 226deg,
  #303030 226deg 269deg,#0d0d0d 269deg 271deg,
  #1f1f1f 271deg 314deg,#0d0d0d 314deg 316deg,
  #303030 316deg 360deg)`;

let spinTriggered = false;
let winnerShown = false;
let prevPvpStatus = null;

function buildWheelGradient(players) {
  let acc = 0; const stops = [];
  players.forEach((p, i) => {
    const start = acc; acc += Number(p.chance);
    stops.push(`${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${start}% ${acc}%`);
  });
  return `conic-gradient(${stops.join(',')})`;
}

function drawWheel(players) {
  const wheel = document.getElementById('wheel');
  if (!wheel) return;
  wheel.style.transition = 'none';
  wheel.style.transform = '';
  if (!players.length) {
    wheel.style.background = WHEEL_EMPTY;
    wheel.classList.add('idle');
    return;
  }
  wheel.classList.remove('idle');
  wheel.style.background = buildWheelGradient(players);
}

function showWinnerOverlay(winner) {
  const ov = document.getElementById('winnerOverlay');
  if (!ov) return;
  document.getElementById('woUsername').textContent = '@' + (winner.username || '...');
  document.getElementById('woChance').textContent = winner.chance + '% шанс победы';
  document.getElementById('woPrize').textContent = '+' + parseFloat(winner.prize).toLocaleString() + ' ARC';
  ov.style.display = 'flex';
  setTimeout(() => { ov.style.display = 'none'; }, 3000);
}

function spinWheel(players, roll) {
  const wheel = document.getElementById('wheel');
  if (!wheel) return;
  wheel.classList.remove('idle');
  wheel.style.background = buildWheelGradient(players);
  // Reset to 0 instantly, then animate to target
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  wheel.getBoundingClientRect(); // force reflow
  // 7 full rotations, land on roll position at top (pointer)
  const finalAngle = 360 * (7 - roll);
  wheel.style.transition = '';   // restore CSS transition from stylesheet
  wheel.style.transform = `rotate(${finalAngle}deg)`;
}

document.getElementById('langBtn').onclick = async () => {
  LANG = LANG === 'ru' ? 'en' : 'ru';
  await api('/language', { language: LANG });
  applyLang();
};

function createCommentBOC(text) {
  const textBytes = new TextEncoder().encode(text);
  const cellData = new Uint8Array(4 + textBytes.length);
  cellData.set(textBytes, 4);
  const d2 = cellData.length * 2;
  const cell = new Uint8Array(2 + cellData.length);
  cell[0] = 0; cell[1] = d2;
  cell.set(cellData, 2);
  const hdr = new Uint8Array([0xb5,0xee,0x9c,0x72,0x01,0x01,0x01,0x01,0x00,cell.length,0x00]);
  const boc = new Uint8Array(hdr.length + cell.length);
  boc.set(hdr); boc.set(cell, hdr.length);
  return btoa(String.fromCharCode(...boc));
}

function fmtDate(iso) {
  const d = new Date(iso);
  const msk = new Date(d.getTime() + 3 * 3600 * 1000);
  return msk.toISOString().replace('T', ' ').slice(0, 16) + ' МСК';
}

async function openTxHistory() {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">📋 История операций</div>
      <button onclick="this.closest('[style]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="display:flex;gap:6px;padding:10px 16px;overflow-x:auto">
      <button id="txTabDep" class="btn btn-blue" onclick="switchTx('deposit')" style="white-space:nowrap;flex-shrink:0">💎 Депозит</button>
      <button id="txTabWd" class="btn btn-dark" onclick="switchTx('withdraw')" style="white-space:nowrap;flex-shrink:0">💸 Вывод</button>
      <button id="txTabEx" class="btn btn-dark" onclick="switchTx('exchange')" style="white-space:nowrap;flex-shrink:0">🔄 Обмен</button>
    </div>
    <div id="txContent" style="flex:1;overflow-y:auto;padding:0 16px 24px"><div class="pvp-empty">Загрузка...</div></div>`;
  document.body.appendChild(ov);
  const raw = await api('/transactions/history');
  ov._txData = raw;
  window._txRaw = raw;
  renderTxTab('deposit');
}

window.switchTx = (type) => {
  ['deposit','withdraw','exchange'].forEach(t => {
    const ids = { deposit:'txTabDep', withdraw:'txTabWd', exchange:'txTabEx' };
    const btn = document.getElementById(ids[t]);
    if (btn) btn.className = t === type ? 'btn btn-blue' : 'btn btn-dark';
  });
  renderTxTab(type);
};

function renderTxTab(type) {
  const content = document.getElementById('txContent');
  if (!content) return;
  const all = window._txRaw || [];
  const rows = all.filter(t => t.type === type);
  if (!rows.length) { content.innerHTML = '<div class="pvp-empty" style="padding:20px">Операций пока нет</div>'; return; }
  const colors = { deposit: '#22c55e', withdraw: '#ef4444', exchange: '#3b82f6' };
  content.innerHTML = rows.map(t => {
    const sign = Number(t.amount) >= 0 ? '+' : '';
    const color = Number(t.amount) >= 0 ? colors[type] : '#ef4444';
    return `<div class="player-card" style="flex-direction:column;align-items:flex-start;gap:2px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;width:100%">
        <span style="color:${color};font-weight:700;font-size:15px">${sign}${fmt(Math.abs(Number(t.amount)),4)} ${t.currency}</span>
        <span style="color:var(--muted2);font-size:12px">${fmtDate(t.created_at)}</span>
      </div>
    </div>`;
  }).join('');
}

function openLeaderboard() {
  const ov = document.createElement('div');
  ov.id = 'lbOverlay';
  ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">🏆 Лидерборд</div>
      <button onclick="document.getElementById('lbOverlay').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="display:flex;gap:8px;padding:12px 16px">
      <button id="lbTabAds" class="btn btn-blue" onclick="switchLb('ads')" style="flex:1">📣 Реклама</button>
      <button id="lbTabPvp" class="btn btn-dark" onclick="switchLb('pvp')" style="flex:1">⚔️ PvP</button>
    </div>
    <div id="lbContent" style="flex:1;overflow-y:auto;padding:0 16px 24px"></div>`;
  document.body.appendChild(ov);
  switchLb('ads');
}

window.switchLb = async (tab) => {
  const btns = { ads: document.getElementById('lbTabAds'), pvp: document.getElementById('lbTabPvp') };
  if (!btns.ads) return;
  btns.ads.className = tab === 'ads' ? 'btn btn-blue' : 'btn btn-dark';
  btns.pvp.className = tab === 'pvp' ? 'btn btn-blue' : 'btn btn-dark';
  const content = document.getElementById('lbContent');
  content.innerHTML = `<div class="pvp-empty" style="padding:20px">Загрузка...</div>`;
  const data = await api('/leaderboard/' + tab);
  if (!document.getElementById('lbContent')) return;
  if (tab === 'ads' && (!data.top || !data.top.length)) {
    content.innerHTML = `<div style="text-align:center;padding:40px 16px;color:var(--muted2)">📣<br><br>Реклама появится скоро.<br>Топ будет здесь.</div>`;
    return;
  }
  const rows = (data.top || []).map(p => `
    <div class="player-card" style="justify-content:space-between">
      <span style="color:var(--muted2);font-weight:700;min-width:28px">#${p.rank}</span>
      <span class="pname" style="flex:1">@${p.username || '...'}</span>
      <span style="color:#ffd60a;font-weight:700">${tab === 'pvp' ? fmt(p.total, 0) + ' ARC' : p.count + ' раз'}</span>
    </div>`).join('') || '<div class="pvp-empty" style="padding:10px">Пока пусто</div>';
  const myRow = data.myRank ? `
    <div style="margin-top:12px;padding:8px 0;border-top:1px solid #2a2a2a;color:var(--muted2);font-size:12px;text-align:center">Твоё место</div>
    <div class="player-card" style="justify-content:space-between;border:1px solid var(--blue)">
      <span style="color:var(--blue);font-weight:700;min-width:28px">#${data.myRank.rank}</span>
      <span class="pname" style="flex:1">@${ME.username || '...'}</span>
      <span style="color:#ffd60a;font-weight:700">${tab === 'pvp' ? fmt(data.myRank.total, 0) + ' ARC' : data.myRank.count + ' раз'}</span>
    </div>` : '';
  content.innerHTML = rows + myRow;
};

async function openWithdraw() {
  if (!ME.wallet) { toast('Сначала подключите кошелёк'); return; }
  openModal(`
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">💸 Вывод TON</div>
    <div class="ci-hint" style="margin-bottom:12px;font-size:13px;line-height:1.8">
      Баланс: <b>${ME.balance_ton.toFixed(4)} TON</b><br>
      Мин. сумма: <b>0.1 TON</b><br>
      Кошелёк: <b style="font-size:12px;word-break:break-all">${ME.wallet}</b>
    </div>
    <input class="field" id="wdAmount" type="number" step="0.1" min="0.1" max="${ME.balance_ton}" placeholder="0.1 — ${ME.balance_ton.toFixed(2)} TON" />
    <div id="wdPreview" style="color:var(--blue);font-size:13px;font-weight:700;margin-bottom:10px;min-height:18px"></div>
    <button class="btn btn-blue" id="wdConfirm">Отправить заявку</button>
  `);
  document.getElementById('wdAmount').oninput = () => {
    const v = Number(document.getElementById('wdAmount').value);
    document.getElementById('wdPreview').textContent = v >= 0.1 ? `→ спишется ${v} TON с баланса` : '';
  };
  document.getElementById('wdConfirm').onclick = async () => {
    const amount = Number(document.getElementById('wdAmount').value);
    if (!(amount >= 0.1)) return toast('Минимум 0.1 TON');
    if (amount > ME.balance_ton) return toast('Недостаточно TON');
    const btn = document.getElementById('wdConfirm');
    btn.disabled = true; btn.textContent = 'Отправляю...';
    const r = await api('/withdraw', { amount });
    if (r.ok) {
      ME.balance_ton = r.balance_ton;
      renderHeader();
      closeModal();
      toast('✓ Заявка отправлена! Ожидайте подтверждения.');
    } else if (r.error === 'not_enough') {
      toast('Недостаточно TON');
      btn.disabled = false; btn.textContent = 'Отправить заявку';
    } else if (r.error === 'no_wallet') {
      toast('Кошелёк не подключён');
      closeModal();
    } else {
      toast(t('error'));
      btn.disabled = false; btn.textContent = 'Отправить заявку';
    }
  };
}

async function openDeposit() {
  if (!ME.wallet) { toast('Сначала подключите кошелёк'); return; }
  openModal(`<p class="muted">${t('loading')}</p>`);
  const info = await api('/deposit/info');
  document.getElementById('modalContent').innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">💎 Депозит TON</div>
    <div class="ci-hint" style="margin-bottom:12px;font-size:13px;line-height:1.8">
      Кошелёк получателя:<br><b style="font-size:12px;word-break:break-all">${info.wallet}</b><br><br>
      ❗ Комментарий (обязательно): <b>${info.comment}</b><br>
      Мин. сумма: <b>${info.min} TON</b> · Лимит в день: <b>${info.maxDay} TON</b>
    </div>
    <input class="field" id="depAmount" type="number" step="0.1" min="${info.min}" placeholder="${info.min} — ${info.maxDay} TON" />
    <div id="depPreview" style="color:var(--blue);font-size:13px;font-weight:700;margin-bottom:10px;min-height:18px"></div>
    <button class="btn btn-blue" id="depConfirm">Открыть кошелёк и отправить</button>`;
  document.getElementById('depAmount').oninput = () => {
    const v = Number(document.getElementById('depAmount').value);
    document.getElementById('depPreview').textContent = v >= info.min ? `→ зачислится ${v} TON на баланс` : '';
  };
  document.getElementById('depConfirm').onclick = async () => {
    const amount = Number(document.getElementById('depAmount').value);
    if (!(amount >= info.min)) return toast(`Минимум ${info.min} TON`);
    if (!tonConnectUI) return toast('Кошелёк не подключён');
    const btn = document.getElementById('depConfirm');
    btn.disabled = true; btn.textContent = 'Открываю кошелёк...';
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(Date.now() / 1000) + 600,
        messages: [{
          address: info.wallet,
          amount: String(Math.round(amount * 1e9)),
          payload: createCommentBOC(info.comment),
        }],
      });
      closeModal();
      toast('✓ Отправлено! Зачисление через ~10 сек');
    } catch(e) {
      if (e?.message?.includes('UserRejects') || e?.code === 300) {
        toast('Отменено');
      } else {
        toast(t('error'));
      }
      btn.disabled = false; btn.textContent = 'Открыть кошелёк и отправить';
    }
  };
}

async function openExchange() {
  openModal(`<p class="muted">${t('loading')}</p>`);
  const info = await api('/exchange/info');
  const pct = info.limit_ton ? Math.min(100, (info.used_ton / info.limit_ton) * 100) : 0;
  document.getElementById('modalContent').innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:14px">${t('exchange_ton_arc')}</div>
    <div style="background:var(--blue);border-radius:14px;padding:16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-weight:800;font-size:16px">1 TON =</span>
      <span style="font-weight:900;font-size:20px">${info.rate ? info.rate.toLocaleString() + ' ARC' : '—'}</span>
    </div>
    <div style="background:var(--card2);border-radius:14px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px">
        <span style="color:var(--muted2);font-size:14px">${t('exchange_limit')}</span>
        <span style="font-weight:700;font-size:14px">${info.used_ton.toFixed(2)} / ${info.limit_ton} TON</span>
      </div>
      <div style="height:4px;background:#2a2a2a;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:4px"></div>
      </div>
    </div>
    <input class="field" id="exAmount" type="number" step="0.1" min="0.1" max="${info.limit_ton}" placeholder="0.1 — ${info.limit_ton} TON" />
    <div id="exPreview" style="color:var(--muted2);font-size:13px;margin-bottom:10px;min-height:18px"></div>
    <button class="btn btn-white" id="exConfirm">${t('confirm')}</button>`;
  const inp = document.getElementById('exAmount');
  const preview = document.getElementById('exPreview');
  inp.oninput = () => {
    const v = Number(inp.value);
    preview.textContent = v >= 0.1 && info.rate ? `≈ ${Math.round(v * info.rate).toLocaleString()} ARC` : '';
  };
  document.getElementById('exConfirm').onclick = async () => {
    const amount = Number(inp.value);
    if (!(amount >= 0.1)) return toast(t('enter_amount'));
    const btn = document.getElementById('exConfirm');
    btn.disabled = true;
    const r = await api('/exchange/ton-arc', { amount });
    if (r.ok) {
      ME.balance_arc = r.balance_arc; ME.balance_ton = r.balance_ton;
      renderHeader(); closeModal(); renderProfile();
      toast(`+${r.arc_received.toLocaleString()} ARC`);
    } else {
      const errs = { not_enough_ton: 'Недостаточно TON', limit_exceeded: 'Лимит исчерпан', rate_unavailable: 'Курс недоступен', bad_amount: t('enter_amount') };
      toast(errs[r.error] || t('error'));
      btn.disabled = false;
    }
  };
}

function toFriendly(rawAddress) {
  try {
    if (window.TON_CONNECT_UI && typeof TON_CONNECT_UI.toUserFriendlyAddress === 'function') {
      return TON_CONNECT_UI.toUserFriendlyAddress(rawAddress, false);
    }
  } catch (e) {}
  return rawAddress;
}

function initTonConnect() {
  try {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
      manifestUrl: window.location.origin + '/tonconnect-manifest.json',
    });
    tonConnectUI.onStatusChange(async (wallet) => {
      if (wallet) {
        const address = toFriendly(wallet.account.address);
        await api('/wallet/connect', { wallet: address });
        ME.wallet = address;
      } else {
        await api('/wallet/disconnect', {});
        ME.wallet = null;
      }
      renderHeader();
      if (currentTab === 'profile') renderProfile();
      if (currentTab === 'main') renderMain();
    });
  } catch (e) {}
}

async function refreshBalance() {
  if (!ME) return;
  try {
    const u = await api('/me');
    if (u?.tg_id) {
      ME.balance_ton = u.balance_ton;
      ME.balance_arc = u.balance_arc;
      renderHeader();
    }
  } catch {}
}

async function init() {
  ME = await api('/me');
  if (ME.error) {
    document.getElementById('content').innerHTML = `<div class="block"><p class="muted">Open this app from Telegram</p></div>`;
    return;
  }
  LANG = ME.language || 'ru';
  renderHeader(); applyLang(); switchTab('main');
  initTonConnect();
  setInterval(refreshBalance, 10000);
}
init();
