// DinnerSync simple timer: dishes with one time each, all finishing together.
import { MIN, stepTime, nextEarly, totalMinutes, schedule, alarms, dishState, clock, countdown } from './simple.js';
import { keepAliveWav, alarmWav, ALARM } from './ring.js';

const $ = id => document.getElementById(id);
const KEY = { dishes: 'dinnersync.simple.dishes', cook: 'dinnersync.simple.cooking' };
const RING_LEN = 326.7;
const QUARTER = 15 * MIN;

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const save = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full or blocked: carry on */ }
};
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

let dishes = load(KEY.dishes, []);
let mode = 'now';      // 'now' or 'at'
let laterAt = 0;       // chosen dinner time in 'at' mode
let cook = load(KEY.cook, null); // { dishes, dinnerAt, pressedAt, done: [alarm index] }
let alarmOn = false;
let buzzTimer = null;
let wakeLock = null;

// ---------- plan ----------

const earliest = now => now + totalMinutes(dishes) * MIN;

function dinnerTime(now) {
  if (mode === 'now') return earliest(now);
  const first = Math.ceil(earliest(now) / QUARTER) * QUARTER;
  if (laterAt < first) laterAt = first;
  return laterAt;
}

function saveDishes() {
  save(KEY.dishes, dishes);
  renderPlan(true);
}

let lastPlan = '';
function renderPlan(force = false) {
  const now = Date.now();
  const dinnerAt = dinnerTime(now);
  const { startAt, rows } = schedule(dishes, dinnerAt);
  const total = totalMinutes(dishes);

  const html = rows.length ? rows.map((r, i) => {
    const longest = r.time + r.early === total;
    let when = r.onAt <= startAt ? 'Goes on first' : `Goes on at ${clock(r.onAt)} (${Math.round((r.onAt - startAt) / MIN)} min in)`;
    if (r.early) when += ` · off at ${clock(r.offAt)}`;
    return `<li class="dish${longest ? ' longest' : ''}">
      <div class="dish-top"><span class="dish-name">${esc(r.name)}</span>
        <button class="x" type="button" data-act="remove" data-i="${i}" aria-label="Remove ${esc(r.name)}">×</button></div>
      <div class="dish-mid">
        <div class="time-ctl">
          <button class="step" type="button" data-act="minus" data-i="${i}" aria-label="Less time">−</button>
          <span class="mins">${r.time} min</span>
          <button class="step" type="button" data-act="plus" data-i="${i}" aria-label="More time">+</button>
        </div>
        <button class="early${r.early ? ' on' : ''}" type="button" data-act="early" data-i="${i}">${r.early ? `Off ${r.early} min early` : 'Done early: off'}</button>
      </div>
      <p class="muted">${when}</p>
    </li>`;
  }).join('') : '<li class="empty">Add your first dish below</li>';

  if (force || html !== lastPlan) {
    $('dishes').innerHTML = html;
    lastPlan = html;
  }
  $('mode-now').classList.toggle('on', mode === 'now');
  $('mode-at').classList.toggle('on', mode === 'at');
  $('later-minus').hidden = $('later-plus').hidden = mode !== 'at';
  $('later-minus').disabled = mode !== 'at' || laterAt - QUARTER < earliest(now);
  $('dinner-at').textContent = dishes.length ? clock(dinnerAt) : '--';
  $('takes').textContent = dishes.length
    ? `Takes ${total} min${mode === 'at' && startAt > now ? `, first dish on at ${clock(startAt)}` : ''}`
    : '';
  $('start').disabled = !dishes.length;
}

$('dishes').addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const d = dishes[Number(btn.dataset.i)];
  if (!d) return;
  if (btn.dataset.act === 'remove') dishes = dishes.filter(x => x !== d);
  if (btn.dataset.act === 'minus') d.time = stepTime(d.time, -1);
  if (btn.dataset.act === 'plus') d.time = stepTime(d.time, 1);
  if (btn.dataset.act === 'early') d.early = nextEarly(d.early);
  saveDishes();
});

