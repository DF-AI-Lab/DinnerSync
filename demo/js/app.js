import { buildPlan, stepStatuses, alarmSteps, toMinutes, splitMinutes, formatDuration, jobsOnTheGo, endAlarms, endText, nextAlarm } from './plan.js';
import { toPlan, schedule, ovenNotes, prepFirstExtra } from './meal.js';
import { createBuilder } from './builder.js';
import { createStore } from './store.js';
import { createCountdown } from './timer.js';
import { keepAliveWav, alarmWav, ALARM } from './ring.js';

const MIN = 60_000;
const QUARTER = 15 * MIN; // "Ready later" moves in 15-minute steps
const METHOD_LABEL = { oven: '♨️ Oven', hob: '🔥 Hob', slow: '🍲 Slow cook', rest: '⏸ Rest', prep: '🥄 Prep' };
// The Simple timer and the When's dinner panel are hidden for now. Their code is kept; turn this on to bring them back.
const SHOW_LEGACY_TOOLS = false;
const RESUME_GRACE_MS = 2 * 60 * MIN;
const RING_LEN = 2 * Math.PI * 52; // circumference of the timer ring (r=52)
const DRAWERS = ['dinner', 'timer'];
const $ = id => document.getElementById(id);

function safeLocalStorage() {
  try { return window.localStorage; } catch { return null; }
}
const store = createStore(safeLocalStorage());

const state = {
  plan: null,         // plan built when "Start timers" was tapped
};
let builder = null;   // the meal screen (js/builder.js): the meal, the dinner time and the saved meals

let cook = null;      // {plan, done, lastChecked, timer, rang, rangReady} while cooking. done = ticked-off step indexes; rang = job steps whose end is ringing
let jobsKey = null;   // what the jobs list was last built from (see renderJobs)
let stepsKey = null;  // the step statuses the step list was last built from
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

// The next quarter hour at or after ms. An exact quarter hour stays.
const up15 = ms => Math.ceil(ms / QUARTER) * QUARTER;

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

// The plan the cook screen runs, from the meal being set up.
function currentPlan() {
  const s = builder.state();
  return toPlan(s.meal, s.readyAt, Date.now(), { prepFirst: s.prepFirst, preheat: s.preheat });
}

// A small method label followed by the step text, for timeline and cooking screen.
function stepNodes(step) {
  const nodes = [];
  if (step.method) nodes.push(el('span', { class: `tag m-${step.method}` }, METHOD_LABEL[step.method]));
  nodes.push(document.createTextNode(step.text));
  return nodes;
}


// ---------- plan screen: the meal builder (js/builder.js) ----------

function showNow() {
  $('now-clock').textContent = formatClock(Date.now());
}

// The Start timers button: show the timer sequence for the meal as it stands.
function openTimeline() {
  const err = $('plan-error');
  err.hidden = true;
  state.plan = currentPlan();
  renderTimeline();
  showScreen('timeline');
}

// ---------- hidden for now (SHOW_LEGACY_TOOLS): the Simple timer and the When's dinner panel ----------

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

// The When's dinner panel shows and sets the builder's dinner time.
function syncLegacyDinner() {
  if (!SHOW_LEGACY_TOOLS || !builder) return;
  const { readyAt, mode } = builder.state();
  const text = formatClock(readyAt);
  $('ready-clock').textContent = `Dinner at ${text}`;
  $('tile-dinner-time').textContent = text;
  const later = mode === 'later';
  for (const [id, on] of [['when-now', !later], ['when-later', later]]) {
    $(id).setAttribute('aria-pressed', String(on));
    $(id).classList.toggle('on', on);
  }
  $('when-later-box').hidden = !later;
  $('later-val').textContent = `Ready at ${text}`;
  $('when-text').textContent = later ? '' : `Start now (${formatClock(Date.now())}) → ready at ${text}`;
  const { h, m } = splitMinutes(Math.max(0, Math.round((readyAt - Date.now()) / MIN)));
  $('ready-hours').value = String(h);
  $('ready-minutes').value = String(m);
  $('ready-at').value = toTimeValue(readyAt);
  $('cook-now').disabled = false;
}

function bindLegacyTools() {
  $('legacy-tools').hidden = !SHOW_LEGACY_TOOLS;
  $('tile-dinner').addEventListener('click', () => toggleDrawer('dinner'));
  $('tile-timer').addEventListener('click', () => toggleDrawer('timer'));
  $('cook-now').addEventListener('click', () => builder.setNow());
  $('when-now').addEventListener('click', () => builder.setNow());
  $('when-later').addEventListener('click', () => builder.setLater(up15(builder.state().readyAt)));
  $('later-down').addEventListener('click', () => builder.setLater(builder.state().readyAt - QUARTER));
  $('later-up').addEventListener('click', () => builder.setLater(builder.state().readyAt + QUARTER));
  const onReadyDuration = () => {
    const mins = toMinutes($('ready-hours').value, $('ready-minutes').value);
    if (mins > 0) builder.setLater(Date.now() + mins * MIN);
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
    builder.setLater(d.getTime());
  });
}

