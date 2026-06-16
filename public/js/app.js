const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }
const INIT_DATA = tg?.initData || '';
let LANG = 'ru';
let ME = null;
let pvpTimer = null;
let tonConnectUI = null;
let adsgramController = null;
let adsgramControllerShort = null;
let onclickaShow4 = null;
let monetagReady = false;

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

// The about-overlays are rendered inside a .page section, but .page has
// will-change:transform which makes position:fixed anchor to the page (not the
// viewport). Move the overlay out to <body> so it pins to the screen like #modal.
function relocateOverlay(id) {
  const node = document.getElementById(id);
  if (!node) return;
  document.querySelectorAll('#' + id).forEach(n => {
    if (n !== node && n.parentElement === document.body) n.remove();
  });
  if (node.parentElement !== document.body) document.body.appendChild(node);
}

function renderHeader() {
  if (!ME) return;
  const name = ME.username ? '@' + ME.username : (ME.first_name || 'Player');
  document.getElementById('topUsername').textContent = name;
  document.getElementById('topSubBal').textContent = fmt(ME.balance_ton, 2) + ' TON · ' + fmt(ME.balance_arc, 0) + ' ARC';
  applyAvatar(document.getElementById('topAvatar'));
}

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
}

// Telegram user from launch data — gives us the real profile photo when available
const TG_USER = tg?.initDataUnsafe?.user || null;

// Telegram-style placeholder gradients, picked by user id (red/orange/purple/green/cyan/blue/pink)
const AVATAR_GRADIENTS = [
  ['#ff845e', '#fd5c64'], ['#ffb14e', '#fda14e'], ['#b694f9', '#9787f7'],
  ['#8ee36a', '#6cc44a'], ['#7edadc', '#5fc4c6'], ['#74b3f0', '#5a9be0'],
  ['#f88bba', '#ed6ba6'],
];

function avatarInfo() {
  // Prefer our server proxy (works for everyone via the bot); fall back to the
  // launch-data photo_url if the backend somehow has nothing.
  const photo = ME?.tg_id ? `/api/avatar/${ME.tg_id}` : (TG_USER?.photo_url || null);
  // Prefer live Telegram first_name (always fresh from initData), then DB, then username
  const src = (TG_USER?.first_name || ME?.first_name || ME?.username || 'P').trim();
  const letter = (src[0] || 'P').toUpperCase();
  const id = Number(ME?.tg_id || TG_USER?.id || 0);
  const g = AVATAR_GRADIENTS[Math.abs(id) % AVATAR_GRADIENTS.length];
  return { photo, letter, grad: `linear-gradient(135deg, ${g[0]}, ${g[1]})` };
}

// Renders gradient+letter always; overlays the photo if it loads, falls back to the
// letter automatically if the photo is missing or fails — never an empty/broken avatar.
function applyAvatar(el) {
  if (!el) return;
  const { photo, letter, grad } = avatarInfo();
  el.style.background = grad;
  el.style.color = '#fff';
  el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.innerHTML = `<span>${letter}</span>` +
    (photo ? `<img src="${photo}" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">` : '');
}

let currentTab = 'main';
const PAGES = ['pvp', 'tasks', 'main', 'friends', 'profile'];

