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
  document.getElementById('topUsername').textContent = ME.username ? '@' + ME.username : (ME.first_name || 'Player');
  document.getElementById('balTon').textContent = fmt(ME.balance_ton, 2);
  document.getElementById('balArc').textContent = fmt(ME.balance_arc, 0);
}
function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

let currentTab = 'main';
const PAGES = ['pvp', 'tasks', 'main', 'friends', 'profile'];

function switchTab(tab) {
  currentTab = tab;
  PAGES.forEach(p => document.getElementById('page-' + p).hidden = (p !== tab));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
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

document.querySelectorAll('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

function renderMain() {
  const ads = [1, 2, 3].map(n => `
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} ${n} — 5 ARC</span>
        <span class="sub">${t('ad_unavailable')}</span>
      </div>
      <button class="btn btn-sm btn-gray" disabled>${t('ad_watch')}</button>
    </div>`).join('');
  document.getElementById('page-main').innerHTML = `
    <div class="block"><h2>${t('about_title')}</h2><p class="muted">${t('about_text')}</p></div>
    <div class="block"><h2>${t('watch_ads')}</h2>${ads}</div>`;
}

async function renderTasks() {
  const el = document.getElementById('page-tasks');
  el.innerHTML = `<div class="block"><p class="muted">${t('loading')}</p></div>`;
  const ci = await api('/checkin/status');
  const days = [1,2,3,4,5,6].map(d => {
    const mult = {1:'1.0',2:'1.1',3:'1.2',4:'1.3',5:'1.4',6:'1.5'}[d];
    const cur = ci.day === d ? 'cur' : '';
    return `<div class="day ${cur}"><div class="d">${t('day')} ${d}</div><div class="x">×${mult}</div></div>`;
  }).join('');
  const tasks = await api('/tasks');
  let tasksHtml = !tasks.length ? `<p class="muted">${t('no_tasks')}</p>` :
    tasks.map(tk => `
      <div class="row">
        <div class="info">
          <span class="title">${LANG === 'ru' ? tk.title_ru : tk.title_en}</span>
          <span class="sub">+${tk.reward_arc} ARC</span>
        </div>
        ${tk.completed ? `<span class="tag">✓</span>` : `<button class="btn btn-sm btn-lime" onclick="checkTask(${tk.id}, this)">${t('check')}</button>`}
      </div>`).join('');
  el.innerHTML = `
    <div class="block">
      <h2>${t('daily_checkin')}</h2>
      <p class="muted" style="margin-bottom:12px">${t('checkin_hint')}</p>
      <div class="checkin">${days}</div>
      <button class="btn btn-yellow" style="margin-top:14px" id="checkinBtn" ${ci.canClaim ? '' : 'disabled'}>
        ${ci.canClaim ? t('claim') : t('checkin_done')}
      </button>
    </div>
    <div class="block">
      <h2>${t('promo_title')}</h2>
      <input class="field" id="promoInput" placeholder="${t('promo_placeholder')}" />
      <button class="btn btn-lime" id="promoBtn">${t('activate')}</button>
    </div>
    <div class="block"><h2>${t('tasks_title')}</h2>${tasksHtml}</div>`;
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
    toast(t('promo_' + (r.error === 'not_found' ? 'not_found' : r.error === 'already_used' ? 'used' : r.error === 'expired' ? 'expired' : r.error === 'limit_reached' ? 'limit' : 'not_found')));
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
  const col = (arr) => arr.length
    ? arr.map(u => `<div class="ref-item"><span class="u">@${u.username || '...'}</span> — <span class="e">${fmt(u.earned,0)} ARC</span></div>`).join('')
    : `<p class="muted">${t('no_referrals')}</p>`;
  el.innerHTML = `
    <div class="block">
      <h2>${t('friends_title')}</h2>
      <p class="muted" style="margin-bottom:12px">${t('friends_hint')}</p>
      <input class="field" id="refLink" value="${r.link}" readonly />
      <div style="display:flex;gap:10px">
        <button class="btn btn-yellow" id="copyBtn">${t('copy')}</button>
        <button class="btn btn-ton" id="shareBtn">${t('share')}</button>
      </div>
    </div>
    <div class="block">
      <div class="ref-cols">
        <div class="ref-col"><h3>${t('level1')} · 20%</h3>${col(r.level1)}</div>
        <div class="ref-col"><h3>${t('level2')} · 10%</h3>${col(r.level2)}</div>
      </div>
    </div>`;
  document.getElementById('copyBtn').onclick = () => { navigator.clipboard?.writeText(r.link); toast(t('copied')); };
  document.getElementById('shareBtn').onclick = () => {
    const text = LANG === 'ru' ? 'Играй в ARCADE!' : 'Play ARCADE!';
    tg?.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(text)}`);
  };
}

function shortWallet(w) { return !w ? '' : w.slice(0, 4) + '...' + w.slice(-4); }

function renderProfile() {
  const el = document.getElementById('page-profile');
  const walletBlock = ME.wallet
    ? `<div class="block"><h2>${t('my_wallet')}</h2><p class="big">${shortWallet(ME.wallet)}</p>
         <button class="btn btn-gray" style="margin-top:10px" id="disconnectBtn">${t('disconnect')}</button></div>`
    : `<div class="block"><button class="btn btn-ton" id="connectBtn">${t('connect_wallet')}</button></div>`;
  el.innerHTML = `
    <div class="block"><h2>${t('profile_title')}</h2><p class="muted">${ME.username ? '@'+ME.username : ME.first_name}</p></div>
    ${walletBlock}
    <div class="block">
      <div style="display:flex;gap:10px;margin-bottom:10px">
        <button class="btn btn-yellow" id="depBtn">${t('deposit')}</button>
        <button class="btn btn-gray" id="wdBtn">${t('withdraw')}</button>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-lime" id="exBtn">${t('exchange_ton_arc')}</button>
        <button class="btn btn-gray" disabled>${t('exchange_arc_ton')} <span class="tag tag-soon">${t('soon')}</span></button>
      </div>
    </div>`;
  const conn = document.getElementById('connectBtn');
  if (conn) conn.onclick = () => tonConnectUI && tonConnectUI.openModal();
  const dis = document.getElementById('disconnectBtn');
  if (dis) dis.onclick = async () => { if (tonConnectUI) await tonConnectUI.disconnect(); };
  document.getElementById('depBtn').onclick = () => toast(t('soon'));
  document.getElementById('wdBtn').onclick = () => toast(t('soon'));
  document.getElementById('exBtn').onclick = () => toast(t('soon'));
}

function renderPvP() {
  const el = document.getElementById('page-pvp');
  el.innerHTML = `
    <div class="pvp-head">
      <span class="online-dot">● <span id="onlineN">21</span> ${t('online')}</span>
      <span class="muted" id="roundLabel">${t('round')} #—</span>
    </div>
    <div class="pvp-total">${t('total')} <b id="potVal">0</b> ARC</div>
    <div class="wheel-wrap">
      <div class="wheel-pointer"></div>
      <div class="wheel" id="wheel"></div>
      <div class="wheel-center" id="wheelCenter">${t('waiting')}</div>
    </div>
    <button class="btn btn-yellow" id="addBetBtn">+ ${t('add_bet')}</button>
    <div id="playersList" style="margin-top:14px"></div>
    <div class="hash" id="hashLine"></div>`;
  document.getElementById('addBetBtn').onclick = openBetModal;
  loadPvP();
  pvpTimer = setInterval(loadPvP, 1500);
}

async function loadPvP() {
  const s = await api('/pvp/state');
  document.getElementById('roundLabel').textContent = `${t('round')} #${s.roundNo}`;
  document.getElementById('potVal').textContent = fmt(s.pot, 0);
  const center = document.getElementById('wheelCenter');
  if (s.status === 'counting' && s.secondsLeft != null) center.textContent = '00:' + String(s.secondsLeft).padStart(2, '0');
  else if (s.status === 'spinning') center.textContent = '...';
  else if (s.status === 'done' && s.winner) center.textContent = '🏆';
  else center.textContent = t('waiting');
  drawWheel(s.players);
  document.getElementById('playersList').innerHTML = s.players.map(p => `
    <div class="player-card">
      <span class="name">@${p.username || '...'}</span>
      <span class="pct">${p.chance}% · ${fmt(p.amount,0)} ARC</span>
    </div>`).join('');
  if (s.status === 'done' && s.winner) {
    document.getElementById('hashLine').textContent = `${t('winner')}: @${s.winner.username || '...'} · ${s.winner.chance}% · +${s.winner.prize} ARC`;
  } else if (s.seedHash) {
    document.getElementById('hashLine').textContent = 'Hash ' + s.seedHash.slice(0,5) + '...' + s.seedHash.slice(-4);
  }
}

const WHEEL_COLORS = ['#ff3ed6', '#c6ff2e', '#3aa6ff', '#ffd60a', '#34d058', '#ff7847'];
function drawWheel(players) {
  const wheel = document.getElementById('wheel');
  if (!players.length) { wheel.style.background = 'var(--card2)'; return; }
  let acc = 0; const stops = [];
  players.forEach((p, i) => {
    const start = acc; acc += Number(p.chance);
    stops.push(`${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${start}% ${acc}%`);
  });
  wheel.style.background = `conic-gradient(${stops.join(',')})`;
}

function openBetModal() {
  openModal(`
    <h2 style="margin-bottom:14px">${t('add_bet')}</h2>
    <p class="muted" style="margin-bottom:12px">${t('pvp_min_max')}</p>
    <input class="field" id="betInput" type="number" min="10" max="1000" placeholder="${t('bet_amount')}" />
    <button class="btn btn-yellow" id="betConfirm">${t('confirm')}</button>`);
  document.getElementById('betConfirm').onclick = async () => {
    const amount = Number(document.getElementById('betInput').value);
    if (!(amount >= 10 && amount <= 1000)) return toast(t('pvp_min_max'));
    const r = await api('/pvp/bet', { amount });
    if (r.ok) { ME.balance_arc = r.balance_arc; renderHeader(); closeModal(); loadPvP(); }
    else toast(r.error === 'not_enough' ? t('not_enough') : t('error'));
  };
}

document.getElementById('langBtn').onclick = async () => {
  LANG = LANG === 'ru' ? 'en' : 'ru';
  await api('/language', { language: LANG });
  applyLang();
};

// TON Connect
function initTonConnect() {
  try {
    tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
      manifestUrl: window.location.origin + '/tonconnect-manifest.json',
    });
    tonConnectUI.onStatusChange(async (wallet) => {
      if (wallet) {
        const address = wallet.account.address;
        await api('/wallet/connect', { wallet: address });
        ME.wallet = address;
      } else {
        await api('/wallet/disconnect', {});
        ME.wallet = null;
      }
      if (currentTab === 'profile') renderProfile();
    });
  } catch (e) { console.log('tonconnect init error', e); }
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
}
init();
