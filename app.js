
// Official Climate Clock 1.5°C deadline (carbon_deadline_1 from api.climateclock.world)
let BASE_DEADLINE = new Date('2029-07-22T16:00:00+00:00');
const STORE_KEY = 'muso-climate-clock-v1';

// Keep perfectly in sync with the real clock: refresh from the live API when online
fetch('https://api.climateclock.world/v1/clock')
  .then(r => r.json())
  .then(j => {
    const ts = j && j.data && j.data.modules && j.data.modules.carbon_deadline_1
      && j.data.modules.carbon_deadline_1.timestamp;
    if (ts) BASE_DEADLINE = new Date(ts);
  })
  .catch(() => { /* offline — hardcoded official deadline still applies */ });

// ─── Supabase Realtime (cross-device) ───
const SUPABASE_URL = 'https://bxbasutnjncwvevyeipn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bN-3OCS58jafCo_cmFRxyw_HauDKSwU';
let sbChannel = null, sbReady = false;
if (window.supabase) {
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  sbChannel = sb.channel('muso-climate-clock', { config: { broadcast: { self: false } } });
  sbChannel
    .on('broadcast', { event: 'state' }, msg => onRemoteState(msg.payload))
    .subscribe(status => {
      sbReady = status === 'SUBSCRIBED';
      updateSyncBadges();
    });
  // heartbeat: re-broadcast so screens that join late (or drop wifi) converge
  setInterval(() => {
    if (sbReady && state.ts) sbChannel.send({ type: 'broadcast', event: 'state', payload: state });
  }, 4000);
}
function updateSyncBadges() {
  document.querySelectorAll('.sync-badge').forEach(el => {
    el.textContent = sbReady ? '● online sync' : '● this device only';
    el.classList.toggle('on', sbReady);
  });
}

const QUESTIONS = [
  { q: 'How did you come to MuSo today?',
    opts: [ ['Walked', +10], ['Bus', +5], ['Car', -5] ] },
  { q: 'When you go shopping…',
    opts: [ ['Carry a reusable bag', +10], ['Buy a new plastic bag every time', -5] ] },
  { q: 'Have you blown up balloons at a birthday party?',
    opts: [ ['Yes', -20], ['No', +20] ] },
  { q: 'Once you’re done using a paper, do you…',
    opts: [ ['Throw it in the dustbin', -10], ['Reuse / recycle it', +10] ] },
  { q: 'In the morning, I showered for…',
    opts: [ ['5 minutes', +20], ['More than 5 minutes', -20] ] },
  { q: 'When you have a school project, do you…',
    opts: [ ['Buy new supplies each time', -10], ['Re-use old materials', +10] ] },
];

// ─── shared state ───
let state = { counts: {}, finished: false, ts: 0 };
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('muso-clock') : null;

function loadState() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.counts) state = s; }
  catch (e) { /* fresh start */ }
}
function saveState() {
  state.ts = Math.max(Date.now(), (state.ts || 0) + 1); // monotonic — rapid edits never share a timestamp
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (channel) channel.postMessage(state);
  if (sbReady) sbChannel.send({ type: 'broadcast', event: 'state', payload: state });
}