$('add-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('add-name').value.trim();
  if (!name) return;
  dishes.push({ name, time: 20, early: 0 });
  $('add-name').value = '';
  $('add-name').blur();
  saveDishes();
});

$('mode-now').addEventListener('click', () => { mode = 'now'; renderPlan(true); });
$('mode-at').addEventListener('click', () => { mode = 'at'; laterAt = 0; renderPlan(true); });
$('later-plus').addEventListener('click', () => { laterAt += QUARTER; renderPlan(true); });
$('later-minus').addEventListener('click', () => {
  if (laterAt - QUARTER >= earliest(Date.now())) laterAt -= QUARTER;
  renderPlan(true);
});

$('start').addEventListener('click', () => {
  if (!dishes.length) return;
  const now = Date.now();
  cook = { dishes: dishes.map(d => ({ ...d })), dinnerAt: dinnerTime(now), pressedAt: now, done: [] };
  // Anything due right now (the first dishes on a Start now) is what you're doing as you tap
  alarms(cook.dishes, cook.dinnerAt).forEach((a, i) => { if (a.at <= now) cook.done.push(i); });
  save(KEY.cook, cook);
  startKeepAlive();
  requestWakeLock();
  show();
});

$('reset').addEventListener('click', () => {
  if (cook) {
    if (!confirm('Stop cooking? The timers and alarms stop.')) return;
    endCooking();
  } else {
    if (!dishes.length || !confirm('Clear all dishes?')) return;
    dishes = [];
    saveDishes();
  }
});

// ---------- cooking ----------

function endCooking() {
  cook = null;
  save(KEY.cook, null);
  stopAlarm();
  stopKeepAlive();
  releaseWakeLock();
  show();
}

function renderCook() {
  const now = Date.now();
  const list = alarms(cook.dishes, cook.dinnerAt);
  const { rows } = schedule(cook.dishes, cook.dinnerAt);
  const left = cook.dinnerAt - now;
  const span = Math.max(1, cook.dinnerAt - cook.pressedAt);

  $('ring-time').textContent = countdown(left);
  $('ring-sub').textContent = `ready at ${clock(cook.dinnerAt)}`;
  $('ring-prog').style.strokeDashoffset = String(RING_LEN * (1 - Math.min(1, Math.max(0, left / span))));

  const ringing = list.filter((a, i) => a.at <= now && !cook.done.includes(i));
  const next = list.find((a, i) => a.at > now && !cook.done.includes(i));
  const finished = cook.done.length === list.length;

  $('next').classList.toggle('ringing', ringing.length > 0);
  $('done').hidden = !ringing.length && !finished;
  $('next-count').hidden = ringing.length > 0 || finished;
  if (finished) {
    $('next-badge').textContent = 'DONE';
    $('next-at').textContent = clock(cook.dinnerAt);
    $('next-text').textContent = 'Enjoy your dinner!';
    $('done').textContent = 'Back to plan';
  } else if (ringing.length) {
    $('next-badge').textContent = 'NOW';
    $('next-at').textContent = clock(ringing[0].at);
    $('next-text').textContent = ringing.map(a => a.text).join(' · ');
    $('done').textContent = 'Done ✓';
  } else {
    $('next-badge').textContent = 'NEXT ALARM';
    $('next-at').textContent = clock(next.at);
    $('next-text').textContent = next.text;
    $('next-count').textContent = countdown(next.at - now);
  }

  $('cook-list').innerHTML = rows.map(r => {
    const st = dishState(r, now);
    const info = st === 'waiting' ? `${r.time} min · goes on ${clock(r.onAt)}`
      : st === 'cooking' ? `${r.time} min · ${r.early ? 'off' : 'done'} at ${clock(r.offAt)}`
        : r.early && now < cook.dinnerAt ? 'Off, resting' : 'Ready';
    const badge = { waiting: ['wait', 'WAITING'], cooking: ['cooking', 'COOKING'], ready: ['ready', 'READY'] }[st];
    return `<li class="cook-item"><div><b>${esc(r.name)}</b><span class="muted">${esc(info)}</span></div>
      <span class="badge ${badge[0]}">${badge[1]}</span></li>`;
  }).join('');

  if (ringing.length && !alarmOn) raiseAlarm();
  if (!ringing.length && alarmOn) stopAlarm();
}