function switchTab(tab) {
  const ov = document.getElementById('winnerOverlay');
  if (ov) ov.style.display = 'none';
  if (pvpTimer) { clearInterval(pvpTimer); pvpTimer = null; }

  const prevTab = currentTab;
  currentTab = tab;
  document.querySelectorAll('.tab, .tab-center').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  const nextEl = document.getElementById('page-' + tab);
  const prevEl = prevTab ? document.getElementById('page-' + prevTab) : null;

  function showNext() {
    PAGES.forEach(p => { if (p !== tab) document.getElementById('page-' + p).hidden = true; });
    nextEl.hidden = false;
    nextEl.classList.remove('page-enter');
    void nextEl.offsetWidth; // restart animation
    nextEl.classList.add('page-enter');
    renderCurrentTab();
  }

  // cinematic out -> in transition when actually changing tab
  if (prevEl && prevEl !== nextEl && !prevEl.hidden) {
    prevEl.classList.add('page-exit');
    setTimeout(() => {
      prevEl.classList.remove('page-exit');
      prevEl.hidden = true;
      showNext();
    }, 220);
  } else {
    showNext();
  }
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

function adMult(day) {
  const m = {1:1.0,2:1.1,3:1.2,4:1.3,5:1.4};
  return day >= 6 ? 1.5 : (m[day] || 1.0);
}

function renderMain() {
  const walletHtml = ME.wallet
    ? `<div class="hero-wallet">${ME.wallet.slice(0,4)}...${ME.wallet.slice(-4)}</div>` : '';
  const active = !!adsgramController;
  const activeShort = !!adsgramControllerShort;
  const active4 = !!onclickaShow4;
  const dailyCount = ME.ad_daily_count || 0;
  const dailyShortCount = ME.ad_short_daily_count || 0;
  const daily4Count = ME.ad4_daily_count || 0;
  const reward = Math.round(10 * adMult(ME.checkin_day || 1));
  const adLimit1 = ME.is_pro ? 15 : 10;
  const adLimit2 = ME.is_pro ? 5 : 3;
  const adLimit4 = ME.is_pro ? 15 : 10;
  const limitReached = dailyCount >= adLimit1;
  const limitShortReached = dailyShortCount >= adLimit2;
  const limit4Reached = daily4Count >= adLimit4;

  const ad1Btn = (active && !limitReached)
    ? `<button onclick="watchAd(this)" style="width:44px;height:44px;border-radius:50%;background:var(--blue);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`
    : `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`;

  const ad2Btn = activeShort
    ? (limitShortReached
        ? `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`
        : `<button onclick="watchAdShort(this)" style="width:44px;height:44px;border-radius:50%;background:var(--blue);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`)
    : `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`;

  const ad4Btn = (active4 && !limit4Reached)
    ? `<button onclick="watchAd4(this)" style="width:44px;height:44px;border-radius:50%;background:var(--blue);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`
    : `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`;

  const adRows = `
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 1 &nbsp;<span style="color:var(--gold);font-size:13px">+10 ARC + ${t('checkin_short')}</span></span>
        <span class="sub">${dailyCount}/${adLimit1} ${t('today')}</span>
      </div>
      ${ad1Btn}
    </div>
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 2 &nbsp;<span style="color:var(--gold);font-size:13px">+5 ARC + ${t('checkin_short')}</span></span>
        <span class="sub">${activeShort ? dailyShortCount+'/'+adLimit2+' '+t('today') : t('soon')}</span>
      </div>
      ${ad2Btn}
    </div>
    ${(ME.ad_task_daily_count||0) >= 5
      ? `<div class="row">
          <div class="info">
            <span class="title">${t('ad_reward')} 3 &nbsp;<span style="color:var(--gold);font-size:13px">+5 ARC + ${t('checkin_short')}</span></span>
            <span class="sub">${t('done_label')+' · '+ME.ad_task_daily_count+'/5'}</span>
          </div>
          <button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--green);font-size:18px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">✓</button>
        </div>`
      : `<div class="row" id="ad3Fallback">
          <div class="info"><span class="title">${t('ad_reward')} 3</span><span class="sub">${t('soon')}</span></div>
          <button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>
        </div>
        <adsgram-task data-block-id="${ME.adsgram_block_id_task||''}" style="display:none;margin-top:8px;background:#141414;border-radius:14px;padding:12px;color:#fff;-adsgram-task-font-size:14px;-adsgram-task-icon-size:40px">
          <span slot="reward" style="color:var(--gold);font-weight:700;font-size:13px">+5 ARC + ${t('checkin_short')}</span>
          <div slot="button" style="background:var(--blue);color:#fff;border-radius:10px;padding:8px 16px;font-weight:700;font-size:13px;cursor:pointer">GO</div>
          <div slot="done" style="background:#2a2a2a;color:var(--muted);border-radius:10px;padding:8px 16px;font-weight:700;font-size:13px">✓</div>
        </adsgram-task>`}
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 4 ${active4 ? `&nbsp;<span style="color:var(--gold);font-size:13px">+5 ARC + ${t('checkin_short')}</span>` : ''}</span>
        <span class="sub">${active4 ? daily4Count+'/'+adLimit4+' '+t('today') : t('soon')}</span>
      </div>
      ${ad4Btn}
    </div>
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 5 ${monetagReady ? `&nbsp;<span style="color:var(--gold);font-size:13px">+5 ARC + ${t('checkin_short')}</span>` : ''}</span>
        <span class="sub">${monetagReady ? (ME.ad5_daily_count||0)+'/'+(ME.is_pro?10:5)+' '+t('today') : t('soon')}</span>
      </div>
      ${monetagReady && (ME.ad5_daily_count||0) < (ME.is_pro?10:5)
        ? `<button onclick="watchAd5(this)" style="width:44px;height:44px;border-radius:50%;background:var(--blue);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`
        : `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>`}
    </div>
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 6</span>
        <span class="sub" style="color:var(--gold)">${t('soon')}</span>
      </div>
      <button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>
    </div>
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 7</span>
        <span class="sub" style="color:var(--gold)">${t('soon')}</span>
      </div>
      <button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>
    </div>
    <div class="row">
      <div class="info">
        <span class="title">${t('ad_reward')} 8</span>
        <span class="sub" style="color:var(--gold)">${t('soon')}</span>
      </div>
      <button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--muted);font-size:20px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">▶</button>
    </div>`;

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
    <div onclick="openProModal()" style="cursor:pointer;margin-bottom:12px;padding:13px 16px;border-radius:14px;background:linear-gradient(135deg,#3a2d00,#1a1a1a);border:1px solid #ffd60a55;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-size:14px;font-weight:900;color:#ffd60a">👑 ARCADE PRO</div>
        <div style="font-size:12px;color:#ccc;margin-top:2px">${ME.is_pro
          ? t('pro_active_days').replace('{d}', proDaysLeft())
          : t('pro_perks')}</div>
      </div>
      <span style="color:#ffd60a;font-size:18px">›</span>
    </div>
    <div class="block">
      <div class="block-hdr">🎁 ${t('daily_chest')}</div>
      <div class="row">
        <div class="info">
          <span class="title">${t('chest_free_title')}</span>
          <span class="sub">${ME.chest_free_claimed ? t('done_label') : t('chest_free_sub')}</span>
        </div>
        ${ME.chest_free_claimed
          ? `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:var(--green);font-size:18px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">✓</button>`
          : `<button onclick="claimChest(this)" style="width:44px;height:44px;border-radius:50%;background:var(--blue);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">🎁</button>`}
      </div>
      <div class="row">
        <div class="info">
          <span class="title">${t('chest_bonus_title')}</span>
          <span class="sub">${ME.chest_bonus_claimed ? t('done_label') : (monetagReady ? t('chest_bonus_sub') : t('soon'))}</span>
        </div>
        ${(!ME.chest_bonus_claimed && monetagReady)
          ? `<button onclick="claimChestBonus(this)" style="width:44px;height:44px;border-radius:50%;background:var(--blue);border:none;color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">💎</button>`
          : `<button disabled style="width:44px;height:44px;border-radius:50%;background:#2a2a2a;border:none;color:${ME.chest_bonus_claimed ? 'var(--green)' : 'var(--muted)'};font-size:18px;cursor:default;display:flex;align-items:center;justify-content:center;flex-shrink:0">${ME.chest_bonus_claimed ? '✓' : '💎'}</button>`}
      </div>
    </div>
    <div class="block">
      <div class="block-hdr">${t('about_title')}</div>
      <p class="muted">${t('about_text')}</p>
    </div>
    <div class="block">
      <div class="block-hdr">${t('watch_ads')}</div>
      ${adRows}
    </div>`;
  const taskEl = document.querySelector('adsgram-task');
  if (taskEl) {
    taskEl.addEventListener('reward', () => {
      setTimeout(async () => {
        const me = await api('/me');
        ME.balance_arc = me.balance_arc;
        ME.ad_task_daily_count = me.ad_task_daily_count;
        renderHeader();
        if (currentTab === 'main') renderMain();
        toast('+5 ARC');
      }, 1500);
    });
    // No tasks available (or SDK error) → hide the widget, show the "Скоро" fallback row
    const showFallback = () => {
      const fb = document.getElementById('ad3Fallback');
      if (fb) fb.style.display = '';
      taskEl.style.display = 'none';
    };
    taskEl.addEventListener('onBannerNotFound', showFallback);
    taskEl.addEventListener('onError', showFallback);
    // Show the widget only after the custom element is actually registered by the SDK
    if (window.customElements) customElements.whenDefined('adsgram-task').then(() => {
      const fb = document.getElementById('ad3Fallback');
      const el2 = document.querySelector('adsgram-task');
      if (fb) fb.style.display = 'none';
      if (el2) el2.style.display = 'block';
    }).catch(() => {});
  }
}

async function renderTasks() {
  const el = document.getElementById('page-tasks');
  el.innerHTML = `<div class="block"><p class="muted">${t('loading')}</p></div>`;
  const [ci, allTasks] = await Promise.all([api('/checkin/status'), api('/tasks')]);
  const mult = {1:'1.0',2:'1.1',3:'1.2',4:'1.3',5:'1.4',6:'1.5'};
  const days = [1,2,3,4,5,6].map(d => {
    const cur = ci.day === d ? 'cur' : '';
    return `<div class="ci-day ${cur}"><span class="dn">${t('day_prefix')}${d}</span><span class="dx">×${mult[d]}</span></div>`;
  }).join('');

  const DAILY_TYPES = ['ad_milestone','pvp_milestone'];
  const PARTNER_TYPES = ['subscribe','link'];
  const sorted = (allTasks || []).slice().sort((a,b) => a.completed - b.completed || Number(a.target) - Number(b.target));
  const dailyTasks   = sorted.filter(tk => DAILY_TYPES.includes(tk.type));
  const partnerTasks = sorted.filter(tk => !DAILY_TYPES.includes(tk.type) && tk.is_partner);
  const generalTasks = sorted.filter(tk => !DAILY_TYPES.includes(tk.type) && !tk.is_partner);

  function pbar(prog, need) {
    const pct = need > 0 ? Math.min(100, Math.round((prog||0)/need*100)) : 0;
    return `<div style="height:3px;background:#2a2a2a;border-radius:3px;margin-top:4px"><div style="height:100%;width:${pct}%;background:var(--gold);border-radius:3px"></div></div>`;
  }

  function renderDaily(tk) {
    const title = tk['title_'+LANG] || tk.title_en || tk.title_ru;
    const prog = tk.progress||0, need = tk.need||Number(tk.target||0);
    const unit = tk.type==='pvp_milestone' ? t('unit_games') : t('unit_ads');
    const canClaim = prog >= need;
    const style = tk.completed ? ' style="opacity:.55"' : '';
    return `<div class="row"${style}>
      <div class="info">
        <span class="title">${title}</span>
        <span class="sub">+${tk.reward_arc} ARC · ${prog}/${need} ${unit}</span>
        ${pbar(prog, need)}
      </div>
      ${tk.completed
        ? `<div style="text-align:center;flex-shrink:0"><div style="color:var(--green);font-size:12px;font-weight:700">${t('done_label')}</div><div style="color:var(--muted);font-size:11px">${t('today')}</div></div>`
        : `<button class="btn btn-sm ${canClaim?'btn-green':'btn-dark'}" ${canClaim?`onclick="checkTask(${tk.id},this)"`:'disabled'}>${t('get_reward')}</button>`}
    </div>`;
  }

  function renderGeneral(tk) {
    const title = tk['title_'+LANG] || tk.title_en || tk.title_ru;
    const style = tk.completed ? ' style="opacity:.55"' : '';
    if (tk.completed) return `<div class="row"${style}>
      <div class="info"><span class="title">${title}</span><span class="sub">+${tk.reward_arc} ARC</span></div>
      <div style="text-align:center;flex-shrink:0"><div style="color:var(--green);font-size:12px;font-weight:700">${t('done_label')}</div><div style="color:var(--muted);font-size:11px">${t('today')}</div></div></div>`;
    if (tk.type==='subscribe' && tk.target) {
      const url = 'https://t.me/'+tk.target.replace('@','');
      return `<div class="row">
        <div class="info"><span class="title">${title}</span><span class="sub">+${tk.reward_arc} ARC</span></div>
        <div style="display:flex;gap:6px">
          <a href="${url}" target="_blank" class="btn btn-sm btn-dark">${t('go')}</a>
          <button class="btn btn-sm btn-green" onclick="checkTask(${tk.id},this)">${t('check')}</button>
        </div></div>`;
    }
    if (tk.type==='referral_milestone') {
      const prog = tk.progress||0, need = tk.need||Number(tk.target||0);
      const canClaim = prog >= need;
      return `<div class="row">
        <div class="info">
          <span class="title">${title}</span>
          <span class="sub">+${tk.reward_arc} ARC · ${prog}/${need} ${t('unit_friends')}</span>
        </div>
        <button class="btn btn-sm ${canClaim?'btn-green':'btn-dark'}" ${canClaim?`onclick="checkTask(${tk.id},this)"`:'disabled'}>${t('get_reward')}</button>
      </div>`;
    }
    return `<div class="row">
      <div class="info"><span class="title">${title}</span><span class="sub">+${tk.reward_arc} ARC</span></div>
      <button class="btn btn-sm btn-green" onclick="checkTask(${tk.id},this)">${t('check')}</button></div>`;
  }

  el.innerHTML = `
    <div class="pvp-top">
      <div class="pvp-logo">
        <span class="pvp-logo-icon">🎯</span>
        <span class="pvp-logo-text">${t('tasks_title')}</span>
      </div>
      <button class="pvp-info-btn" onclick="openTasksAbout()"><span class="pvp-info-i">ⓘ</span> ${t('tasks_about_title')}</button>
    </div>
    <div class="ci-card">
      <div class="ci-hdr">${t('daily_checkin')}</div>
      <div class="ci-stats">
        <div class="ci-stat"><div class="cv">${ci.day}</div><div class="cl">${t('day')}</div></div>
        <div class="ci-stat"><div class="cv">×${mult[ci.day]||'1.5'}</div><div class="cl">${t('multiplier')}</div></div>
      </div>
      <div class="ci-days">${days}</div>
      <div class="ci-hint">💡 ${ci.pro ? t('pro_checkin_auto') : t('checkin_hint')}</div>
      <button class="btn btn-white" id="checkinBtn" ${ci.canClaim?'':'disabled'}>
        ${ci.canClaim ? t('claim') : (ci.pro ? '👑 PRO' : t('checkin_done'))}
      </button>
    </div>
    <div class="block">
      <div class="block-hdr">${t('promo_title')}</div>
      <input class="field" id="promoInput" placeholder="${t('promo_placeholder')}" />
      <button class="btn btn-blue" id="promoBtn">${t('activate')}</button>
    </div>
    ${dailyTasks.length ? `<div class="block">
      <div class="block-hdr">📅 ${t('daily_tasks')}</div>
      ${dailyTasks.map(renderDaily).join('')}
    </div>` : ''}
    ${generalTasks.length ? `<div class="block">
      <div class="block-hdr">📋 ${t('general_tasks')}</div>
      ${generalTasks.map(renderGeneral).join('')}
    </div>` : ''}
    ${partnerTasks.length ? `<div class="block">
      <div class="block-hdr">🤝 ${t('partner_tasks')}</div>
      ${partnerTasks.map(renderGeneral).join('')}
    </div>` : ''}

    <div id="tasksAboutOverlay" class="pvp-about-overlay" onclick="if(event.target===this)closeTasksAbout()">
      <div class="pvp-about-sheet">
        <div class="pvp-about-head">
          <span class="pvp-about-title">${t('tasks_about_title')}</span>
          <span class="pvp-about-x" onclick="closeTasksAbout()">✕</span>
        </div>
        <div class="pvp-about-how">
          <div class="pvp-about-how-t">🎯 ${t('tasks_how_title')}</div>
          <div class="pvp-about-how-d">${t('tasks_how_text')}</div>
        </div>
        <div class="pvp-about-rules">
          ${[['✅',1],['🤝',2],['⚠️',3],['🚫',4]].map(([ic,n])=>`
            <div class="pvp-about-rule">
              <div class="pvp-about-rule-ic">${ic}</div>
              <div class="pvp-about-rule-tx">
                <div class="pvp-about-rule-t">${t('tasks_t'+n+'_t')}</div>
                <div class="pvp-about-rule-d">${t('tasks_t'+n+'_d')}</div>
              </div>
            </div>`).join('')}
        </div>
        <button class="btn btn-blue" style="margin-top:6px" onclick="closeTasksAbout()">${t('tasks_about_ok')}</button>
      </div>
    </div>`;
  document.getElementById('checkinBtn').onclick = doCheckin;
  document.getElementById('promoBtn').onclick = doPromo;
  relocateOverlay('tasksAboutOverlay');
}

function _lockBg(e) {
  const sheet = e.currentTarget.querySelector('.pvp-about-sheet');
  if (sheet && sheet.contains(e.target)) return;
  e.preventDefault();
}
window.openTasksAbout = () => {
  const ov = document.getElementById('tasksAboutOverlay');
  if (!ov) return;
  const sheet = ov.querySelector('.pvp-about-sheet');
  if (sheet) sheet.scrollTop = 0;
  ov.classList.add('show');
  ov.addEventListener('touchmove', _lockBg, { passive: false });
};
window.closeTasksAbout = () => {
  const ov = document.getElementById('tasksAboutOverlay');
  if (!ov) return;
  ov.classList.remove('show');
  ov.removeEventListener('touchmove', _lockBg);
};

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
  else {
    if (r.error === 'not_subscribed') toast(t('task_check_fail'));
    else if (r.error === 'not_enough_referrals') toast(t('need_more_friends').replace('X', r.need-r.have));
    else if (r.error === 'not_enough_views') toast(t('need_more_ads').replace('X', r.need-r.have));
    else if (r.error === 'not_enough_pvp') toast(t('need_more_pvp').replace('X', r.need-r.have));
    else if (r.error === 'already_done') toast(t('already_done_today'));
    else toast(t('error'));
    btn.disabled = false;
  }
};

// Human check: hold button 3s every 5 ad1 watches (PRO: every 10)
function holdCaptcha() {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px';
    overlay.innerHTML = `
      <div style="color:#fff;font-size:15px;font-weight:700;text-align:center;padding:0 32px;opacity:.8">${LANG==='ru'?'Зажми кнопку 3 секунды':'Hold the button for 3 seconds'}</div>
      <div id="hcBtn" style="width:90px;height:90px;border-radius:50%;background:#1a1a1a;border:3px solid #333;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;overflow:hidden;user-select:none;-webkit-user-select:none">
        <svg style="position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg)" viewBox="0 0 90 90">
          <circle id="hcRing" cx="45" cy="45" r="41" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="258" stroke-dashoffset="258" style="transition:stroke-dashoffset .05s linear"/>
        </svg>
        <span style="font-size:28px;position:relative;z-index:1">👆</span>
      </div>
      <div id="hcX" style="color:#555;font-size:13px;cursor:pointer;padding:8px 20px">✕ ${LANG==='ru'?'Закрыть':'Close'}</div>
    `;
    document.body.appendChild(overlay);
    const btn = overlay.querySelector('#hcBtn');
    const ring = overlay.querySelector('#hcRing');
    const xBtn = overlay.querySelector('#hcX');
    let timer = null, startT = null;
    const DURATION = 3000;
    const CIRC = 258;
    function tick() {
      const elapsed = Date.now() - startT;
      const progress = Math.min(elapsed / DURATION, 1);
      ring.style.strokeDashoffset = CIRC * (1 - progress);
      if (progress >= 1) { cleanup(); resolve(); }
      else timer = requestAnimationFrame(tick);
    }
    function start(e) { e.preventDefault(); if (startT) return; startT = Date.now(); timer = requestAnimationFrame(tick); }
    function stop(e) { e.preventDefault(); if (!startT) return; cancelAnimationFrame(timer); startT = null; ring.style.strokeDashoffset = CIRC; }
    function cleanup() { cancelAnimationFrame(timer); document.body.removeChild(overlay); }
    btn.addEventListener('mousedown', start); btn.addEventListener('touchstart', start, {passive:false});
    btn.addEventListener('mouseup', stop); btn.addEventListener('mouseleave', stop);
    btn.addEventListener('touchend', stop); btn.addEventListener('touchcancel', stop);
    xBtn.addEventListener('click', () => { cleanup(); reject(); });
  });
}

window.watchAd = async (btn) => {
  if (!adsgramController) return;
  const count = ME.ad_daily_count || 0;
  const needCheck = count > 0 && count % 4 === 3;
  if (needCheck) {
    try { await holdCaptcha(); } catch { return; }
  }
  btn.disabled = true;
  try {
    await adsgramController.show();
    // Reward is credited server-to-server by Adsgram (Reward URL); give it a moment, then refresh
    setTimeout(async () => {
      const me = await api('/me');
      if (me?.balance_arc !== undefined) {
        const gained = me.balance_arc - ME.balance_arc;
        ME.balance_arc = me.balance_arc;
        ME.ad_daily_count = me.ad_daily_count;
        renderHeader();
        renderMain();
        const lim = me.is_pro ? 15 : 10;
        if (gained > 0) toast(`+${gained} ARC · ${me.ad_daily_count}/${lim}`);
        else if (me.ad_daily_count >= lim) toast(t('ad_daily_limit_n').replace('{n}', lim));
      }
      btn.disabled = false;
    }, 2500);
  } catch { btn.disabled = false; }
};

window.watchAdShort = async (btn) => {
  if (!adsgramControllerShort) return;
  const count2 = ME.ad_short_daily_count || 0;
  if (count2 > 0 && count2 % 4 === 3) {
    try { await holdCaptcha(); } catch { return; }
  }
  btn.disabled = true;
  try {
    await adsgramControllerShort.show();
    const r = await api('/ads/watch-short');
    if (r.ok) {
      ME.ad_short_daily_count = r.daily_count;
      ME.balance_arc = r.balance_arc;
      renderHeader();
      renderMain();
      toast(`+${r.reward} ARC · ${r.daily_count}/${ME.is_pro ? 5 : 3}`);
    } else if (r.error === 'daily_limit') {
      ME.ad_short_daily_count = r.daily_count;
      renderMain();
      toast(t('ad_daily_limit_short'));
    } else {
      btn.disabled = false;
    }
  } catch { btn.disabled = false; }
};

window.watchAd4 = async (btn) => {
  if (!onclickaShow4) return;
  const count4 = ME.ad4_daily_count || 0;
  if (count4 > 0 && count4 % 4 === 3) {
    try { await holdCaptcha(); } catch { return; }
  }
  btn.disabled = true;
  try {
    await onclickaShow4();
    const r = await api('/ads/watch4');
    if (r.ok) {
      ME.ad4_daily_count = r.daily_count;
      ME.balance_arc = r.balance_arc;
      renderHeader();
      renderMain();
      toast(`+${r.reward} ARC · ${r.daily_count}/${ME.is_pro ? 15 : 10}`);
    } else if (r.error === 'daily_limit') {
      ME.ad4_daily_count = r.daily_count;
      renderMain();
      toast(t('ad_daily_limit_short'));
    } else {
      btn.disabled = false;
    }
  } catch { btn.disabled = false; }
};

window.watchAd5 = async (btn) => {
  const zoneId = ME.monetag_zone_id;
  const fn = window['show_' + zoneId];
  if (!fn) return;
  const count5 = ME.ad5_daily_count || 0;
  if (count5 > 0 && count5 % 4 === 3) {
    try { await holdCaptcha(); } catch { return; }
  }
  btn.disabled = true;
  try {
    await fn();
    const r = await api('/ads/watch5');
    if (r.ok) {
      ME.ad5_daily_count = r.daily_count;
      ME.balance_arc = r.balance_arc;
      renderHeader();
      renderMain();
      toast(`+${r.reward} ARC · ${r.daily_count}/${ME.is_pro ? 10 : 5}`);
    } else if (r.error === 'daily_limit') {
      ME.ad5_daily_count = r.daily_count;
      renderMain();
      toast(t('ad_daily_limit_short'));
    } else {
      btn.disabled = false;
    }
  } catch { btn.disabled = false; }
};

window.claimChest = async (btn) => {
  btn.disabled = true;
  try {
    const r = await api('/chest/claim');
    if (r.ok) {
      ME.chest_free_claimed = true;
      ME.balance_arc = r.balance_arc;
      renderHeader();
      renderMain();
      toast(`🎁 +${r.reward} ARC`);
    } else {
      ME.chest_free_claimed = true;
      renderMain();
    }
  } catch { btn.disabled = false; }
};

window.claimChestBonus = async (btn) => {
  const zoneId = ME.monetag_zone_id;
  const fn = window['show_' + zoneId];
  if (!fn) return;
  btn.disabled = true;
  try {
    await fn();
    const r = await api('/chest/claim-bonus');
    if (r.ok) {
      ME.chest_bonus_claimed = true;
      ME.balance_arc = r.balance_arc;
      renderHeader();
      renderMain();
      toast(`💎 +${r.reward} ARC`);
    } else if (r.error === 'already_claimed') {
      ME.chest_bonus_claimed = true;
      renderMain();
    } else {
      btn.disabled = false;
    }
  } catch { btn.disabled = false; }
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
        <div class="ref-stat"><div class="rv">${totalInvited}</div><div class="rl">${t('invited_label')}</div></div>
        <div class="ref-stat"><div class="rv">${fmt(totalEarned,0)}</div><div class="rl">${t('arc_earned_label')}</div></div>
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
    const text = t('share_text');
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

function proDaysLeft() {
  if (!ME.pro_until) return 0;
  return Math.max(0, Math.ceil((new Date(ME.pro_until) - Date.now()) / 86400000));
}

window.openProModal = () => {
  const ov = document.createElement('div');
  ov.setAttribute('data-ov','1');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:600;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const benefits = [
    ['📺', t('pro_b3')],
    ['⚡', t('pro_b4')],
    ['👑','Crown in PvP — everyone sees'],
    ['🏆','Gold row in leaderboard'],
    ['💰', t('pro_b2')],
    ['🎯', t('pro_b1')],
    ['👥','Referral 25% instead of 20%'],
    ['📈', t('pro_b5')],
  ];
  const statusLine = ME.is_pro
    ? `<div style="text-align:center;margin-bottom:10px;padding:8px;border-radius:10px;background:rgba(255,214,10,.12);color:#ffd60a;font-weight:800;font-size:13px">${t('pro_status_active').replace('{d}', proDaysLeft())}</div>`
    : '';
  ov.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;padding:20px 16px 28px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:19px;font-weight:900;color:#ffd60a">👑 ARCADE PRO</div>
        <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer">✕</button>
      </div>
      ${statusLine}
      ${benefits.map(b => `<div style="display:flex;gap:10px;align-items:center;padding:8px 4px;font-size:14px"><span>${b[0]}</span><span>${b[1]}</span></div>`).join('')}
      <button class="btn btn-blue" style="margin-top:14px" onclick="buyPro(this)">
        ${ME.is_pro ? t('pro_btn_extend') : t('pro_btn_buy')}
      </button>
      <div style="text-align:center;margin-top:8px;font-size:12px;color:var(--muted2)">${t('pro_ton_balance')} · ${fmt(ME.balance_ton,2)} TON</div>
    </div>`;
  document.body.appendChild(ov);
};