// ---------- timeline screen ----------

function renderTimeline() {
  const plan = state.plan;
  const { meal, prepFirst, preheat } = builder.state();
  const ol = $('plan-steps');
  ol.replaceChildren();
  let blockShown = false;
  let cookShown = false;
  for (const s of plan.steps) {
    // The prep steps at the start of each item sit in one block, then the cooking starts.
    if (s.prep1 && !blockShown) {
      blockShown = true;
      ol.append(el('li', { class: 'block' }, '🥄 Prep block · one thing at a time'));
    } else if (blockShown && !cookShown && !s.prep1 && s.type !== 'preheat') {
      cookShown = true;
      ol.append(el('li', { class: 'block' }, '🔥 Now cook'));
    }
    // Each step says which dish it is for.
    const dish = s.type === 'in' || s.type === 'remind' ? [el('span', { class: 'step-dish' }, s.name)] : [];
    ol.append(el('li', { class: `step-${s.type}${s.prep1 ? ' step-prep1' : ''}` },
      el('time', {}, formatClock(s.at)),
      el('span', {}, ...dish, ...stepNodes(s))));
  }
  $('timeline-ready').textContent = `Dinner at ${formatClock(plan.readyAt)}`;
  $('timeline-oven').textContent = plan.ovenTemp == null ? 'No oven tonight' : `Oven ${plan.ovenTemp}°C`;
  $('prep-first-box').checked = prepFirst;
  $('prep-first').classList.toggle('on', prepFirst);
  const extra = prepFirstExtra(meal, { preheat });
  $('prep-first-hint').textContent = `Peel and chop everything in one go, then just cook. ${extra > 0 ? `Adds ${formatDuration(extra)} overall.` : 'Same total time for this meal.'}`;
  const notes = ovenNotes(schedule(meal, plan.readyAt, { prepFirst, preheat }));
  $('oven-clash').hidden = !notes.length;
  $('oven-clash').textContent = notes.length ? `♨️ ${notes.join(' ')}` : '';
  const note = $('timeline-note');
  note.hidden = plan.enoughTime;
  note.textContent = `Not enough time — earliest ready ${formatClock(plan.earliestReady)} (${plan.shortByMinutes} min short)`;
}

function bindTimelineScreen() {
  $('back-plan').addEventListener('click', () => showScreen('plan'));
  $('prep-first-box').addEventListener('change', e => {
    builder.setPrepFirst(e.target.checked);
    state.plan = currentPlan();
    renderTimeline();
  });
  $('start-cooking').addEventListener('click', () => {
    // Start now: plan again from this moment, so nothing has already slipped by.
    const plan = builder.state().mode === 'now' ? currentPlan() : state.plan || currentPlan();
    store.saveCooking({ plan, done: [] });
    beginCooking(plan, Date.now(), []);
  });
}

// ---------- cooking ----------

function beginCooking(plan, since, done) {
  stopTimer();
  cook = { plan, done, lastChecked: since, timer: null, rang: [], rangReady: false };
  jobsKey = null;
  stepsKey = null;
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
  store.saveCooking({ plan: cook.plan, done: cook.done });
}

// Once a second: ring for steps starting, and for jobs whose time is up. Then redraw.
function tick() {
  if (!cook) return;
  const now = Date.now();
  const starts = alarmSteps(cook.plan, cook.lastChecked, now, cook.done);
  const ends = endAlarms(cook.plan, cook.lastChecked, now, cook.done);
  cook.lastChecked = now;
  if (starts.length || ends.length) {
    // The jobs that ended stay on the go until their alarm's Done ticks them off.
    // Reminders go on the same list: Done on their alarm ticks them off.
    const reminders = starts.filter(s => s.type === 'remind');
    cook.rang = [...new Set([...cook.rang, ...[...ends, ...reminders].map(s => cook.plan.steps.indexOf(s))])];
    if (starts.some(s => s.type === 'ready')) cook.rangReady = true;
    raiseAlarm([...ends.map(endText), ...starts.map(s => s.say ?? s.text)].join(' · '));
  }
  renderCook(now);
}

// The alarm's Done (cook): every job that rang is ticked off. The dinner alarm ends cooking.
// A start alarm alone ticks nothing.
function cookAlarmDone() {
  stopAlarm();
  if (!cook) return;
  const dinner = cook.rangReady;
  cook.done = [...new Set([...cook.done, ...cook.rang])];
  cook.rang = [];
  cook.rangReady = false;
  if (dinner) {
    stopCooking();
    return;
  }
  persistCooking();
  renderCook(Date.now());
}

