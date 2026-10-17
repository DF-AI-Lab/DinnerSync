import { buildPlan, stepStatuses, currentCard, spareMinutes, alarmSteps, normalizeItem, toMinutes, splitMinutes, formatDuration } from './plan.js';
import { createStore } from './store.js';
import { createCountdown } from './timer.js';
import { keepAliveWav, alarmWav, ALARM } from './ring.js';

const MIN = 60_000;
const DEFAULT_READY_MIN = 90;
const METHOD_LABEL = { oven: '♨️ Oven', hob: '🔥 Hob', slow: '🍲 Slow cook', rest: '⏸ Rest' };
const STAGE_DEFAULTS = { minutes: 30, temp: 200, setting: 'low' };
const RESUME_GRACE_MS = 2 * 60 * MIN;
const RING_LEN = 2 * Math.PI * 52; // circumference of the timer ring (r=52)
const DRAWERS = ['dinner', 'timer'];
const $ = id => document.getElementById(id);

function safeLocalStorage() {
  try { return window.localStorage; } catch { return null; }
}
const store = createStore(safeLocalStorage());

const state = {
  items: [],          // tonight's items: {name, stages: [{method, minutes, temp?}]}
  readyAt: 0,         // absolute ms
  preheatMinutes: 15,
  plan: null,         // plan built when "Show plan" was tapped
};

let cook = null;      // {plan, done, lastChecked, timer, spare, spareFor} while cooking; done = ticked step indexes
let cardKey = null;   // what the cooking list was last built from (see renderCookSteps)
let buzzTimer = null; // vibrates with each loop of the alarm until Done
let wakeLock = null;
let openDrawer = null; // 'dinner' | 'timer' | null
const timer = createCountdown();
let timerAlerted = false; // the timer has already rung for its current run to 0
let alarmKind = 'cook';   // what the alarm banner is for: 'cook' or 'timer' (decides what Done does)

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
  renderBackToCook();
  window.scrollTo(0, 0);
}

// The bar back to the cook screen: shown only while cooking and the plan screen is up.
function renderBackToCook(now = Date.now()) {
  const bar = $('back-to-cook');
  bar.hidden = !(cook && !$('plan-screen').hidden);
  if (!bar.hidden) bar.textContent = `🔥 Cooking — dinner in ${formatCountdown(cook.plan.readyAt - now)} · tap to return`;
}

function currentPlan() {
  return buildPlan({
    items: state.items,
    readyAt: state.readyAt,
    now: Date.now(),
    preheatMinutes: state.preheatMinutes,
  });
}

// Keep one valid stage: {method, minutes} and {method, minutes, temp} for oven,
// plus an optional label. Returns null when a stage is missing a minute count or an oven temp.
function cleanStage(st) {
  if (!METHOD_LABEL[st?.method]) return null;
  const minutes = Math.round(Number(st.minutes));
  if (!(minutes > 0)) return null;
  const label = typeof st.label === 'string' ? st.label.trim() : '';
  const out = { method: st.method, minutes };
  if (st.method === 'oven') {
    const temp = Math.round(Number(st.temp));
    if (!(temp > 0)) return null;
    out.temp = temp;
  }
  if (st.method === 'slow') out.setting = st.setting === 'high' ? 'high' : 'low';
  if (label) out.label = label;
  return out;
}

// Returns a clean item, or null if the name or any stage is not usable.
function cleanItem(x) {
  if (!x || typeof x.name !== 'string' || !x.name.trim()) return null;
  const raw = normalizeItem(x).stages;
  if (!Array.isArray(raw) || !raw.length) return null;
  const stages = raw.map(cleanStage);
  if (stages.some(st => !st)) return null;
  return { name: x.name.trim(), stages };
}

