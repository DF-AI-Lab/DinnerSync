import { buildPlan, cookingState } from './plan.js';
import { createStore } from './store.js';

const MIN = 60_000;
const DEFAULT_READY_MIN = 90;
const RESUME_GRACE_MS = 2 * 60 * MIN;
const $ = id => document.getElementById(id);

function safeLocalStorage() {
  try { return window.localStorage; } catch { return null; }
}
const store = createStore(safeLocalStorage());

const state = {
  items: [],          // tonight's items: {name, minutes, temp}
  readyAt: 0,         // absolute ms
  preheatMinutes: 15,
  plan: null,         // plan built when "Show plan" was tapped
};

let cook = null;      // {plan, lastChecked, timer} while cooking
let alarmTimer = null;
let audioCtx = null;
let wakeLock = null;

// ---------- helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

function formatClock(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${ap}`;
}

function toTimeValue(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function showScreen(name) {
  const ids = { plan: 'plan-screen', timeline: 'timeline-screen', cook: 'cook-screen' };
  for (const [key, id] of Object.entries(ids)) $(id).hidden = key !== name;
  window.scrollTo(0, 0);
}

function currentPlan() {
  return buildPlan({
    items: state.items,
    readyAt: state.readyAt,
    now: Date.now(),
    preheatMinutes: state.preheatMinutes,
  });
}

function persistTonight() {
  store.saveLastDinner({ items: state.items, preheatMinutes: state.preheatMinutes });
}

// ---------- plan screen ----------

function syncReadyInputs() {
  const mins = Math.max(0, Math.round((state.readyAt - Date.now()) / MIN));
  $('ready-in').value = String(mins);
  $('ready-at').value = toTimeValue(state.readyAt);
  $('ready-clock').textContent = `Dinner at ${formatClock(state.readyAt)}`;
}

function onReadyChanged() {
  $('ready-clock').textContent = `Dinner at ${formatClock(state.readyAt)}`;
  renderStatus();
}

function renderStatus() {
  const box = $('status');
  box.className = 'status';
  box.replaceChildren();
  if (!state.items.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const plan = currentPlan();
  const preheatStep = plan.steps.find(s => s.type === 'preheat');
  if (plan.enoughTime) {
    box.classList.add('ok');
    box.append(el('p', {}, `Enough time — start preheating at ${formatClock(preheatStep.at)}`));
  } else {
    box.classList.add('warn');
    const useBtn = el('button', { class: 'btn', id: 'use-earliest', type: 'button' }, `Use ${formatClock(plan.earliestReady)}`);
    useBtn.addEventListener('click', () => {
      state.readyAt = plan.earliestReady;
      syncReadyInputs();
      onReadyChanged();
    });
    box.append(el('p', {}, `Not enough time — earliest ready ${formatClock(plan.earliestReady)}`), useBtn);
  }
}

function renderItems() {
  const ul = $('items');
  ul.replaceChildren();
  $('items-empty').hidden = state.items.length > 0;
  if (!state.items.length) return;

  const plan = currentPlan();
  plan.items.forEach((item, i) => {
    const info = el('div', { class: 'item-info' },
      el('span', { class: 'item-name' }, item.name),
      ...(item.main ? [el('span', { class: 'badge' }, 'Main')] : []),
      el('div', { class: 'item-detail' },
        `${item.minutes} min at ${item.temp}°C` +
        (item.cookMinutes !== item.minutes ? ` → ${item.cookMinutes} min in the oven` : '')),
    );
    const remove = el('button', { class: 'icon-btn', type: 'button', 'aria-label': `Remove ${item.name}` }, '✕');
    remove.addEventListener('click', () => {
      state.items.splice(i, 1);
      persistTonight();
      renderAll();
    });
    ul.append(el('li', {}, info, remove));
  });
}

function renderSaved() {
  const wrap = $('saved-items');
  wrap.replaceChildren();
  const saved = store.getSavedItems();
  if (!saved.length) {
    wrap.append(el('p', { class: 'muted' }, 'Items you add are saved here for next time.'));
    return;
  }
  for (const item of saved) {
    const chip = el('button', { class: 'chip', type: 'button', title: `${item.minutes} min at ${item.temp}°C` }, item.name);
    chip.addEventListener('click', () => addToTonight(item));
    const forget = el('button', { class: 'chip-x', type: 'button', 'aria-label': `Forget ${item.name}` }, '✕');
    forget.addEventListener('click', () => {
      store.removeItem(item.name);
      renderSaved();
    });
    wrap.append(el('span', { class: 'chip-wrap' }, chip, forget));
  }
}

function addToTonight(item) {
  const clean = { name: item.name, minutes: Number(item.minutes), temp: Number(item.temp) };
  const idx = state.items.findIndex(x => sameName(x.name, clean.name));
  if (idx >= 0) state.items[idx] = clean;
  else state.items.push(clean);
  persistTonight();
  renderAll();
}

function renderAll() {
  renderSaved();
  renderItems();
  renderStatus();
}

function bindPlanScreen() {
  $('ready-in').addEventListener('input', () => {
    const mins = Number($('ready-in').value);
    if (!Number.isFinite(mins) || mins <= 0) return;
    state.readyAt = Date.now() + mins * MIN;
    $('ready-at').value = toTimeValue(state.readyAt);
    onReadyChanged();
  });

  $('ready-at').addEventListener('input', () => {
    const value = $('ready-at').value;
    if (!value) return;
    const [h, m] = value.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    state.readyAt = d.getTime();
    $('ready-in').value = String(Math.round((state.readyAt - Date.now()) / MIN));
    onReadyChanged();
  });

  $('add-item').addEventListener('click', () => {
    const name = $('item-name').value.trim();
    const minutes = Math.round(Number($('item-minutes').value));
    const temp = Math.round(Number($('item-temp').value));
    const err = $('item-error');
    if (!name || !(minutes > 0) || !(temp > 0)) {
      err.textContent = 'Give a name, cook minutes and a temp.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    const item = { name, minutes, temp };
    store.saveItem(item);
    addToTonight(item);
    $('item-name').value = '';
    $('item-minutes').value = '';
    $('item-temp').value = '';
    $('item-name').focus();
  });

  $('preheat').addEventListener('input', () => {
    const v = Number($('preheat').value);
    if (!Number.isFinite(v) || v < 0) return;
    state.preheatMinutes = Math.round(v);
    store.saveSettings({ preheatMinutes: state.preheatMinutes });
    persistTonight();
    renderStatus();
  });

  $('show-plan').addEventListener('click', () => {
    const err = $('plan-error');
    if (!state.items.length) {
      err.textContent = 'Add at least one item first.';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    state.plan = currentPlan();
    renderTimeline();
    showScreen('timeline');
  });
}

// ---------- timeline screen ----------

function renderTimeline() {
  const plan = state.plan;
  const ol = $('plan-steps');
  ol.replaceChildren();
  for (const s of plan.steps) {
    ol.append(el('li', { class: `step-${s.type}` },
      el('time', {}, formatClock(s.at)),
      el('span', {}, s.text)));
  }
  $('timeline-ready').textContent = `Dinner at ${formatClock(plan.readyAt)}`;
  $('timeline-oven').textContent = `Oven ${plan.ovenTemp}°C`;
  const note = $('timeline-note');
  note.hidden = plan.enoughTime;
  note.textContent = `Not enough time — earliest ready ${formatClock(plan.earliestReady)} (${plan.shortByMinutes} min short)`;
}

function bindTimelineScreen() {
  $('back-plan').addEventListener('click', () => showScreen('plan'));
  $('start-cooking').addEventListener('click', () => {
    requestNotifications();
    unlockAudio();
    const plan = state.plan || currentPlan();
    store.saveCooking({ plan });
    beginCooking(plan, Date.now());
  });
}

// ---------- cooking ----------

function beginCooking(plan, since) {
  stopTimer();
  cook = { plan, lastChecked: since, timer: null };
  showScreen('cook');
  tick();
  cook.timer = setInterval(tick, 1000);
  requestWakeLock();
}

function stopTimer() {
  if (cook?.timer) clearInterval(cook.timer);
}

function tick() {
  if (!cook) return;
  const now = Date.now();
  const due = cook.plan.steps.filter(s => s.at > cook.lastChecked && s.at <= now);
  cook.lastChecked = now;
  if (due.length) raiseAlarm(due.map(s => s.text).join(' · '));
  renderCook(cookingState(cook.plan, now));
}

function renderCook(st) {
  const plan = cook.plan;
  $('cook-now').textContent = st.done
    ? 'Dinner is ready!'
    : (st.current ? st.current.text : 'Not started yet');

  if (st.next) {
    const n = st.next;
    $('next-label').textContent = n.type === 'preheat'
      ? 'Next: Preheat oven'
      : n.type === 'in' ? `Next: ${n.name} in` : 'Next: Dinner ready';
    $('next-time').textContent = formatCountdown(st.msToNext);
  } else {
    $('next-label').textContent = 'Nothing left to do';
    $('next-time').textContent = '0:00';
  }

  $('preheat-block').hidden = !(st.current?.type === 'preheat');
  $('preheat-left').textContent = formatCountdown(st.preheatLeftMs);
  $('dinner-in').textContent = formatCountdown(st.msToDinner);
  $('oven-temp').textContent = `Oven ${plan.ovenTemp}°C`;
}

function stopCooking() {
  stopAlarm();
  stopTimer();
  cook = null;
  store.clearCooking();
  releaseWakeLock();
  showScreen('plan');
}

function bindCookScreen() {
  $('stop-cooking').addEventListener('click', stopCooking);
  $('alarm-done').addEventListener('click', stopAlarm);
}

function resumeCooking() {
  let saved = null;
  try { saved = store.getCooking(); } catch { saved = null; }
  const plan = saved?.plan;
  if (!plan || !Array.isArray(plan.steps) || typeof plan.readyAt !== 'number') return;
  if (Date.now() > plan.readyAt + RESUME_GRACE_MS) {
    store.clearCooking();
    return;
  }
  // Steps that passed while the app was closed do not alarm.
  beginCooking(plan, Date.now());
}

// ---------- alarm: sound, vibration, notification, banner ----------

function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !audioCtx) audioCtx = new AC();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  } catch {
    // no audio support
  }
}

function beepOnce() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = t0 + i * 0.35;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.start(start);
      osc.stop(start + 0.27);
    }
  } catch {
    // ignore audio errors
  }
}

function requestNotifications() {
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      const p = Notification.requestPermission();
      p?.catch?.(() => {});
    }
  } catch {
    // not supported
  }
}

function notify(body) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const options = { body, tag: 'dinnersync-alarm' };
    if (navigator.serviceWorker?.ready) {
      navigator.serviceWorker.ready
        .then(reg => reg.showNotification('DinnerSync', options))
        .catch(() => new Notification('DinnerSync', options));
    } else {
      new Notification('DinnerSync', options);
    }
  } catch {
    // notifications blocked or unsupported
  }
}

function raiseAlarm(text) {
  $('alarm-text').textContent = text;
  $('alarm-banner').hidden = false;
  try {
    if ('vibrate' in navigator) navigator.vibrate([400, 200, 400]);
  } catch {
    // ignore
  }
  beepOnce();
  clearInterval(alarmTimer);
  alarmTimer = setInterval(beepOnce, 2500);
  notify(text);
}

function stopAlarm() {
  clearInterval(alarmTimer);
  alarmTimer = null;
  $('alarm-banner').hidden = true;
}

// ---------- screen wake lock ----------

async function requestWakeLock() {
  try {
    if (!cook || !('wakeLock' in navigator)) return;
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // unsupported or refused
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {
    // ignore
  }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cook) requestWakeLock();
});
document.addEventListener('pointerdown', unlockAudio, { once: true });

// ---------- startup ----------

function isItem(x) {
  return x && typeof x.name === 'string' && x.name.trim() && Number(x.minutes) > 0 && Number(x.temp) > 0;
}

function init() {
  state.preheatMinutes = store.getSettings().preheatMinutes;
  $('preheat').value = String(state.preheatMinutes);

  const last = store.getLastDinner();
  if (last && Array.isArray(last.items)) {
    state.items = last.items
      .filter(isItem)
      .map(x => ({ name: x.name, minutes: Number(x.minutes), temp: Number(x.temp) }));
  }

  state.readyAt = Date.now() + DEFAULT_READY_MIN * MIN;
  syncReadyInputs();
  renderAll();

  bindPlanScreen();
  bindTimelineScreen();
  bindCookScreen();

  // Keep the status fresh while the plan screen is open.
  setInterval(() => {
    if (!$('plan-screen').hidden) renderStatus();
  }, 30_000);

  resumeCooking();
}

init();

try {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
} catch {
  // service workers unavailable
}