// A job on the go: its dish, what it is, a countdown, Done, a bar, and what comes next in its line.
function jobEl(job) {
  const { step } = job;
  const preheat = step.type === 'preheat';
  return el('div', { class: job.over ? 'job-timer over' : 'job-timer', 'data-index': String(job.index) },
    el('div', { class: 'job-head' },
      el('span', { class: 'job-dish' }, preheat ? 'Oven' : step.name),
      ...(preheat ? [] : [el('span', { class: `tag m-${step.method}` }, METHOD_LABEL[step.method])])),
    el('p', { class: 'job-text' }, step.text),
    el('div', { class: 'job-row' },
      el('span', { class: 'job-count' }, formatCountdown(job.leftMs)),
      el('button', { class: 'job-done', type: 'button' }, 'Done ✓')),
    el('div', { class: 'job-bar' }, el('i', { style: `width:${job.pct}%` })),
    ...(job.then ? [el('p', { class: 'job-then' }, `then: ${job.then}`)] : []));
}

// Rebuild the jobs only when the set of jobs changes. Otherwise just the counts and bars move,
// so a Done tap is never swallowed by a redraw.
function renderJobs(now) {
  const jobs = jobsOnTheGo(cook.plan, now, cook.done);
  const key = JSON.stringify(jobs.map(j => [j.index, j.over, j.then]));
  const box = $('jobs');
  if (key !== jobsKey) {
    jobsKey = key;
    box.replaceChildren(...jobs.map(jobEl));
  }
  for (const job of jobs) {
    const node = box.querySelector(`.job-timer[data-index="${job.index}"]`);
    if (!node) continue;
    node.querySelector('.job-count').textContent = formatCountdown(job.leftMs);
    node.querySelector('.job-bar i').style.width = `${job.pct}%`;
  }
  $('jobs-empty').hidden = jobs.length > 0;
}

// The soonest thing still to come: a step starting, or a job ending.
// It sits inside the current step's card (see stepItem); the old standalone card stays hidden.
function renderNextAlarm(now) {
  const next = nextAlarm(cook.plan, now, cook.done);
  $('next-alarm').hidden = true;
  const box = $('cook-steps').querySelector('li.current .cs-alarm');
  if (!box) return;
  box.hidden = !next;
  if (!next) return;
  box.querySelector('.cs-count').textContent = formatCountdown(next.at - now);
  box.querySelector('.cs-text').textContent = `${next.text} · ${formatClock(next.at)}`;
}

// The steps as a plain list. Rebuilt only when a step's status changes.
function stepItem(s) {
  const attrs = { class: s.status, 'data-index': String(s.index), ...(s.status === 'current' ? { 'aria-current': 'step' } : {}) };
  const dot = s.status === 'done'
    ? el('button', { class: 'dot', type: 'button', 'aria-label': `Undo: ${s.text}` }, '✓')
    : el('span', { class: 'dot', 'aria-hidden': 'true' }, '');
  const body = el('div', { class: 'step-body' }, el('time', {}, formatClock(s.at)), ...stepNodes(s));
  // Done only says "I did it". The plan's times don't move, and Undo puts the step back.
  if (s.status === 'current' && s.type !== 'ready') body.append(el('button', { class: 'btn step-done', type: 'button', 'data-done': String(s.index) }, 'Done ✓'));
  if (s.status === 'current') {
    body.append(el('div', { class: 'cs-alarm' },
      el('span', { class: 'cs-label' }, 'Next alarm'),
      el('b', { class: 'cs-count' }, ''),
      el('span', { class: 'cs-text' }, '')));
  }
  if (s.status === 'done') body.append(el('button', { class: 'btn ghost step-undo', type: 'button', 'data-undo': String(s.index) }, 'Undo'));
  return el('li', attrs, dot, body);
}

function renderCookSteps(now) {
  const steps = stepStatuses(cook.plan, now, cook.done);
  const key = steps.map(s => s.status).join(',');
  if (key === stepsKey) return;
  stepsKey = key;
  $('cook-steps').replaceChildren(...steps.map(stepItem));
}

function renderCook(now) {
  const plan = cook.plan;
  $('dinner-in').textContent = formatCountdown(plan.readyAt - now);
  $('oven-temp').textContent = plan.ovenTemp == null ? 'No oven tonight' : `Oven ${plan.ovenTemp}°C`;
  renderBackToCook(now);
  renderJobs(now);
  renderCookSteps(now);
  renderNextAlarm(now);
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
  store.clearLastDinner();
  builder.reset();
}