// "Boil potatoes: Hob 10 min → Roast potatoes: Oven 45 min 220°C (55 min at 180°C) → Rest 15 min"
function describeStages(stages, ovenTemp) {
  return stages.map(st => {
    const prefix = st.label ? `${st.label}: ` : '';
    if (st.method === 'oven') {
      const scaled = st.cookMinutes !== undefined && st.cookMinutes !== st.minutes;
      const scaledText = scaled ? ` (${formatDuration(st.cookMinutes)} at ${ovenTemp}°C)` : '';
      return `${prefix}Oven ${formatDuration(st.minutes)} ${st.temp}°C${scaledText}`;
    }
    if (st.method === 'hob') return `${prefix}Hob ${formatDuration(st.minutes)}`;
    if (st.method === 'slow') return `${prefix}Slow cook ${formatDuration(st.minutes)} (${st.setting === 'high' ? 'High' : 'Low'})`;
    return `${prefix}Rest ${formatDuration(st.minutes)}`;
  }).join(' → ');
}

// A small method label followed by the step text, for timeline and cooking screen.
function stepNodes(step) {
  const nodes = [];
  if (step.method) nodes.push(el('span', { class: `tag m-${step.method}` }, METHOD_LABEL[step.method]));
  nodes.push(document.createTextNode(step.text));
  return nodes;
}

function persistTonight() {
  store.saveLastDinner({ items: state.items, preheatMinutes: state.preheatMinutes });
}

// ---------- plan screen ----------

function setReadyDuration(mins) {
  const { h, m } = splitMinutes(mins);
  $('ready-hours').value = String(h);
  $('ready-minutes').value = String(m);
}

// The dinner time, shown in the tile and under the inputs.
function showDinnerTime() {
  const text = formatClock(state.readyAt);
  $('ready-clock').textContent = `Dinner at ${text}`;
  $('tile-dinner-time').textContent = text;
}

function syncReadyInputs() {
  setReadyDuration(Math.max(0, Math.round((state.readyAt - Date.now()) / MIN)));
  $('ready-at').value = toTimeValue(state.readyAt);
  showDinnerTime();
}

function onReadyChanged() {
  showDinnerTime();
  renderStatus();
}

// ---------- tiles: "When's dinner" and "Timer" drawers ----------

// Tap a tile to open its drawer; tap it again to close. Only one is open at a time.
function toggleDrawer(name) {
  openDrawer = openDrawer === name ? null : name;
  for (const key of DRAWERS) {
    const open = key === openDrawer;
    $(`tile-${key}`).classList.toggle('on', open);
    $(`tile-${key}`).setAttribute('aria-expanded', String(open));
    $(`panel-${key}`).classList.toggle('open', open);
  }
  // The timer works on its own: hide the rest of the plan while it is open.
  $('plan-rest').hidden = openDrawer === 'timer';
}

function bindTiles() {
  $('tile-dinner').addEventListener('click', () => toggleDrawer('dinner'));
  $('tile-timer').addEventListener('click', () => toggleDrawer('timer'));
}

// Cook now: dinner at the earliest it can be ready if starting right now. Needs at least one item.
function bindCookNow() {
  $('cook-now').addEventListener('click', () => {
    const plan = buildPlan({ items: state.items, readyAt: Date.now(), now: Date.now(), preheatMinutes: state.preheatMinutes });
    if (plan.earliestReady == null) return;
    state.readyAt = plan.earliestReady;
    syncReadyInputs();
    onReadyChanged();
  });
}

function showNow() {
  $('now-clock').textContent = formatClock(Date.now());
}