function totalDays(s) {
  let t = 0;
  QUESTIONS.forEach((qu, qi) => qu.opts.forEach((op, oi) => {
    t += (s.counts[qi + '-' + oi] || 0) * op[1];
  }));
  return t;
}
function deadlineFor(days) {
  return new Date(BASE_DEADLINE.getTime() + days * 86400000);
}
function fmtDate(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── views / roles ───
const views = { role: 'view-role', student: 'view-student', facilitator: 'view-fac' };
function show(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function setRole(role) {
  if (role) sessionStorage.setItem('muso-role', role); else sessionStorage.removeItem('muso-role');
  applyRole();
}
function applyRole() {
  const role = sessionStorage.getItem('muso-role');
  if (role === 'student') { show(views.student); }
  else if (role === 'facilitator') { show(views.facilitator); buildQuestions(); refreshFacilitator(); }
  else show(views.role);
}

// ─── facilitator ───
function buildQuestions() {
  const host = document.getElementById('questions');
  if (host.childElementCount) { syncInputs(); return; }
  QUESTIONS.forEach((qu, qi) => {
    const card = document.createElement('div');
    card.className = 'qcard';
    let html = `<span class="qnum">Q${qi + 1}</span><h2>${qu.q}</h2>
      <p class="qsub">Ask for a show of hands, then type how many kids picked each option.</p>`;
    qu.opts.forEach((op, oi) => {
      const pos = op[1] > 0;
      html += `<div class="opt">
        <span class="opt-label">${op[0]}</span>
        <span class="opt-days ${pos ? 'pos' : 'neg'}">${pos ? '+' : ''}${op[1]} days</span>
        <input class="opt-count" type="number" min="0" max="999" value="0"
               data-key="${qi}-${oi}" aria-label="Number of kids: ${op[0]}">
      </div>`;
    });
    html += `<p class="qtotal">This question: <span data-qtotal="${qi}">0 days</span></p>`;
    card.innerHTML = html;
    host.appendChild(card);
  });
  host.addEventListener('input', e => {
    if (!e.target.matches('.opt-count')) return;
    const key = e.target.dataset.key;
    state.counts[key] = Math.max(0, parseInt(e.target.value, 10) || 0);
    state.finished = false;
    saveState();
    refreshFacilitator();
  });
  syncInputs();
}
function syncInputs() {
  document.querySelectorAll('.opt-count').forEach(inp => {
    inp.value = state.counts[inp.dataset.key] || 0;
  });
}
function refreshFacilitator() {
  const t = totalDays(state);
  document.getElementById('facTotal').textContent = (t > 0 ? '+' : '') + t + ' days';
  document.getElementById('facDeadline').textContent = fmtDate(deadlineFor(t));
  QUESTIONS.forEach((qu, qi) => {
    let qt = 0;
    qu.opts.forEach((op, oi) => qt += (state.counts[qi + '-' + oi] || 0) * op[1]);
    const el = document.querySelector(`[data-qtotal="${qi}"]`);
    if (el) { el.textContent = (qt > 0 ? '+' : '') + qt + ' days'; el.className = qt >= 0 ? 'pos' : 'neg'; }
  });
}
function finishQuiz() {
  state.finished = true;
  saveState();
}
function resetAll() {
  if (!confirm('Reset all answers for a new group?')) return;
  state = { counts: {}, finished: false, ts: 0 };
  saveState();
  syncInputs();
  refreshFacilitator();
}

// ─── fullscreen (timer only) ───
// Tries the native Fullscreen API; if the browser/kiosk refuses it,
// falls back to a CSS overlay so the timer still fills the screen.
function toggleClockFullscreen() {
  const el = document.getElementById('clockWrap');
  const inNative = document.fullscreenElement || document.webkitFullscreenElement;
  const inFaux = document.body.classList.contains('faux-fs');

  if (inNative) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
  if (inFaux) { document.body.classList.remove('faux-fs'); return; }

  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  try {
    const p = req && req.call(el);
    if (p && p.catch) p.catch(() => document.body.classList.add('faux-fs'));
    else if (!req) document.body.classList.add('faux-fs');
  } catch (err) {
    document.body.classList.add('faux-fs'); // native API refused synchronously
  }
}
// Esc leaves the CSS-fallback mode (native fullscreen handles Esc itself)
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.body.classList.remove('faux-fs');
});
// In the touch-friendly CSS-fallback mode, tapping the timer also exits
document.getElementById('clockWrap').addEventListener('click', () => {
  if (document.body.classList.contains('faux-fs')) document.body.classList.remove('faux-fs');
});

// ─── student / big screen ───
let lastTotal = null, bannerTimer = null;

function renderClock() {
  const t = totalDays(state);
  const deadline = deadlineFor(t);
  let ms = deadline - new Date();
  if (ms < 0) ms = 0;

  const sec = Math.floor(ms / 1000);
  const years = Math.floor(sec / 31557600);            // 365.25 d
  const days = Math.floor((sec % 31557600) / 86400);
  const hrs = Math.floor((sec % 86400) / 3600);
  const min = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  setNum('cYrs', years);
  setNum('cDays', String(days));
  setNum('cHrs', String(hrs).padStart(2, '0'));
  setNum('cMin', String(min).padStart(2, '0'));
  setNum('cSec', String(s).padStart(2, '0'));
  document.getElementById('deadlineDate').textContent = fmtDate(deadline);

  const iv = document.getElementById('impactValue');
  iv.textContent = (t > 0 ? '+' : '') + t + ' days';
  iv.className = 'impact-value ' + (t > 0 ? 'pos' : t < 0 ? 'neg' : '');

  if (lastTotal !== null && t !== lastTotal) flashChange(t - lastTotal);
  if (state.finished) showFinal(t);
  lastTotal = t;
}
function setNum(id, v) {
  const el = document.getElementById(id);
  if (el.textContent !== String(v)) el.textContent = v;
}
function flashChange(delta) {
  const wrap = document.getElementById('clockWrap');
  wrap.classList.remove('gain', 'lose');
  void wrap.offsetWidth; // restart animation
  wrap.classList.add(delta > 0 ? 'gain' : 'lose');
  banner(delta > 0
    ? `<span class="tag gain">+${delta} days — the clock just went BACKWARDS! 🌱</span>`
    : `<span class="tag lose">${delta} days — the clock sped up! 😱</span>`);
}
function showFinal(t) {
  const msg = t >= 0
    ? `🎉 Together we EARNED ${t} extra days for planet Earth!`
    : `Together our choices cost Earth ${Math.abs(t)} days. We can do better — starting today!`;
  banner(`<span class="tag final">${msg}</span>`, 12000);
}
function banner(html, hold = 5000) {
  const b = document.getElementById('eventBanner');
  b.innerHTML = html;
  b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.remove('show'), hold);
}

// ─── sync plumbing ───
function onRemoteState(s) {
  if (!s || s.ts <= state.ts) return;
  state = s;
  const role = sessionStorage.getItem('muso-role');
  if (role === 'facilitator') { syncInputs(); refreshFacilitator(); }
}
if (channel) channel.onmessage = e => onRemoteState(e.data);
window.addEventListener('storage', e => {
  if (e.key === STORE_KEY && e.newValue) {
    try { onRemoteState(JSON.parse(e.newValue)); } catch (err) {}
  }
});
// polling fallback (covers file:// quirks)
setInterval(() => {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) onRemoteState(s);
  } catch (e) {}
}, 1500);

// ─── boot ───
loadState();
applyRole();
updateSyncBadges();
setInterval(renderClock, 250);
renderClock();