// Settings lists: every saved meal and item, with Edit (meals) and Delete. Delete removes it from storage.
function renderSaved() {
  const fill = (id, names, kind) => {
    const ul = $(id);
    ul.replaceChildren();
    if (!names.length) ul.append(el('li', { class: 'muted' }, 'Nothing saved.'));
    for (const name of names.sort((a, b) => a.localeCompare(b))) {
      const row = el('li', { class: 'saved-row' }, el('span', { class: 'saved-name' }, name));
      if (kind === 'meal') row.append(el('button', { class: 'btn ghost saved-btn', type: 'button', 'data-edit': name }, 'Edit'));
      row.append(el('button', { class: 'btn ghost saved-btn del', type: 'button', 'data-del': name, 'data-kind': kind }, 'Delete'));
      ul.append(row);
    }
  };
  fill('saved-meals', Object.keys(store.getLibraryMeals()), 'meal');
  fill('saved-items', Object.keys(store.getLibraryItems()), 'item');
}

function bindSaved() {
  $('settings').addEventListener('click', e => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) {
      builder.openMeal(edit.dataset.edit);
      $('settings').hidden = true;
      $('settings-btn').setAttribute('aria-expanded', 'false');
      window.scrollTo(0, 0);
    } else if (del) {
      const { del: name, kind } = del.dataset;
      if (!confirm(`Delete "${name}" from your saved ${kind === 'meal' ? 'meals' : 'items'}? This can't be undone.`)) return;
      if (kind === 'meal') store.removeLibraryMeal(name);
      else store.removeLibraryItem(name);
      builder.redraw();
      renderSaved();
      $('settings-msg').textContent = `Deleted "${name}".`;
    }
  });
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
  // Done on a job: its countdown is ticked off and it leaves the list of jobs.
  $('jobs').addEventListener('click', e => {
    const btn = e.target.closest('.job-done');
    if (!btn || !cook) return;
    const index = Number(btn.closest('.job-timer').dataset.index);
    cook.done = [...new Set([...cook.done, index])];
    persistCooking();
    renderCook(Date.now());
  });
  // Done on the current step ticks it off; Undo (or the ✓) puts it back on the running plan.
  $('cook-steps').addEventListener('click', e => {
    if (!cook) return;
    const doneBtn = e.target.closest('[data-done]');
    const li = e.target.closest('li.done');
    if (doneBtn) {
      const index = Number(doneBtn.dataset.done);
      cook.done = [...new Set([...cook.done, index])];
      cook.rang = cook.rang.filter(i => i !== index);
      if (!cook.rang.length && !cook.rangReady) stopAlarm();
    } else if (li && e.target.closest('.dot, .step-undo')) {
      cook.done = cook.done.filter(i => i !== Number(li.dataset.index));
      stopAlarm();
    } else return;
    persistCooking();
    renderCook(Date.now());
  });
  $('settings-btn').addEventListener('click', () => {
    const box = $('settings');
    box.hidden = !box.hidden;
    $('settings-btn').setAttribute('aria-expanded', String(!box.hidden));
    $('settings-msg').textContent = '';
    if (!box.hidden) renderSaved();
  });
  bindSaved();
  $('backup-save').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dinnersync-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('settings-msg').textContent = 'Backup saved. Check your Downloads.';
  });
  $('backup-load').addEventListener('click', () => $('backup-file').click());
  $('backup-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const backup = store.readBackup(data);
      if (!backup) { $('settings-msg').textContent = "That isn't a DinnerSync backup file."; return; }
      const meals = Object.keys(backup.meals).length;
      const items = Object.keys(backup.items).length;
      if (!confirm(`Replace everything saved on this phone with ${meals} meals and ${items} items from the file?`)) return;
      store.importData(data);
      $('settings-msg').textContent = `Restored ${meals} meals and ${items} items.`;
      builder.redraw();
      renderSaved();
    } catch {
      $('settings-msg').textContent = "Couldn't read that file.";
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
      cookAlarmDone();
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
  // A meal plan (v6) already holds its steps. An older plan is rebuilt from its items so it gets the stage format.
  const preheatMinutes = Number.isFinite(saved.preheatMinutes) ? saved.preheatMinutes : 15;
  const plan = savedPlan.v === 6 && Array.isArray(savedPlan.steps)
    ? savedPlan
    : buildPlan({ items: savedPlan.items, readyAt: savedPlan.readyAt, now: Date.now(), preheatMinutes });
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
  builder = createBuilder({ root: $('setup'), store, onStart: openTimeline, onChange: syncLegacyDinner });
  bindTimelineScreen();
  bindCookScreen();
  bindLegacyTools();
  bindTimer();
  syncLegacyDinner();
  renderTimer();
  showNow();
  setInterval(showNow, 1000);

  // The timer is shown live (about 4 times a second); it is cheap to redraw.
  setInterval(renderTimer, 250);

  // Keep the "ready at" times fresh while the meal screen is open, but never redraw under a box being typed in.
  setInterval(() => {
    if ($('plan-screen').hidden || $('setup').contains(document.activeElement)) return;
    builder.redraw();
    syncLegacyDinner();
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