function renderStatus() {
  $('cook-now').disabled = !state.items.length;
  const box = $('status');
  box.className = 'status';
  box.replaceChildren();
  if (!state.items.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const plan = currentPlan();
  const first = plan.steps[0];
  if (plan.enoughTime) {
    box.classList.add('ok');
    const what = first.type === 'preheat' ? 'preheating' : 'cooking';
    box.append(el('p', {}, `Enough time — start ${what} at ${formatClock(first.at)}`));
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
      el('div', { class: 'item-detail' }, describeStages(item.stages, plan.ovenTemp)),
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

// The saved-items menu in the add-item card: a panel of picks, each with a × to delete.
function setSavedOpen(open) {
  $('saved-panel').hidden = !open;
  $('saved-toggle').setAttribute('aria-expanded', String(open));
  if (open) renderSavedItems();
}

function renderSavedItems() {
  const saved = store.getSavedItems();
  $('saved-list').replaceChildren(...saved.map(item => {
    const pick = el('button', { class: 'saved-pick', type: 'button' }, item.name);
    pick.addEventListener('click', () => {
      fillDraft(item);
      setSavedOpen(false);
      document.activeElement?.blur();
    });
    const del = el('button', { class: 'saved-del', type: 'button', 'aria-label': `Delete ${item.name}` }, '×');
    del.addEventListener('click', () => {
      store.removeItem(item.name);
      renderSavedItems();
    });
    return el('li', {}, pick, del);
  }));
  $('saved-empty').hidden = saved.length > 0;
}

function bindSavedMenu() {
  $('saved-toggle').addEventListener('click', () => setSavedOpen($('saved-panel').hidden));
  document.addEventListener('pointerdown', e => {
    if (!$('saved-panel').hidden && !$('saved-menu').contains(e.target)) setSavedOpen(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('saved-panel').hidden) setSavedOpen(false);
  });
}

function addToTonight(item) {
  const clean = cleanItem(item);
  if (!clean) return;
  const idx = state.items.findIndex(x => sameName(x.name, clean.name));
  if (idx >= 0) state.items[idx] = clean;
  else state.items.push(clean);
  persistTonight();
  renderAll();
}

function renderAll() {
  renderItems();
  renderStatus();
}

function bindPlanScreen() {
  const onReadyDuration = () => {
    const mins = toMinutes($('ready-hours').value, $('ready-minutes').value);
    if (mins <= 0) return;
    state.readyAt = Date.now() + mins * MIN;
    $('ready-at').value = toTimeValue(state.readyAt);
    onReadyChanged();
  };
  $('ready-hours').addEventListener('input', onReadyDuration);
  $('ready-minutes').addEventListener('input', onReadyDuration);

  $('ready-at').addEventListener('input', () => {
    const value = $('ready-at').value;
    if (!value) return;
    const [h, m] = value.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    state.readyAt = d.getTime();
    setReadyDuration(Math.max(0, Math.round((state.readyAt - Date.now()) / MIN)));
    onReadyChanged();
  });

  $('add-item').addEventListener('click', () => {
    const err = $('item-error');
    const item = cleanItem({ name: $('item-name').value, stages: readStageRows() });
    if (!item) {
      err.textContent = 'Give a name, and minutes for each stage (plus a temp for oven).';
      err.hidden = false;
      return;
    }
    err.hidden = true;
    store.saveItem(item);
    addToTonight(item);
    resetDraft();
    renderSavedItems();
    document.activeElement?.blur();
  });

  $('add-stage').addEventListener('click', () => {
    addStageRow('oven');
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

// ---------- add-item form: stage rows ----------

function stageRows() {
  return [...$('stage-rows').querySelectorAll('.stage-row')];
}

function readStageRows() {
  return stageRows().map(row => ({
    method: row.dataset.method,
    label: row.querySelector('.stage-label').value,
    minutes: Number(row.dataset.minutes),
    temp: row.dataset.temp,
    setting: row.dataset.setting,
  }));
}

// Show a stage row from its data attributes: the method, the setting, the time and the temp.
function paintStage(row) {
  const method = row.dataset.method;
  for (const btn of row.querySelectorAll('.seg-btn[data-method]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.method === method));
  }
  for (const btn of row.querySelectorAll('.slow-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.setting === row.dataset.setting));
  }
  row.querySelector('.temp-field').hidden = method !== 'oven';
  row.querySelector('.slow-field').hidden = method !== 'slow';
  row.querySelector('.stage-time').textContent = formatDuration(Number(row.dataset.minutes));
  row.querySelector('.stage-temp').textContent = `${row.dataset.temp}°C`;
}

// Switching to slow cook starts at 4 hr; switching away from a long slow cook goes back to 30 min.
function setMethod(row, method) {
  const was = row.dataset.method;
  const minutes = Number(row.dataset.minutes);
  if (method === 'slow' && was !== 'slow' && minutes < 120) row.dataset.minutes = '240';
  if (was === 'slow' && method !== 'slow' && minutes > 180) row.dataset.minutes = String(STAGE_DEFAULTS.minutes);
  row.dataset.method = method;
  paintStage(row);
}

function numberRows() {
  stageRows().forEach((row, i) => {
    row.querySelector('.stage-num').textContent = `Stage ${i + 1}`;
    row.querySelector('.stage-remove').hidden = i === 0;
  });
}

// One − / + tap: time moves 5 min (30 min for slow cook), from 5 to 720 min.
function nudgeTime(row, dir) {
  const step = row.dataset.method === 'slow' ? 30 : 5;
  const minutes = Number(row.dataset.minutes) + dir * step;
  row.dataset.minutes = String(Math.min(720, Math.max(5, minutes)));
  paintStage(row);
}

// One − / + tap on the temp: 10° a tap, from 50 to 260°C.
function nudgeTemp(row, dir) {
  const temp = Number(row.dataset.temp) + dir * 10;
  row.dataset.temp = String(Math.min(260, Math.max(50, temp)));
  paintStage(row);
}

// A − / + button: one step per tap. Held down, it keeps stepping until released.
function bindStepper(btn, step) {
  let delay = null;
  let repeat = null;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(repeat);
    delay = null;
    repeat = null;
  };
  btn.addEventListener('pointerdown', () => {
    stop();
    step();
    delay = setTimeout(() => { repeat = setInterval(step, 150); }, 400);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
  // A tap is handled on pointerdown. A keyboard press has no pointer, so it steps here.
  btn.addEventListener('click', e => {
    if (e.detail === 0) step();
  });
}

// The ✓ beside a text box: faded until the box is focused. Tapping it closes the keyboard.
function bindTick(input, tick) {
  input.addEventListener('focus', () => tick.classList.remove('off'));
  input.addEventListener('blur', () => tick.classList.add('off'));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
  });
  // Stop the box losing focus on press, so the click can still reach the tick.
  tick.addEventListener('pointerdown', e => e.preventDefault());
  tick.addEventListener('click', () => input.blur());
}

function bindStageRow(row) {
  for (const btn of row.querySelectorAll('.seg-btn[data-method]')) {
    btn.addEventListener('click', () => setMethod(row, btn.dataset.method));
  }
  for (const btn of row.querySelectorAll('.slow-btn')) {
    btn.addEventListener('click', () => {
      row.dataset.setting = btn.dataset.setting;
      paintStage(row);
    });
  }
  bindStepper(row.querySelector('.time-down'), () => nudgeTime(row, -1));
  bindStepper(row.querySelector('.time-up'), () => nudgeTime(row, 1));
  bindStepper(row.querySelector('.temp-down'), () => nudgeTemp(row, -1));
  bindStepper(row.querySelector('.temp-up'), () => nudgeTemp(row, 1));
  bindTick(row.querySelector('.stage-label'), row.querySelector('.stage-tick'));
  row.querySelector('.stage-remove').addEventListener('click', () => {
    row.remove();
    numberRows();
  });
}

function appendStageRow(method) {
  const row = $('stage-template').content.firstElementChild.cloneNode(true);
  bindStageRow(row);
  row.dataset.method = method;
  paintStage(row);
  $('stage-rows').append(row);
  return row;
}

// A new stage after "+ Then". Nothing is focused, so the keyboard stays shut.
function addStageRow(method) {
  appendStageRow(method);
  numberRows();
}

// Fill the whole form from a saved item: name, then one row per stage.
function fillDraft(item) {
  $('item-name').value = item.name;
  for (const row of stageRows().slice(1)) row.remove();
  item.stages.forEach((st, i) => {
    const row = i === 0 ? stageRows()[0] : appendStageRow(st.method);
    row.dataset.method = st.method;
    row.dataset.minutes = String(st.minutes);
    row.dataset.temp = String(st.temp ?? STAGE_DEFAULTS.temp);
    row.dataset.setting = st.setting === 'high' ? 'high' : 'low';
    row.querySelector('.stage-label').value = st.label || '';
    paintStage(row);
  });
  numberRows();
  $('item-error').hidden = true;
}

// Back to one empty oven stage after an item is added.
function resetDraft() {
  $('item-name').value = '';
  for (const row of stageRows().slice(1)) row.remove();
  const first = stageRows()[0];
  first.querySelector('.stage-label').value = '';
  Object.assign(first.dataset, {
    method: 'oven',
    minutes: String(STAGE_DEFAULTS.minutes),
    temp: String(STAGE_DEFAULTS.temp),
    setting: STAGE_DEFAULTS.setting,
  });
  paintStage(first);
  numberRows();
}

function bindStageForm() {
  const first = stageRows()[0];
  bindStageRow(first);
  bindTick($('item-name'), $('name-done'));
  paintStage(first);
  numberRows();
}

// ---------- timeline screen ----------

function renderTimeline() {
  const plan = state.plan;
  const ol = $('plan-steps');
  ol.replaceChildren();
  for (const s of plan.steps) {
    ol.append(el('li', { class: `step-${s.type}` },
      el('time', {}, formatClock(s.at)),
      el('span', {}, ...stepNodes(s))));
  }
  $('timeline-ready').textContent = `Dinner at ${formatClock(plan.readyAt)}`;
  $('timeline-oven').textContent = plan.ovenTemp == null ? 'No oven tonight' : `Oven ${plan.ovenTemp}°C`;
  const note = $('timeline-note');
  note.hidden = plan.enoughTime;
  note.textContent = `Not enough time — earliest ready ${formatClock(plan.earliestReady)} (${plan.shortByMinutes} min short)`;
}

function bindTimelineScreen() {
  $('back-plan').addEventListener('click', () => showScreen('plan'));
  $('start-cooking').addEventListener('click', () => {
    const plan = state.plan || currentPlan();
    store.saveCooking({ plan, preheatMinutes: state.preheatMinutes, done: [] });
    beginCooking(plan, Date.now(), []);
  });
}

// ---------- cooking ----------

function beginCooking(plan, since, done) {
  stopTimer();
  cook = { plan, done, lastChecked: since, timer: null, spare: null, spareFor: null };
  cardKey = null;
  showScreen('cook');
  // A history entry for the cook screen: the phone back button then goes to the plan, not out of the app.
  history.pushState({ screen: 'cook' }, '');
  tick();
  cook.timer = setInterval(tick, 1000);
  requestWakeLock();
  startKeepAlive();
}

function stopTimer() {
  if (cook?.timer) clearInterval(cook.timer);
}

function persistCooking() {
  store.saveCooking({ plan: cook.plan, preheatMinutes: state.preheatMinutes, done: cook.done });
}

function cookSteps(now = Date.now()) {
  return stepStatuses(cook.plan, now, cook.done);
}

function tick() {
  if (!cook) return;
  const now = Date.now();
  const due = alarmSteps(cook.plan, cook.lastChecked, now, cook.done);
  cook.lastChecked = now;
  if (due.length) raiseAlarm(due.map(s => s.text).join(' · '));
  renderCook(now);
}

// "Done ✓" (and the alarm's Done): the current step is finished. The last step
// ('ready') ends cooking.
function markCurrentDone() {
  stopAlarm();
  if (!cook) return;
  const now = Date.now();
  const current = cookSteps(now).find(s => s.status === 'current');
  if (!current || current.type === 'ready') {
    stopCooking();
    return;
  }
  cook.done.push(current.index);
  // Finished early: say how much time is spare before the next step. Times never move.
  const next = cookSteps(now).find(s => s.status === 'current');
  if (next && !next.due) {
    cook.spare = spareMinutes(next, now);
    cook.spareFor = next.index;
  } else {
    cook.spare = null;
    cook.spareFor = null;
  }
  persistCooking();
  renderCook(now);
}

// One step in the cooking list. The current step is a card with its countdown and Done.
// A done step's ✓ circle is a button: tap it to undo that step.
function cookStepItem(s, card, spare) {
  const attrs = { class: s.status, ...(s.status === 'current' ? { 'aria-current': 'step' } : {}) };
  const dot = s.status === 'done'
    ? el('button', { class: 'dot', type: 'button', 'aria-label': `Undo: ${s.text}` }, '✓')
    : el('span', { class: 'dot', 'aria-hidden': 'true' }, '');
  const text = [el('time', {}, formatClock(s.at)), ...stepNodes(s)];
  if (s.status !== 'current' || !card) return el('li', attrs, dot, el('div', { class: 'step-body' }, ...text));

  const parts = [el('div', { class: 'card-head' }, el('span', {}, ...text),
    el('span', { class: card.badge === 'NOW' ? 'step-badge' : 'step-badge wait' }, card.badge))];
  const left = [];
  if (card.last) {
    left.push(el('p', { class: 'card-sub' }, 'Enjoy 🍽'));
  } else {
    parts.push(el('div', { class: 'card-row' }, el('span', { class: 'card-count' })));
    if (card.badge === 'NOW') {
      // The bar sits in the bottom row, above the "until" line, beside Done.
      left.push(el('div', { class: 'card-bar' }, el('i')));
      left.push(el('p', { class: 'card-until' }, `until: ${card.until}`));
    } else {
      left.push(el('p', { class: 'card-sub' }, 'starts in'));
      if (spare != null) left.push(el('p', { class: 'card-spare' }, `✓ Done early, ${spare} min spare before this`));
    }
  }
  parts.push(el('div', { class: 'card-foot' }, el('div', { class: 'card-text' }, ...left), doneButton()));
  return el('li', attrs, dot, el('div', { class: 'step-body' }, ...parts));
}

function doneButton() {
  return el('button', { class: 'card-done', type: 'button' }, 'Done ✓');
}

// Rebuild the list only when a step's status or the card's wording changes. Otherwise
// just move the countdown and the bar, so a Done tap is never swallowed by a redraw.
function renderCookSteps(steps, card, spare) {
  const current = steps.find(s => s.status === 'current');
  const key = JSON.stringify([steps.map(s => s.status + (s.due ? '!' : '')), card && [card.badge, card.last, card.until], spare]);
  if (key !== cardKey) {
    cardKey = key;
    $('cook-steps').replaceChildren(...steps.map(s => cookStepItem(s, s === current ? card : null, spare)));
  }
  const count = $('cook-steps').querySelector('.card-count');
  if (count) count.textContent = formatCountdown(card.countdownMs);
  const bar = $('cook-steps').querySelector('.card-bar i');
  if (bar) bar.style.width = `${card.barPct}%`;
}

function renderCook(now) {
  const plan = cook.plan;
  const steps = cookSteps(now);
  const card = currentCard(steps, now);
  const current = steps.find(s => s.status === 'current');
  const spare = card?.badge === 'NEXT' && cook.spareFor === current?.index ? cook.spare : null;

  $('dinner-in').textContent = formatCountdown(plan.readyAt - now);
  $('oven-temp').textContent = plan.ovenTemp == null ? 'No oven tonight' : `Oven ${plan.ovenTemp}°C`;
  renderBackToCook(now);
  if (card) renderCookSteps(steps, card, spare);
  else $('cook-steps').replaceChildren();
}

function stopCooking() {
  $('reset-confirm').hidden = true;
  stopAlarm();
  stopTimer();
  cook = null;
  store.clearCooking();
  releaseWakeLock();
  stopKeepAlive();
  showScreen('plan');
}

// Reset: stop cooking and forget tonight's items and last dinner. Saved items stay.
function resetTonight() {
  stopCooking();
  state.items = [];
  store.clearLastDinner();
  renderAll();
}

function bindCookScreen() {
  // Phone back button while cooking: show the plan. Cooking, the timer and alarms carry on.
  window.addEventListener('popstate', () => {
    if (cook && !$('cook-screen').hidden) showScreen('plan');
  });
  $('back-to-cook').addEventListener('click', () => {
    history.pushState({ screen: 'cook' }, '');
    showScreen('cook');
  });
  // The logo is a home button: show the plan. Cooking carries on; the back-to-cook bar appears.
  $('home').addEventListener('click', () => showScreen('plan'));
  // One listener on the list: the Done buttons are rebuilt with the list.
  $('cook-steps').addEventListener('click', e => {
    if (e.target.closest('.card-done')) {
      markCurrentDone();
    } else if (e.target.closest('li.done .dot')) {
      // Undo: the step goes back to being the current one.
      const li = e.target.closest('li');
      const index = [...$('cook-steps').children].indexOf(li);
      if (!cook || index < 0) return;
      cook.done = cook.done.filter(i => i !== index);
      cook.spare = null;
      cook.spareFor = null;
      stopAlarm();
      persistCooking();
      renderCook(Date.now());
    }
  });
  $('cook-reset').addEventListener('click', () => { $('reset-confirm').hidden = false; });
  $('reset-no').addEventListener('click', () => { $('reset-confirm').hidden = true; });
  $('reset-yes').addEventListener('click', () => {
    $('reset-confirm').hidden = true;
    resetTonight();
  });
  $('alarm-done').addEventListener('click', () => {
    if (alarmKind === 'timer') {
      // Timer alarm: Done silences it and clears the timer
      stopAlarm();
      timer.reset();
      timerAlerted = false;
      renderTimer();
      stopKeepAlive();
    } else {
      markCurrentDone();
    }
  });
}

function resumeCooking() {
  let saved = null;
  try { saved = store.getCooking(); } catch { saved = null; }
  const savedPlan = saved?.plan;
  if (!savedPlan || !Array.isArray(savedPlan.items) || typeof savedPlan.readyAt !== 'number') return;
  if (Date.now() > savedPlan.readyAt + RESUME_GRACE_MS) {
    store.clearCooking();
    return;
  }
  // Rebuild from the saved items so older saved plans get the stage format.
  const preheatMinutes = Number.isFinite(saved.preheatMinutes) ? saved.preheatMinutes : state.preheatMinutes;
  const plan = buildPlan({ items: savedPlan.items, readyAt: savedPlan.readyAt, now: Date.now(), preheatMinutes });
  // Steps that passed while the app was closed do not alarm.
  // Ticked-off steps are kept as step indexes; they still line up with the rebuilt plan.
  const done = Array.isArray(saved.done)
    ? [...new Set(saved.done)].filter(i => Number.isInteger(i) && i >= 0 && i < plan.steps.length)
    : [];
  beginCooking(plan, Date.now(), done);
}

// ---------- alarm: sound, vibration, banner ----------

function buzz() {
  try {
    if ('vibrate' in navigator) navigator.vibrate([400, 200, 400]);
  } catch {
    // ignore
  }
}

function raiseAlarm(text, kind = 'cook') {
  alarmKind = kind;
  $('alarm-text').textContent = text;
  $('alarm-banner').hidden = false;
  buzz();
  // The alarm plays through the already-playing keep-alive element: a locked phone lets that start a sound
  setSound('alarm');
  keepAlive.currentTime = 0;
  keepAlive.play().catch(() => {});
  clearInterval(buzzTimer);
  buzzTimer = setInterval(buzz, ALARM.loopSeconds * 1000);
}

function stopAlarm() {
  clearInterval(buzzTimer);
  buzzTimer = null;
  $('alarm-banner').hidden = true;
  setSound('silent'); // back to the hum; it keeps playing only if something still needs the app awake
  if (needAwake()) keepAlive.play().catch(() => {});
  else stopKeepAlive();
}

// ---------- timer panel: countdown with +1/+5/+10 min, Start/Pause, Reset ----------

function renderTimer() {
  const now = Date.now();
  const text = formatCountdown(timer.remaining(now));
  $('timer-display').textContent = text;
  $('tile-timer-time').textContent = text;
  $('timer-ring').style.strokeDasharray = String(RING_LEN);
  $('timer-ring').style.strokeDashoffset = String(RING_LEN * (1 - timer.fraction(now)));
  $('timer-start').textContent = timer.running ? 'Pause' : 'Start';

  const done = timer.finished(now);
  $('timer-display').classList.toggle('flash', done);
  if (done && !timerAlerted) {
    timerAlerted = true;
    raiseAlarm('⏳ Timer done', 'timer');
  }
}

function bindTimer() {
  for (const btn of $('panel-timer').querySelectorAll('[data-add]')) {
    btn.addEventListener('click', () => {
      timer.add(Number(btn.dataset.add), Date.now());
      timerAlerted = false;
      renderTimer();
    });
  }
  $('timer-start').addEventListener('click', () => {
    if (timer.running) {
      timer.pause(Date.now());
      stopKeepAlive();
    } else {
      timer.start(Date.now());
      if (timer.running) startKeepAlive();
    }
    renderTimer();
  });
  $('timer-reset').addEventListener('click', () => {
    timer.reset();
    timerAlerted = false;
    renderTimer();
    stopKeepAlive();
  });
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
  if (document.visibilityState !== 'visible') return;
  requestWakeLock();
  if (needAwake() && keepAlive.paused) startKeepAlive();
});

// ---------- keep-alive: a near-silent loop while cooking or timing, so Android keeps the page (and its alarms) running ----------

const keepAlive = $('keep-alive');

const silentUrl = URL.createObjectURL(new Blob([keepAliveWav()], { type: 'audio/wav' }));
const alarmUrl = URL.createObjectURL(new Blob([alarmWav()], { type: 'audio/wav' }));

// The page must stay awake while cooking or while the kitchen timer runs.
const needAwake = () => Boolean(cook) || timer.running;

// The one element plays either the hum or the alarm; data-sound says which.
function setSound(kind) {
  if (keepAlive.dataset.sound === kind) return; // same src: keep playing, no reload
  keepAlive.src = kind === 'alarm' ? alarmUrl : silentUrl;
  keepAlive.dataset.sound = kind;
}
setSound('silent');

function startKeepAlive() {
  if (keepAlive.dataset.sound !== 'alarm') setSound('silent'); // never swap a sounding alarm out
  keepAlive.play().catch(() => {
    // Blocked until a tap (e.g. after reload): try again on the next tap while cooking
    document.addEventListener('pointerdown', retryKeepAlive, { once: true });
  });
  try {
    if ('mediaSession' in navigator && 'MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'DinnerSync', artist: 'Cooking — alarms on' });
    }
  } catch {
    // media session unsupported
  }
}

// If the phone pauses the alarm (another sound took over), start it again until Done.
keepAlive.addEventListener('pause', () => {
  if (keepAlive.dataset.sound !== 'alarm') return;
  setTimeout(() => {
    if (!$('alarm-banner').hidden) keepAlive.play().catch(() => {});
  }, 500);
});

function retryKeepAlive() {
  if (needAwake() && keepAlive.paused) startKeepAlive();
}

function stopKeepAlive() {
  if (needAwake()) return; // cooking or the timer still needs it
  keepAlive.pause();
  keepAlive.currentTime = 0;
}

// ---------- startup ----------

function init() {
  state.preheatMinutes = store.getSettings().preheatMinutes;
  $('preheat').value = String(state.preheatMinutes);

  const last = store.getLastDinner();
  if (last && Array.isArray(last.items)) {
    state.items = last.items.map(cleanItem).filter(Boolean);
  }

  state.readyAt = Date.now() + DEFAULT_READY_MIN * MIN;
  syncReadyInputs();
  renderAll();

  bindStageForm();
  renderSavedItems();
  bindSavedMenu();
  bindPlanScreen();
  bindTimelineScreen();
  bindCookScreen();
  bindTiles();
  bindTimer();
  bindCookNow();
  renderTimer();
  showNow();
  setInterval(showNow, 1000);

  // The timer is shown live (about 4 times a second); it is cheap to redraw.
  setInterval(renderTimer, 250);

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