window.buyPro = async (btn) => {
  btn.disabled = true;
  const r = await api('/pro/buy');
  if (r.ok) {
    ME.is_pro = true;
    ME.pro_until = r.pro_until;
    ME.balance_ton = r.balance_ton;
    document.querySelectorAll('[data-ov]').forEach(o => o.remove());
    renderHeader();
    if (currentTab === 'main') renderMain();
    if (currentTab === 'profile') renderProfile();
    toast(t('pro_activated').replace('{d}', proDaysLeft()));
  } else if (r.error === 'not_enough_ton') {
    btn.disabled = false;
    toast(t('not_enough_ton'));
    document.querySelectorAll('[data-ov]').forEach(o => o.remove());
    openDeposit();
  } else {
    btn.disabled = false;
    toast(t('error'));
  }
};

function renderProfile() {
  const el = document.getElementById('page-profile');
  const walletBlock = ME.wallet
    ? `<div class="wallet-row">
        <div class="wallet-icon">💼</div>
        <div class="wallet-info">
          <div class="wallet-addr">${shortWallet(ME.wallet)}</div>
          <div class="wallet-status">● ${t('wallet_connected_status')}</div>
        </div>
        <button class="btn btn-sm btn-dark" onclick="disconnectWallet()">${t('disconnect')}</button>
       </div>`
    : `<button class="btn btn-blue" style="margin-bottom:10px" id="connectBtn">${t('connect_wallet')}</button>`;
  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar" id="profileAvatar"></div>
      <div class="profile-name">${ME.username ? '@' + ME.username : ME.first_name}${ME.is_pro ? ' <span style="color:#ffd60a">👑</span>' : ''}</div>
      <div class="profile-stats">
        <div class="profile-stat"><div class="pv">${fmt(ME.balance_ton, 2)}</div><div class="pl">TON</div></div>
        <div class="profile-stat"><div class="pv">${fmt(ME.balance_arc, 0)}</div><div class="pl">ARC</div></div>
        <div class="profile-stat"><div class="pv">×${ME.is_pro || ME.checkin_day >= 6 ? '1.5' : Math.max(1.0, 1 + ((ME.checkin_day||1) - 1) * 0.1).toFixed(1)}</div><div class="pl">Множитель</div></div>
      </div>
    </div>
    <div onclick="openProModal()" style="cursor:pointer;margin-bottom:10px;padding:13px 16px;border-radius:14px;background:linear-gradient(135deg,#3a2d00,#1a1a1a);border:1px solid #ffd60a55;display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-size:14px;font-weight:900;color:#ffd60a">👑 ARCADE PRO</div>
        <div style="font-size:12px;color:#ccc;margin-top:2px">${ME.is_pro
          ? t('pro_active_days').replace('{d}', proDaysLeft())
          : t('pro_mini_buy')}</div>
      </div>
      <span style="color:#ffd60a;font-size:18px">›</span>
    </div>
    ${walletBlock}
    <div class="block">
      <div class="block-hdr">${t('ops_title')}</div>
      <button class="op-row" id="depBtn">
        <span class="op-row-ic">💎</span>
        <span class="op-row-txt"><span class="op-row-t">${t('deposit')}</span><span class="op-row-s">${t('ops_deposit_sub')}</span></span>
        <span class="op-row-arrow">›</span>
      </button>
      <button class="op-row" id="wdBtn">
        <span class="op-row-ic">💸</span>
        <span class="op-row-txt"><span class="op-row-t">${t('withdraw')}</span><span class="op-row-s">${t('ops_withdraw_sub')}</span></span>
        <span class="op-row-arrow">›</span>
      </button>
      <button class="op-row" id="exBtn">
        <span class="op-row-ic">🔄</span>
        <span class="op-row-txt"><span class="op-row-t">${t('exchange_ton_arc')}</span><span class="op-row-s">${t('ops_exchange_sub')}</span></span>
        <span class="op-row-arrow">›</span>
      </button>
      <div class="op-row op-row-soon">
        <span class="op-row-ic">🔁</span>
        <span class="op-row-txt"><span class="op-row-t">${t('exchange_arc_ton')}</span><span class="op-row-s">${t('ops_exchange_arc_sub')}</span></span>
        <span class="tag tag-soon">${t('soon')}</span>
      </div>
    </div>
    <button class="op-row" id="lbBtn">
      <span class="op-row-ic">🏆</span>
      <span class="op-row-txt"><span class="op-row-t">${t('leaderboard_title')}</span><span class="op-row-s">${t('lb_subtitle')}</span></span>
      <span class="op-row-arrow">›</span>
    </button>
    <button class="op-row" id="histBtn">
      <span class="op-row-ic">📋</span>
      <span class="op-row-txt"><span class="op-row-t">${t('history_title')}</span><span class="op-row-s">${t('history_subtitle')}</span></span>
      <span class="op-row-arrow">›</span>
    </button>`;
  applyAvatar(document.getElementById('profileAvatar'));
  const conn = document.getElementById('connectBtn');
  if (conn) conn.onclick = () => tonConnectUI && tonConnectUI.openModal();
  document.getElementById('depBtn').onclick = openDeposit;
  document.getElementById('wdBtn').onclick = openWithdraw;
  document.getElementById('exBtn').onclick = openExchange;
  document.getElementById('lbBtn').onclick = openLeaderboard;
  document.getElementById('histBtn').onclick = openTxHistory;
}

window.setPvpSub = function(tab) {
  pvpSubTab = tab;
  const rs = document.getElementById('pvpRouletteSection');
  const ls = document.getElementById('pvpLotterySection');
  if (rs) rs.hidden = (tab !== 'roulette');
  if (ls) ls.hidden = (tab !== 'lottery');
  document.querySelectorAll('.pvp-subtab-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === tab));
  if (tab === 'lottery') loadLottery();
  else loadPvP();
};

function renderPvP() {
  const el = document.getElementById('page-pvp');
  el.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:14px">
      <button class="pvp-subtab-btn${pvpSubTab==='roulette'?' active':''}" data-sub="roulette" onclick="setPvpSub('roulette')">⚔️ ${t('roulette_tab')}</button>
      <button class="pvp-subtab-btn${pvpSubTab==='lottery'?' active':''}" data-sub="lottery" onclick="setPvpSub('lottery')">🎟 ${t('lottery_tab')}</button>
    </div>

    <div id="pvpRouletteSection" ${pvpSubTab!=='roulette'?'hidden':''}>
      <div class="pvp-top">
        <div class="pvp-logo">
          <span class="pvp-logo-icon">⚔️</span>
          <span class="pvp-logo-text">PvP</span>
          <span class="pvp-round" id="roundLabel">${t('round')} #—</span>
        </div>
        <button class="pvp-info-btn" onclick="openPvpAbout()"><span class="pvp-info-i">ⓘ</span> ${t('pvp_about_title')}</button>
      </div>
      <div id="specialBanner" style="display:none;margin:0 0 10px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#3a2d00,#1a1a1a);border:1px solid #ffd60a55;text-align:center">
        <div style="font-size:15px;font-weight:900;color:#ffd60a">⚡ ${t('pvp_special_title')}</div>
        <div style="font-size:12px;color:#ccc;margin-top:4px">${t('pvp_special_hint')}</div>
      </div>
      <div class="pvp-banks">
        <div class="pvp-bank-side">
          <div class="pvp-bank-lbl">${t('pvp_bank')}</div>
          <div class="pvp-bank-val"><span id="potVal">0</span> ARC</div>
        </div>
        <div class="pvp-bank-side" style="text-align:right">
          <div class="pvp-bank-lbl">${t('pvp_mybal')}</div>
          <div class="pvp-mybal-val" id="pvpMyBal">${fmt(ME?.balance_arc ?? 0, 0)} ARC</div>
        </div>
      </div>
      <div class="wheel-wrap">
        <div class="wheel-pointer"></div>
        <div class="wheel" id="wheel"></div>
        <div id="wheelAvatars" style="position:absolute;inset:0;pointer-events:none;z-index:3;"></div>
        <div class="wheel-center" id="wheelCenter">${t('waiting')}</div>
      </div>
      <div class="pvp-input-row">
        <input class="pvp-input" id="betInput" type="number" min="10" max="2000" placeholder="0 ARC" />
        <button class="pvp-bet-btn" id="addBetBtn">+ ${t('add_bet')}</button>
      </div>
      <div class="pvp-amts">
        <div class="pvp-amt" onclick="setBet(10)">10</div>
        <div class="pvp-amt" onclick="setBet(50)">50</div>
        <div class="pvp-amt" onclick="setBet(100)">100</div>
        <div class="pvp-amt" onclick="setBet(500)">500</div>
      </div>
      <div class="pvp-section-lbl"><span>${t('pvp_participants')}</span></div>
      <div id="playersList"></div>
      <div class="hash" id="hashLine"></div>
      <button class="btn btn-dark" style="margin-top:12px;width:100%" onclick="openPvPHistory()">📋 ${t('pvp_history_btn')}</button>
      <div id="winnerOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:32px">
        <div style="font-size:56px">🏆</div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px">${t('pvp_winner_title')}</div>
        <div id="woUsername" style="font-size:28px;font-weight:900;color:#fff"></div>
        <div id="woChance" style="font-size:14px;color:var(--muted2);margin-top:-4px"></div>
        <div id="woPrize" style="font-size:40px;font-weight:900;color:#ffd60a;margin-top:4px"></div>
      </div>
    </div>

    <div id="pvpLotterySection" ${pvpSubTab!=='lottery'?'hidden':''}>
      <div class="pvp-top">
        <div class="pvp-logo">
          <span class="pvp-logo-icon">🎟</span>
          <span class="pvp-logo-text">${t('lottery_tab')}</span>
          <span class="pvp-round" id="lotteryRoundLabel">${t('lottery_round_prefix')} #—</span>
        </div>
      </div>
      <div style="text-align:center;padding:6px 0 12px;font-size:13px;color:var(--muted2)">
        ${t('lottery_prize_7d')} &nbsp;·&nbsp; ${t('lottery_ticket_arc')}
      </div>
      <div id="lotterySlots" style="display:flex;gap:6px;margin-bottom:10px;justify-content:center"></div>
      <div id="lotteryStatusLine" style="text-align:center;font-size:13px;color:var(--muted2);margin-bottom:14px;min-height:20px"></div>
      <div id="lotteryBuyArea"></div>
      <div id="lotteryLastWinner" style="display:none;margin-bottom:12px;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#3a2d00,#1a1a1a);border:1px solid #ffd60a55;text-align:center"></div>
      <div class="hash" id="lotteryHash" style="margin-top:0"></div>
      <button class="btn btn-dark" style="margin-top:12px;width:100%" onclick="openLotteryHistory()">📋 ${t('lottery_history_btn')}</button>
      <div id="lotteryWinnerOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:32px">
        <div style="font-size:56px">🎟</div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:1.2px">${t('pvp_winner_title')} ${t('lottery_tab').toUpperCase()}</div>
        <div id="lwUsername" style="font-size:28px;font-weight:900;color:#ffd60a"></div>
        <div style="font-size:15px;color:#fff;margin-top:4px">👑 PRO на 7 дней!</div>
      </div>
    </div>

    <div id="pvpAboutOverlay" class="pvp-about-overlay" onclick="if(event.target===this)closePvpAbout()">
      <div class="pvp-about-sheet">
        <div class="pvp-about-head">
          <span class="pvp-about-title">${t('pvp_about_title')}</span>
          <span class="pvp-about-x" onclick="closePvpAbout()">✕</span>
        </div>
        <div class="pvp-about-how">
          <div class="pvp-about-how-t">🎮 ${t('pvp_how_title')}</div>
          <div class="pvp-about-how-d">${t('pvp_how_text')}</div>
        </div>
        <div class="pvp-about-rules">
          ${[['📥',1],['👥',2],['⏱',3],['📊',4],['🔒',5],['🏆',6]].map(([ic,n])=>`
            <div class="pvp-about-rule">
              <div class="pvp-about-rule-ic">${ic}</div>
              <div class="pvp-about-rule-tx">
                <div class="pvp-about-rule-t">${t('pvp_r'+n+'_t')}</div>
                <div class="pvp-about-rule-d">${t('pvp_r'+n+'_d')}</div>
              </div>
            </div>`).join('')}
        </div>
        <button class="btn btn-blue" style="margin-top:6px" onclick="closePvpAbout()">${t('pvp_about_ok')}</button>
      </div>
    </div>`;

  document.getElementById('addBetBtn').onclick = doBet;
  relocateOverlay('pvpAboutOverlay');
  if (pvpSubTab === 'roulette') loadPvP();
  else loadLottery();
  pvpTimer = setInterval(() => {
    if (pvpSubTab === 'roulette') loadPvP();
    else loadLottery();
  }, 1500);
}