$('done').addEventListener('click', () => {
  if (!cook) return;
  const now = Date.now();
  const list = alarms(cook.dishes, cook.dinnerAt);
  if (cook.done.length === list.length) return endCooking();
  list.forEach((a, i) => { if (a.at <= now && !cook.done.includes(i)) cook.done.push(i); });
  save(KEY.cook, cook);
  stopAlarm();
  if (cook.done.length === list.length) stopKeepAlive();
  renderCook();
});

// ---------- alarm: the app's beep-beep-beep through the keep-alive element, plus vibration ----------

const keepAlive = $('keep-alive');
const silentUrl = URL.createObjectURL(new Blob([keepAliveWav()], { type: 'audio/wav' }));
const alarmUrl = URL.createObjectURL(new Blob([alarmWav()], { type: 'audio/wav' }));

function setSound(kind) {
  if (keepAlive.dataset.sound === kind) return;
  keepAlive.src = kind === 'alarm' ? alarmUrl : silentUrl;
  keepAlive.dataset.sound = kind;
}
setSound('silent');

function buzz() {
  try { navigator.vibrate?.([400, 200, 400]); } catch { /* ignore */ }
}

function raiseAlarm() {
  alarmOn = true;
  setSound('alarm'); // a locked phone lets an already-playing element change sound
  keepAlive.currentTime = 0;
  keepAlive.play().catch(() => {});
  buzz();
  clearInterval(buzzTimer);
  buzzTimer = setInterval(buzz, ALARM.loopSeconds * 1000);
}

function stopAlarm() {
  alarmOn = false;
  clearInterval(buzzTimer);
  buzzTimer = null;
  setSound('silent');
  if (cook) keepAlive.play().catch(() => {});
}

// A near-silent hum while cooking keeps Android from pausing the page (and its alarms) when the phone locks.
function startKeepAlive() {
  if (keepAlive.dataset.sound !== 'alarm') setSound('silent');
  keepAlive.play().catch(() => document.addEventListener('pointerdown', retryKeepAlive, { once: true }));
  try {
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'DinnerSync', artist: 'Cooking — alarms on' });
    }
  } catch { /* unsupported */ }
}
function retryKeepAlive() { if (cook) startKeepAlive(); }
function stopKeepAlive() { keepAlive.pause(); }

async function requestWakeLock() {
  try {
    if (!cook || !('wakeLock' in navigator) || (wakeLock && !wakeLock.released)) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* unsupported or refused */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* ignore */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !cook) return;
  requestWakeLock();
  if (keepAlive.paused) startKeepAlive();
});

// ---------- screens and the tick ----------

function show() {
  $('plan').hidden = Boolean(cook);
  $('cook').hidden = !cook;
  $('reset').textContent = cook ? 'Stop' : 'Reset';
  if (cook) renderCook();
  else renderPlan(true);
}

function tick() {
  $('now-clock').textContent = clock(Date.now());
  if (cook) renderCook();
  else renderPlan();
}

// A cook left over from hours ago is finished: start fresh
if (cook && Date.now() > cook.dinnerAt + 3 * 60 * MIN) {
  cook = null;
  save(KEY.cook, null);
}
if (cook) {
  startKeepAlive(); // blocked until a tap after a reload; retries on the next tap
  requestWakeLock();
}
show();
tick();
setInterval(tick, 500);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