window.openPvpAbout = () => {
  const ov = document.getElementById('pvpAboutOverlay');
  if (!ov) return;
  const sheet = ov.querySelector('.pvp-about-sheet');
  if (sheet) sheet.scrollTop = 0;
  ov.classList.add('show');
  ov.addEventListener('touchmove', _lockBg, { passive: false });
};
window.closePvpAbout = () => {
  const ov = document.getElementById('pvpAboutOverlay');
  if (!ov) return;
  ov.classList.remove('show');
  ov.removeEventListener('touchmove', _lockBg);
};

window.openPvPHistory = async () => {
  const ov = document.createElement('div');
  ov.setAttribute('data-ov','1'); ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">📋 ${t('pvp_history_title')}</div>
      <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div id="pvpHistContent" style="flex:1;overflow-y:auto;padding:12px 16px">
      <div class="pvp-empty">${t('loading')}</div>
    </div>`;
  document.body.appendChild(ov);
  const data = await api('/pvp/history');
  const el = ov.querySelector('#pvpHistContent');
  if (!data.length) { el.innerHTML = `<div class="pvp-empty" style="padding:20px">${t('pvp_empty')}</div>`; return; }
  el.innerHTML = data.map(g => `
    <div class="player-card" style="justify-content:space-between;margin-bottom:6px;cursor:pointer" onclick="openRoundDetails(${g.round_no})">
      <span style="color:var(--muted2);font-size:12px;min-width:36px">#${g.round_no}</span>
      <span class="pname" style="flex:1">@${g.winner}</span>
      <span style="color:var(--muted2);font-size:12px;margin-right:8px">${g.chance}%</span>
      <span style="color:#ffd60a;font-weight:700">+${fmt(Number(g.prize),0)} ARC</span>
      <span style="color:var(--muted2);font-size:14px;margin-left:6px">›</span>
    </div>`).join('');
};

window.openRoundDetails = async (roundNo) => {
  const ov = document.createElement('div');
  ov.setAttribute('data-ov','1');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:600;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:80vh;overflow-y:auto;padding:20px 16px 28px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:17px;font-weight:900">🎰 ${t('pvp_round_prefix')} #${roundNo}</div>
        <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer">✕</button>
      </div>
      <div id="rdContent"><div class="pvp-empty" style="padding:16px">${t('loading')}</div></div>
    </div>`;
  document.body.appendChild(ov);

  const r = await api('/pvp/round', { round_no: roundNo });
  const el = ov.querySelector('#rdContent');
  if (!el) return;
  if (!r.ok) { el.innerHTML = `<div class="pvp-empty" style="padding:16px">${t('pvp_not_found')}</div>`; return; }

  // MSK time = UTC+3
  const d = new Date(new Date(r.finished_at).getTime() + 3 * 3600 * 1000);
  const dateStr = d.toISOString().slice(0, 10).split('-').reverse().join('.');
  const timeStr = d.toISOString().slice(11, 16);

  const rows = r.players.map(p => {
    const name = p.username ? '@' + p.username : (p.first_name || '...');
    return `
    <div class="player-card" style="justify-content:space-between;margin-bottom:6px${p.is_winner ? ';border:1px solid #ffd60a' : ''}">
      <span style="font-size:15px;min-width:26px">${p.is_winner ? '🏆' : '·'}</span>
      <span class="pname" style="flex:1">${name}</span>
      <span style="color:var(--muted2);font-size:12px;margin-right:8px">${p.chance}%</span>
      <span style="color:${p.is_winner ? '#ffd60a' : 'var(--muted2)'};font-weight:700">${fmt(p.amount,0)} ARC</span>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div style="background:#0a0a0a;border-radius:14px;padding:12px 14px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px 18px;font-size:13px">
      <div><span style="color:var(--muted2)">${t('pvp_pot')}:</span> <b style="color:#ffd60a">${fmt(r.pot,0)} ARC</b></div>
      <div><span style="color:var(--muted2)">${t('pvp_prize')}:</span> <b style="color:#ffd60a">${fmt(r.prize,0)} ARC</b></div>
      <div><span style="color:var(--muted2)">${t('pvp_fee')}:</span> <b>${fmt(r.commission,0)} ARC</b></div>
      <div><span style="color:var(--muted2)">${t('pvp_date')}:</span> <b>${dateStr} ${timeStr} МСК</b></div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">${t('pvp_participants')} (${r.players.length})</div>
    ${rows}
    <div style="margin-top:14px;background:#0a0a0a;border-radius:12px;padding:10px 12px">
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">${t('provably_fair')}</div>
      <div style="font-size:11px;color:var(--muted2);word-break:break-all;line-height:1.6">
        <span style="color:var(--muted)">Hash:</span> ${r.seed_hash || '—'}<br>
        <span style="color:var(--muted)">Seed:</span> ${r.server_seed || '—'}<br>
        <span style="color:var(--muted)">Roll:</span> ${r.result_roll ? Number(r.result_roll).toFixed(10) : '—'}
      </div>
    </div>`;
};

window.setBet = (v) => {
  const inp = document.getElementById('betInput');
  if (inp) inp.value = v;
};


async function doBet() {
  const amount = Number(document.getElementById('betInput')?.value);
  const maxBet = ME.is_pro ? 2000 : 1000;
  if (!(amount >= 10 && amount <= maxBet)) return toast(t('pvp_min_max'));
  const r = await api('/pvp/bet', { amount });
  if (r.ok) { ME.balance_arc = r.balance_arc; renderHeader(); loadPvP(); }
  else if (r.error === 'not_enough') toast(t('not_enough'));
  else if (r.error === 'max_players') toast(t('pvp_max_players_msg'));
  else if (r.error === 'round_closed') toast(t('pvp_round_closed'));
  else if (r.error === 'limit_total') toast(`${t('limit_total_msg')} ${maxBet} ARC`);
  else toast(t('error'));
}

async function loadPvP() {
  const s = await api('/pvp/state');
  const roundEl = document.getElementById('roundLabel');
  if (roundEl) roundEl.textContent = `${t('round')} #${s.roundNo}`;
  const potEl = document.getElementById('potVal');
  if (potEl) potEl.textContent = fmt(s.pot, 0);
  const banner = document.getElementById('specialBanner');
  if (banner) banner.style.display = s.special ? 'block' : 'none';
  const center = document.getElementById('wheelCenter');
  if (center) {
    if (s.status === 'counting' && s.secondsLeft != null) {
      const m = Math.floor(s.secondsLeft / 60), sec = s.secondsLeft % 60;
      center.textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }
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
      ? s.players.map(p => {
          const g = AVATAR_GRADIENTS[Math.abs(Number(p.tg_id || 0)) % AVATAR_GRADIENTS.length];
          const letter = (p.first_name || p.username || '?')[0].toUpperCase();
          return `<div class="player-card"${p.pro ? ' style="border:1px solid #ffd60a55"' : ''}>
            <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,${g[0]},${g[1]});color:#fff;font-size:15px;font-weight:700;display:flex;align-items:center;justify-content:center;overflow:visible;flex-shrink:0;position:relative;margin-right:10px">
              <span>${letter}</span>
              <img src="/api/avatar/${p.tg_id}" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%">
              ${p.pro ? '<span onclick="openProModal()" style="position:absolute;top:-11px;left:50%;transform:translateX(-50%);font-size:13px;cursor:pointer;z-index:2">👑</span>' : ''}
            </div>
            <span class="pname" style="flex:1">@${p.username || '...'}</span>
            <span class="pchance">${p.chance}% · ${fmt(p.amount,0)} ARC</span>
          </div>`;
        }).join('')
      : `<div class="pvp-empty">${t('pvp_empty')}</div>`;
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

let pvpSubTab = 'roulette';
let lotteryAnimTriggered = false;
let prevLotteryRoundNo = null;
let prevLotteryStatus = null;

function buildWheelGradient(players) {
  let acc = 0; const stops = [];
  players.forEach((p, i) => {
    const start = acc; acc += Number(p.chance);
    stops.push(`${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${start}% ${acc}%`);
  });
  return `conic-gradient(${stops.join(',')})`;
}

function drawWheelAvatars(players, rotDeg) {
  const el = document.getElementById('wheelAvatars');
  if (!el) return;
  if (!players.length) { el.innerHTML = ''; el.style.transform = ''; return; }
  const cx = 140, cy = 140, r = 90, sz = 36;
  let acc = 0;
  el.innerHTML = players.map(p => {
    const start = acc;
    const chunk = Number(p.chance);
    acc += chunk;
    const mid_deg = (start + chunk / 2) * 3.6;
    const mid_rad = mid_deg * Math.PI / 180;
    const x = Math.round(cx + r * Math.sin(mid_rad));
    const y = Math.round(cy - r * Math.cos(mid_rad));
    const g = AVATAR_GRADIENTS[Math.abs(Number(p.tg_id || 0)) % AVATAR_GRADIENTS.length];
    const letter = (p.first_name || p.username || '?')[0].toUpperCase();
    return `<div style="position:absolute;left:${x - sz/2}px;top:${y - sz/2}px;width:${sz}px;height:${sz}px;border-radius:50%;background:linear-gradient(135deg,${g[0]},${g[1]});color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid rgba(0,0,0,.45);box-shadow:0 2px 6px rgba(0,0,0,.5)">
      <span>${letter}</span>
      <img src="/api/avatar/${p.tg_id}" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%">
      ${p.pro ? `<span style="position:absolute;top:-13px;left:50%;transform:translateX(-50%);font-size:12px">👑</span>` : ''}
    </div>`;
  }).join('');
  el.style.transition = 'none';
  el.style.transform = rotDeg != null ? `rotate(${rotDeg}deg)` : '';
}

function drawWheel(players) {
  const wheel = document.getElementById('wheel');
  if (!wheel) return;
  wheel.style.transition = 'none';
  wheel.style.transform = '';
  if (!players.length) {
    wheel.style.background = WHEEL_EMPTY;
    wheel.classList.add('idle');
    drawWheelAvatars([]);
    return;
  }
  wheel.classList.remove('idle');
  wheel.style.background = buildWheelGradient(players);
  drawWheelAvatars(players);
}

function showWinnerOverlay(winner) {
  const ov = document.getElementById('winnerOverlay');
  if (!ov) return;
  document.getElementById('woUsername').textContent = '@' + (winner.username || '...');
  document.getElementById('woChance').textContent = winner.chance + t('pvp_win_chance');
  document.getElementById('woPrize').textContent = '+' + parseFloat(winner.prize).toLocaleString() + ' ARC';
  ov.style.display = 'flex';
  setTimeout(() => { ov.style.display = 'none'; }, 3000);
}

function spinWheel(players, roll) {
  const wheel = document.getElementById('wheel');
  const ava = document.getElementById('wheelAvatars');
  if (!wheel) return;
  wheel.classList.remove('idle');
  wheel.style.background = buildWheelGradient(players);
  drawWheelAvatars(players);
  wheel.style.transition = 'none';
  wheel.style.transform = 'rotate(0deg)';
  if (ava) { ava.style.transition = 'none'; ava.style.transform = 'rotate(0deg)'; }
  wheel.getBoundingClientRect();
  const finalAngle = 360 * (7 - roll);
  wheel.style.transition = '';
  wheel.style.transform = `rotate(${finalAngle}deg)`;
  if (ava) {
    ava.style.transition = 'transform 4s cubic-bezier(.17,.67,.2,1)';
    ava.style.transform = `rotate(${finalAngle}deg)`;
  }
}

function buildLotterySlotHTML(ticket, index, activeIndex) {
  const isEmpty = !ticket;
  const isActive = index === activeIndex;
  const g = ticket ? AVATAR_GRADIENTS[Math.abs(Number(ticket.tg_id || 0)) % AVATAR_GRADIENTS.length] : null;
  const letter = ticket ? (ticket.first_name || ticket.username || '?')[0].toUpperCase() : '?';
  return `<div class="lottery-slot${isActive?' lottery-slot-active':''}${!isEmpty?' filled':''}" id="lotterySlot${index}">
    <div class="lottery-slot-avatar" ${g?`style="background:linear-gradient(135deg,${g[0]},${g[1]})"`:''}">
      ${isEmpty
        ? `<span style="color:var(--muted);font-size:18px">?</span>`
        : `<span>${letter}</span><img src="/api/avatar/${ticket.tg_id}" onerror="this.remove()" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%">`}
    </div>
    <div class="lottery-slot-name">${isEmpty ? t('slot_empty') : ('@'+(ticket.username||'...'))}</div>
  </div>`;
}

async function loadLottery() {
  const s = await api('/lottery/state');
  if (!s || !document.getElementById('lotterySlots')) return;

  if (s.roundNo !== prevLotteryRoundNo) {
    lotteryAnimTriggered = false;
    prevLotteryRoundNo = s.roundNo;
  }

  const rl = document.getElementById('lotteryRoundLabel');
  if (rl) rl.textContent = `${t('lottery_round_prefix')} #${s.roundNo}`;

  // Render slots (don't touch during animation)
  if (!lotteryAnimTriggered || s.status === 'open') {
    const slotsEl = document.getElementById('lotterySlots');
    if (slotsEl) {
      const showActive = (s.status === 'done' && s.winnerIndex != null) ? s.winnerIndex : -1;
      const html = Array.from({ length: s.maxPlayers }, (_, i) => {
        const ticket = s.tickets[i] || null;
        return buildLotterySlotHTML(ticket, i, showActive);
      }).join('');
      slotsEl.innerHTML = html;
    }
  }

  // Status line
  const sl = document.getElementById('lotteryStatusLine');
  if (sl) {
    if (s.status === 'open') {
      sl.textContent = `${s.tickets.length} / ${s.maxPlayers} ${t('lottery_players_of')}`;
    } else if (s.status === 'spinning') {
      sl.textContent = t('lottery_spinning');
    } else if (s.status === 'done' && s.winner) {
      sl.innerHTML = `🏆 ${t('lottery_winner_label')}: <b style="color:#ffd60a">@${s.winner.username||'...'}</b> — 👑 PRO!`;
    }
  }

  // Buy button area
  const buyArea = document.getElementById('lotteryBuyArea');
  if (buyArea) {
    const alreadyIn = s.tickets.some(tk => tk.tg_id === ME.tg_id);
    if (s.status === 'open') {
      if (alreadyIn) {
        buyArea.innerHTML = `<div style="text-align:center;padding:12px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:13px;color:var(--green);font-weight:700;font-size:14px">
          ${t('lottery_already_in')} — ${t('lottery_wait_more')} ${s.maxPlayers - s.tickets.length}
        </div>`;
      } else {
        buyArea.innerHTML = `<button class="btn btn-blue" id="lotteryBuyBtn" onclick="doLotteryBuy(this)">
          🎟 ${t('lottery_buy_btn')}
        </button>
        <div style="text-align:center;margin-top:6px;font-size:12px;color:var(--muted2)">
          ${t('balance')}: ${fmt(ME.balance_arc,0)} ARC · ${t('chance')}: 20%
        </div>`;
      }
    } else if (s.status === 'spinning') {
      buyArea.innerHTML = `<div style="text-align:center;padding:12px;background:rgba(255,214,10,.08);border:1px solid #ffd60a55;border-radius:13px;color:#ffd60a;font-weight:700;font-size:14px">
        ${t('lottery_spinning')}
      </div>`;
    } else {
      buyArea.innerHTML = `<div style="text-align:center;padding:12px;background:rgba(255,214,10,.08);border:1px solid #ffd60a55;border-radius:13px;color:#ffd60a;font-weight:700;font-size:14px">
        ✨ ${t('lottery_new_round')}
      </div>`;
    }
  }

  // Hash line
  const hl = document.getElementById('lotteryHash');
  if (hl) {
    if (s.status === 'done' && s.serverSeed) {
      hl.innerHTML = `<span style="color:var(--muted)">Seed:</span> ${s.serverSeed.slice(0,12)}... · <span style="color:var(--muted)">Roll:</span> ${Number(s.roll).toFixed(10)}`;
    } else if (s.seedHash) {
      hl.innerHTML = `🔒 ${s.seedHash.slice(0,8)}...${s.seedHash.slice(-6)}`;
    }
  }

  // Trigger animation on status change to spinning/done
  if (!lotteryAnimTriggered && (s.status === 'spinning' || s.status === 'done') && s.winnerIndex != null) {
    lotteryAnimTriggered = true;
    animateLotterySlots(s.tickets, s.winnerIndex, () => {
      if (s.winner) showLotteryWinnerOverlay(s.winner);
    });
  }

  prevLotteryStatus = s.status;
}

window.doLotteryBuy = async (btn) => {
  btn.disabled = true;
  const r = await api('/lottery/buy');
  if (r.ok) {
    ME.balance_arc = r.balance_arc;
    renderHeader();
    toast(t('ticket_bought'));
    loadLottery();
  } else if (r.error === 'not_enough') {
    toast(t('not_enough'));
    btn.disabled = false;
  } else if (r.error === 'already_in') {
    toast(t('lottery_already_in'));
    btn.disabled = false;
  } else if (r.error === 'round_closed') {
    toast(t('lottery_spinning'));
    btn.disabled = false;
  } else {
    toast(t('error'));
    btn.disabled = false;
  }
};

function animateLotterySlots(tickets, winnerIndex, onDone) {
  const TOTAL_PASSES = 3;
  const TOTAL_STEPS = TOTAL_PASSES * 5 + winnerIndex + 1;
  let step = 0;

  const tick = () => {
    const pos = step % 5;
    for (let i = 0; i < 5; i++) {
      const el = document.getElementById('lotterySlot' + i);
      if (!el) return onDone && onDone();
      el.classList.toggle('lottery-slot-active', i === pos);
    }
    step++;
    if (step >= TOTAL_STEPS) {
      onDone && onDone();
      return;
    }
    const stepsLeft = TOTAL_STEPS - step;
    const delay = stepsLeft > 6 ? 90 : 90 + (7 - stepsLeft) * 65;
    setTimeout(tick, delay);
  };

  // Pre-render all slots so they're available for animation
  const slotsEl = document.getElementById('lotterySlots');
  if (slotsEl && tickets.length > 0) {
    slotsEl.innerHTML = Array.from({ length: 5 }, (_, i) =>
      buildLotterySlotHTML(tickets[i] || null, i, -1)
    ).join('');
  }
  tick();
}

function showLotteryWinnerOverlay(winner) {
  const ov = document.getElementById('lotteryWinnerOverlay');
  if (!ov) return;
  const userEl = document.getElementById('lwUsername');
  if (userEl) userEl.textContent = '@' + (winner.username || '...');
  ov.style.display = 'flex';
  setTimeout(() => { ov.style.display = 'none'; }, 4000);
}

window.openLotteryHistory = async () => {
  const ov = document.createElement('div');
  ov.setAttribute('data-ov','1');
  ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">🎟 ${t('lottery_history_title')}</div>
      <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div id="lhContent" style="flex:1;overflow-y:auto;padding:12px 16px 24px">
      <div class="pvp-empty">${t('loading')}</div>
    </div>`;
  document.body.appendChild(ov);
  const data = await api('/lottery/history');
  const el = ov.querySelector('#lhContent');
  if (!data.length) { el.innerHTML = `<div class="pvp-empty" style="padding:20px">${t('lottery_empty')}</div>`; return; }
  el.innerHTML = data.map(r => {
    const d = new Date(new Date(r.time).getTime() + 3*3600*1000);
    const dateStr = d.toISOString().slice(0,10).split('-').reverse().join('.');
    const timeStr = d.toISOString().slice(11,16);
    const ticketRows = (r.tickets||[]).map((tk, i) => {
      const isW = tk.tg_id === r.winner_tg_id;
      return `<span style="font-size:12px;color:${isW?'#ffd60a':'var(--muted2)'};font-weight:${isW?'800':'400'}">@${tk.username||'...'}${isW?' 🏆':''}</span>`;
    }).join(' · ');
    return `
    <div style="background:var(--card2);border:1px solid var(--line);border-radius:13px;padding:12px 14px;margin-bottom:8px;cursor:pointer" onclick="openLotteryRoundDetails(${JSON.stringify(r).replace(/"/g,'&quot;')})">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="color:var(--muted2);font-size:12px">#${r.round_no}</span>
        <span style="color:var(--muted2);font-size:11px">${dateStr} ${timeStr} МСК</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="font-size:14px;font-weight:800;color:#ffd60a">🏆 @${r.winner}</span>
        <span style="font-size:12px;color:#ffd60a">👑 PRO 7д</span>
      </div>
      <div style="margin-top:4px">${ticketRows}</div>
    </div>`;
  }).join('');
};

window.openLotteryRoundDetails = (r) => {
  const ov = document.createElement('div');
  ov.setAttribute('data-ov','1');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:600;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  const ticketRows = (r.tickets||[]).map((tk, i) => {
    const isW = tk.tg_id === r.winner_tg_id;
    return `<div class="player-card" style="justify-content:space-between;margin-bottom:6px${isW?';border:1px solid #ffd60a':''}">
      <span style="font-size:15px;min-width:26px">${isW?'🏆':'·'}</span>
      <span class="pname" style="flex:1">${tk.username?'@'+tk.username:'...'}</span>
      <span style="color:${isW?'#ffd60a':'var(--muted2)'};font-weight:700">${t('lottery_slot_label')} ${i+1}</span>
    </div>`;
  }).join('');
  ov.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;width:100%;max-width:520px;max-height:80vh;overflow-y:auto;padding:20px 16px 28px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:17px;font-weight:900">🎟 ${t('lottery_round_label')} #${r.round_no}</div>
        <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer">✕</button>
      </div>
      <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">Участники (${r.tickets.length})</div>
      ${ticketRows}
      <div style="margin-top:14px;background:#0a0a0a;border-radius:12px;padding:10px 12px">
        <div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">${t('provably_fair')}</div>
        <div style="font-size:11px;color:var(--muted2);word-break:break-all;line-height:1.6">
          <span style="color:var(--muted)">Hash:</span> ${r.seed_hash||'—'}<br>
          <span style="color:var(--muted)">Seed:</span> ${r.server_seed||'—'}<br>
          <span style="color:var(--muted)">Roll:</span> ${r.result_roll?Number(r.result_roll).toFixed(10):'—'}<br>
          <span style="color:var(--muted)">Winner index:</span> ${r.winner_index != null ? r.winner_index : '—'}
        </div>
      </div>
    </div>`;
  document.body.appendChild(ov);
};

document.getElementById('langBtn').onclick = () => openLangPicker();

function openLangPicker() {
  const langs = [
    { code: 'ru', name: 'Русский', flag: '🇷🇺' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'hi', name: 'हिंदी', flag: '🇮🇳' },
    { code: 'pt', name: 'Português', flag: '🇧🇷' },
    { code: 'id', name: 'Bahasa ID', flag: '🇮🇩' },
    { code: 'bn', name: 'বাংলা', flag: '🇧🇩' },
    { code: 'vi', name: 'Tiếng Việt', flag: '🇻🇳' },
  ];
  const ov = document.createElement('div');
  ov.setAttribute('data-ov','1');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:600;display:flex;align-items:flex-end;justify-content:center';
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  ov.innerHTML = `
    <div style="background:#111;border-radius:20px 20px 0 0;width:100%;max-width:520px;padding:20px 16px 28px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:16px;font-weight:900">🌐 Language</div>
        <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:30px;height:30px;font-size:16px;cursor:pointer">✕</button>
      </div>
      ${langs.map(l => `
        <div onclick="setLang('${l.code}',this.closest('[data-ov]'))" style="display:flex;align-items:center;gap:12px;padding:13px 14px;border-radius:13px;background:${LANG===l.code?'rgba(255,255,255,.1)':'#1a1a1a'};border:1px solid ${LANG===l.code?'var(--gold)':'transparent'};margin-bottom:7px;cursor:pointer">
          <span style="font-size:22px">${l.flag}</span>
          <span style="font-weight:700;font-size:15px">${l.name}</span>
          ${LANG===l.code?'<span style="margin-left:auto;color:var(--gold);font-size:18px">✓</span>':''}
        </div>`).join('')}
    </div>`;
  document.body.appendChild(ov);
}

window.setLang = async (code, ov) => {
  LANG = code;
  if (ov) ov.remove();
  await api('/language', { language: code });
  document.getElementById('langBtn').textContent = code.toUpperCase();
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
  ov.setAttribute('data-ov','1'); ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">📋 ${t('history_title')}</div>
      <button onclick="this.closest('[data-ov]').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div id="txContent" style="flex:1;overflow-y:auto;padding:12px 16px 24px"><div class="pvp-empty">${t('loading')}</div></div>`;
  document.body.appendChild(ov);
  const all = await api('/transactions/history');
  const content = document.getElementById('txContent');
  if (!content) return;
  if (!all.length) { content.innerHTML = `<div class="pvp-empty" style="padding:20px">${t('no_transactions')}</div>`; return; }
  const typeIcon = { deposit: '💎', withdraw: '💸', exchange: '🔄' };
  const typeLabel = { deposit: t('tx_deposit'), withdraw: t('tx_withdraw'), exchange: t('tx_exchange') };
  content.innerHTML = all.map(tx => {
    const pos = Number(tx.amount) >= 0;
    const color = pos ? '#22c55e' : '#ef4444';
    const sign = pos ? '+' : '';
    return `<div class="player-card" style="flex-direction:column;align-items:flex-start;gap:2px;margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;width:100%">
        <span style="color:${color};font-weight:700;font-size:15px">${sign}${fmt(Math.abs(Number(tx.amount)),4)} ${tx.currency}</span>
        <span style="color:var(--muted2);font-size:12px">${fmtDate(tx.created_at)}</span>
      </div>
      <span style="color:var(--muted2);font-size:12px">${typeIcon[tx.type]||''} ${typeLabel[tx.type]||tx.type}</span>
    </div>`;
  }).join('');
}

function openLeaderboard() {
  const ov = document.createElement('div');
  ov.id = 'lbOverlay';
  ov.setAttribute('data-ov','1');
  ov.style.cssText = 'position:fixed;inset:0;background:#0a0a0a;z-index:500;display:flex;flex-direction:column;overflow:hidden';
  ov.innerHTML = `
    <div style="padding:16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1a1a1a">
      <div style="font-size:18px;font-weight:900">🏆 ${t('leaderboard_title')}</div>
      <button onclick="document.getElementById('lbOverlay').remove()" style="background:#1a1a1a;border:none;color:#fff;border-radius:50%;width:32px;height:32px;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="display:flex;gap:8px;padding:12px 16px 0">
      <button id="lbTabArc" onclick="lbShowTab('arc')" style="flex:1;padding:8px;border-radius:10px;border:none;background:var(--gold);color:#000;font-weight:800;cursor:pointer;font-size:13px">💰 ARC</button>
      <button id="lbTabRefs" onclick="lbShowTab('refs')" style="flex:1;padding:8px;border-radius:10px;border:none;background:#1a1a1a;color:#fff;font-weight:700;cursor:pointer;font-size:13px">👥 ${t('lb_tab_refs')}</button>
    </div>
    <div id="lbContent" style="flex:1;overflow-y:auto;padding:12px 16px 24px">
      <div class="pvp-empty" style="padding:20px">${t('loading')}</div>
    </div>`;
  document.body.appendChild(ov);
  lbShowTab('arc');
}

window.lbShowTab = function(tab) {
  const arcBtn = document.getElementById('lbTabArc');
  const refsBtn = document.getElementById('lbTabRefs');
  const content = document.getElementById('lbContent');
  if (!content) return;
  if (arcBtn) { arcBtn.style.background = tab==='arc' ? 'var(--gold)' : '#1a1a1a'; arcBtn.style.color = tab==='arc' ? '#000' : '#fff'; }
  if (refsBtn) { refsBtn.style.background = tab==='refs' ? 'var(--gold)' : '#1a1a1a'; refsBtn.style.color = tab==='refs' ? '#000' : '#fff'; }
  content.innerHTML = `<div class="pvp-empty" style="padding:20px">${t('loading')}</div>`;

  const medals = ['🥇','🥈','🥉'];
  if (tab === 'arc') {
    api('/leaderboard/arc').then(data => {
      if (!document.getElementById('lbContent')) return;
      const proStyle = ';background:linear-gradient(90deg,#5c4700,#8a6d00 50%,#5c4700);border:1px solid #ffd60a';
      const rows = (data.top || []).map(p => `
        <div class="player-card" style="justify-content:space-between;margin-bottom:6px${p.pro ? proStyle : (p.username === ME.username ? ';border:1px solid var(--gold)' : '')}">
          <span style="font-size:18px;min-width:32px">${medals[p.rank-1] || `<span style='color:var(--muted2);font-weight:700'>#${p.rank}</span>`}</span>
          <span class="pname" style="flex:1">@${p.username}${p.pro ? ' 👑' : ''}</span>
          <span style="color:var(--gold);font-weight:700">${fmt(p.arc, 0)} ARC</span>
        </div>`).join('') || `<div class="pvp-empty" style="padding:10px">${t('lb_empty')}</div>`;
      const myRow = data.myRank && data.myRank.rank > 3 ? `
        <div style="margin-top:12px;padding:8px 0;border-top:1px solid #2a2a2a;color:var(--muted2);font-size:12px;text-align:center">${t('my_rank_label')}</div>
        <div class="player-card" style="justify-content:space-between;${data.myRank.pro ? proStyle.slice(1) : 'border:1px solid var(--gold)'}">
          <span style="color:var(--gold);font-weight:700;min-width:32px">#${data.myRank.rank}</span>
          <span class="pname" style="flex:1">@${ME.username || '...'}${data.myRank.pro ? ' 👑' : ''}</span>
          <span style="color:var(--gold);font-weight:700">${fmt(data.myRank.arc, 0)} ARC</span>
        </div>` : '';
      document.getElementById('lbContent').innerHTML = rows + myRow;
    });
  } else {
    api('/leaderboard/refs').then(data => {
      if (!document.getElementById('lbContent')) return;
      const prizes = ['1 TON','0.5 TON','0.3 TON','0.2 TON','0.2 TON','0.1 TON','0.1 TON','0.1 TON','0.1 TON','0.1 TON'];
      const header = `
        <div style="background:#111;border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:var(--muted)">
          🏆 ${t('ref_contest')}<br>
          <span style="color:var(--gold);font-size:11px">${t('ref_prizes')}</span>
        </div>`;
      const rows = (data.top || []).map(p => {
        const prize = prizes[p.rank-1] ? `<span style="color:#4af;font-size:11px;font-weight:700">${prizes[p.rank-1]}</span>` : '';
        return `
        <div class="player-card" style="justify-content:space-between;margin-bottom:6px${p.tg_id === ME.tg_id ? ';border:1px solid var(--gold)' : ''}">
          <span style="font-size:18px;min-width:32px">${medals[p.rank-1] || `<span style='color:var(--muted2);font-weight:700'>#${p.rank}</span>`}</span>
          <span class="pname" style="flex:1">@${p.username}</span>
          <div style="text-align:right">${prize}<div style="color:var(--gold);font-weight:700">${p.refs} ${t('unit_friends')}</div></div>
        </div>`;
      }).join('') || `<div class="pvp-empty" style="padding:10px">${t('lb_no_refs')}</div>`;
      const myRow = data.myRank && data.myRank.rank > 3 ? `
        <div style="margin-top:12px;padding:8px 0;border-top:1px solid #2a2a2a;color:var(--muted2);font-size:12px;text-align:center">${t('my_rank_label')}</div>
        <div class="player-card" style="justify-content:space-between;border:1px solid var(--gold)">
          <span style="color:var(--gold);font-weight:700;min-width:32px">#${data.myRank.rank}</span>
          <span class="pname" style="flex:1">@${ME.username || '...'}</span>
          <span style="color:var(--gold);font-weight:700">${data.myRank.refs} ${t('unit_friends')}</span>
        </div>` : '';
      document.getElementById('lbContent').innerHTML = header + rows + myRow;
    });
  }
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
  const tgLang = (window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code || '').toLowerCase();
  const langMap = {
    'ru': 'ru', 'uk': 'ru', 'be': 'ru', 'kk': 'ru', 'ky': 'ru', 'tg': 'ru', 'uz': 'ru',
    'hi': 'hi',
    'pt': 'pt', 'pt-br': 'pt',
    'id': 'id',
    'bn': 'bn',
    'vi': 'vi',
  };
  LANG = ME.language || langMap[tgLang] || 'en';
  renderHeader(); applyLang(); switchTab('main');
  // Deep-link visitors never pressed Start, so the bot can't message them.
  // Ask for write access via Telegram's native popup; on grant, unblock + greet.
  if (ME.bot_blocked && tg?.requestWriteAccess) {
    try {
      tg.requestWriteAccess((granted) => {
        if (granted) api('/write-access').catch(() => {});
      });
    } catch {}
  }
  initTonConnect();
  setInterval(refreshBalance, 10000);
  // Heartbeat: keep online counter accurate on all tabs
  if (ME.adsgram_block_id && window.Adsgram) {
    try { adsgramController = window.Adsgram.init({ blockId: ME.adsgram_block_id }); } catch {}
  }
  if (ME.adsgram_block_id_short && window.Adsgram) {
    try { adsgramControllerShort = window.Adsgram.init({ blockId: ME.adsgram_block_id_short }); } catch {}
  }
  if (ME.onclicka_spot_id && window.initCdTma) {
    try {
      window.initCdTma({ id: Number(ME.onclicka_spot_id) })
        .then(show => { onclickaShow4 = show; renderMain(); })
        .catch(() => {});
    } catch {}
  }
  if (ME.monetag_zone_id) {
    const fn = window['show_' + ME.monetag_zone_id];
    if (typeof fn === 'function') {
      monetagReady = true; renderMain();
    } else {
      const poll = setInterval(() => {
        if (typeof window['show_' + ME.monetag_zone_id] === 'function') {
          clearInterval(poll); monetagReady = true; renderMain();
        }
      }, 500);
      setTimeout(() => clearInterval(poll), 12000);
    }
  }
  const urlParams = new URLSearchParams(location.search);
  if (urlParams.get('pro')) {
    setTimeout(() => openProModal(), 400);
  }
  if (urlParams.get('tab') === 'lottery') {
    pvpSubTab = 'lottery';
    setTimeout(() => switchTab('pvp'), 300);
  }
}
init();
