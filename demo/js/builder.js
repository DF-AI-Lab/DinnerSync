// The "What are you cooking?" screen: meal name and saved meals, built dishes, everything else,
// items made of named steps, and the "When's it ready?" card. It draws into `root`, keeps the
// state of the meal being set up, and tells the app when "Start timers" is tapped.
// Scheduling lives in meal.js; this file is screen and state only.

import {
  KIND_LABEL, KINDS, step, sumMinutes, mealFromSaved, savedFromMeal, totalMinutes, DEFAULT_PREHEAT,
} from './meal.js';

const MIN = 60_000;
const QUARTER = 15 * MIN; // "Ready later" moves in 15-minute steps
const clone = x => JSON.parse(JSON.stringify(x));
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const up15 = ms => Math.ceil(ms / QUARTER) * QUARTER;
const fmtT = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);
const clock = t => {
  const d = new Date(t);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
};

// What a "+ Prep / + Hob / + Oven / + Slow / + Rest" button adds. A slow cook is hours, so it taps in 30s.
const newStep = kind => {
  const s = step(kind, '', kind === 'prep' ? 10 : kind === 'slow' ? 240 : 15, kind === 'oven' ? 200 : 0);
  if (kind === 'slow') s.setting = 'low';
  return s;
};

export function createBuilder({ root, store, now = Date.now, onStart = () => {}, onChange = () => {} }) {
  let uid = 1;
  const emptyMeal = () => ({ name: '', together: false, groups: [], items: [] });
  const S = {
    meal: emptyMeal(), mode: 'now', laterAt: 0, prepFirst: true, preheat: DEFAULT_PREHEAT, toast: '', focusNew: '',
  };

  // ---------- state ----------

  // Working items and groups carry an id (to find them from a tap) and `open` (item shown open).
  const own = meal => ({
    name: meal.name ?? '',
    together: Boolean(meal.together),
    groups: (meal.groups ?? []).map(g => ({ id: uid++, name: g.name ?? '', items: g.items.map(ownItem), finish: g.finish ?? [] })),
    items: (meal.items ?? []).map(ownItem),
  });
  const ownItem = it => ({ id: uid++, name: it.name, steps: it.steps ?? [], open: false });
  const strip = meal => ({
    name: meal.name,
    together: meal.together,
    groups: meal.groups.map(g => ({ name: g.name, items: g.items.map(i => ({ name: i.name, steps: clone(i.steps) })), finish: clone(g.finish) })),
    items: meal.items.map(i => ({ name: i.name, steps: clone(i.steps) })),
  });

  const allItems = () => [...S.meal.items, ...S.meal.groups.flatMap(g => g.items)];
  const listOf = key => (key === 'main' ? S.meal.items : S.meal.groups.find(g => g.id === +key).items);
  const stepsOf = owner => (String(owner).startsWith('fin')
    ? S.meal.groups.find(g => g.id === +String(owner).slice(3)).finish
    : allItems().find(i => i.id === +owner).steps);
  const opts = () => ({ prepFirst: S.prepFirst, preheat: S.preheat });
  const total = () => totalMinutes(S.meal, opts());
  const soon = () => Math.ceil((now() + total() * MIN) / MIN) * MIN;

  // The dinner time. Start now: the soonest. Ready later: what was picked, never before the soonest.
  function readyAt() {
    const s = soon();
    if (S.mode === 'now') return s;
    if (S.laterAt < s) S.laterAt = up15(s);
    return S.laterAt;
  }

  function save() {
    store.saveTonight({ meal: strip(S.meal), mode: S.mode, laterAt: S.laterAt, prepFirst: S.prepFirst });
    onChange();
  }

  // Any change to an item's steps updates its saved copy straight away. Finish steps are saved with the meal.
  function autosave(owner) {
    if (String(owner).startsWith('fin')) return;
    const item = allItems().find(i => i.id === +owner);
    if (item && item.name.trim() && item.steps.length) store.saveLibraryItem(item.name, clone(item.steps));
  }

  function loadMeal(name) {
    const saved = store.getLibraryMeals()[name];
    if (!saved) return;
    S.meal = own(mealFromSaved(saved, store.getLibraryItems(), name));
  }

  function addItem(list, name) {
    const lib = store.getLibraryItems();
    const known = Object.keys(lib).find(k => sameName(k, name));
    const item = ownItem({ name: known ?? name.trim(), steps: clone(lib[known] ?? []) });
    item.open = !item.steps.length; // a new item opens so its steps can be added
    list.push(item);
  }

  // ---------- drawing ----------

  const options = (obj, placeholder) => `<option value="">${placeholder}</option>${Object.keys(obj).map(k => `<option>${esc(k)}</option>`).join('')}`;

  const pickRow = key => `<div class="b-pickrow">
      <input class="b-item-add" data-list="${key}" placeholder="Type an item, press Enter" aria-label="Add an item" enterkeyhint="done" autocomplete="off">
      <select class="b-item-pick" data-list="${key}" aria-label="Saved items">${options(store.getLibraryItems(), 'Saved items')}</select>
    </div>`;

  const stepper = (act, owner, i, d, value, less, more) => `<div class="b-stepper">
      <button type="button" data-act="${act}" data-o="${owner}" data-i="${i}" data-d="${-d}" aria-label="${less}">−</button>
      <span class="b-val">${value}</span>
      <button type="button" data-act="${act}" data-o="${owner}" data-i="${i}" data-d="${d}" aria-label="${more}">+</button>
    </div>`;

  function stepsHtml(owner, steps) {
    return steps.map((s, i) => `${i ? '<div class="b-then">then</div>' : ''}
      <div class="b-stage">
        <div class="b-st">
          <span class="b-tag ${s.kind}">${KIND_LABEL[s.kind]}</span>
          <input class="b-st-name" data-o="${owner}" data-i="${i}" value="${esc(s.text)}" placeholder="What are you doing? e.g. Peel potatoes" aria-label="Step name" enterkeyhint="done" autocomplete="off">
          <button type="button" class="b-x" data-act="rmst" data-o="${owner}" data-i="${i}" aria-label="Remove step">✕</button>
        </div>
        <div class="b-steppers ${s.kind === 'oven' || s.kind === 'slow' ? 'two' : ''}">
          ${stepper('min', owner, i, s.kind === 'slow' ? 30 : 5, fmtT(s.min), s.kind === 'slow' ? '30 min less' : '5 min less', s.kind === 'slow' ? '30 min more' : '5 min more')}
          ${s.kind === 'slow' ? `<div class="b-seg" role="group" aria-label="Slow cooker setting">${['low', 'high'].map(v => `<button type="button" class="${(s.setting ?? 'low') === v ? 'on' : ''}" data-act="slowset" data-o="${owner}" data-i="${i}" data-v="${v}" aria-pressed="${(s.setting ?? 'low') === v}">${v === 'low' ? 'Low' : 'High'}</button>`).join('')}</div>` : ''}
          ${s.kind === 'oven' ? stepper('temp', owner, i, 10, `${s.temp}°`, '10 degrees cooler', '10 degrees hotter') : ''}
        </div>
        ${s.check ? `<div class="b-check">
            <span class="b-check-mark" aria-hidden="true">↻</span>
            <input class="b-check-text" data-o="${owner}" data-i="${i}" value="${esc(s.check.text)}" placeholder="e.g. Turn potatoes" aria-label="Reminder" enterkeyhint="done" autocomplete="off">
            ${stepper('chk', owner, i, 5, `after ${s.check.at} min`, 'Reminder 5 min earlier', 'Reminder 5 min later')}
            <button type="button" class="b-x" data-act="rmchk" data-o="${owner}" data-i="${i}" aria-label="Remove reminder">✕</button>
          </div>`
          : `<button type="button" class="b-add b-add-chk" data-act="addchk" data-o="${owner}" data-i="${i}">+ Reminder (its own alarm)</button>`}
      </div>`).join('');
  }

  const addRow = owner => `<div class="b-addrow">${KINDS.map(k => `<button type="button" class="b-add" data-act="addst" data-o="${owner}" data-k="${k}">+ ${KIND_LABEL[k].split(' ').slice(1).join(' ')}</button>`).join('')}</div>`;

  function itemsHtml(list) {
    return `<div class="b-items">${list.map(it => `<div class="b-item ${it.open ? 'open' : ''}" data-id="${it.id}">
        <button type="button" class="b-item-head" data-act="open" data-o="${it.id}" aria-expanded="${it.open}">
          <span class="b-item-name">${esc(it.name)}</span>
          <span class="b-item-time">${it.steps.length ? fmtT(sumMinutes(it.steps)) : 'add steps'}</span>
          <span class="b-chev" aria-hidden="true">${it.open ? '▲' : '▼'}</span>
        </button>
        ${it.steps.length ? `<div class="b-strip" aria-hidden="true">${it.steps.map(s => `<i class="k-${s.kind}" style="flex:${s.min}"></i>`).join('')}</div>` : ''}
        ${it.open ? `<div class="b-item-foot"><span class="b-saved-note">✓ Changes save to Saved items</span><button type="button" class="b-x" data-act="rm" data-o="${it.id}">Remove item</button></div>
          <div class="b-stages">${stepsHtml(it.id, it.steps)}${addRow(it.id)}</div>` : ''}
      </div>`).join('')}</div>`;
  }

  function draw() {
    const meal = S.meal;
    const mins = total();
    const asap = soon();
    const at = readyAt();
    const dishName = meal.groups.find(g => g.name)?.name || 'the dish';

    let h = `<div class="b-card">
        <span class="b-cap">What are you cooking?</span>
        <div class="b-pickrow">
          <input id="meal-name" class="b-meal-input" placeholder="e.g. Sunday dinner" aria-label="Meal name" value="${esc(meal.name)}" autocomplete="off" enterkeyhint="done">
          <select id="meal-pick" aria-label="Saved meals">${options(store.getLibraryMeals(), 'Saved meals')}</select>
        </div>
        <label class="b-switch ${meal.together ? 'on' : ''}">
          <input type="checkbox" id="together" ${meal.together ? 'checked' : ''}>
          <span><b>Cook some together first</b><span class="b-hint">For a built dish like a pie: cook the parts, then build and finish it.</span></span>
        </label>
      </div>`;

    if (meal.together) {
      for (const g of meal.groups) {
        h += `<div class="b-card b-group">
            <div class="b-group-head"><span class="b-cap">🥧 Built dish</span>${meal.groups.length > 1 ? `<button type="button" class="b-x" data-act="rmgroup" data-o="${g.id}">Remove</button>` : ''}</div>
            <input class="b-group-name" data-g="${g.id}" value="${esc(g.name)}" placeholder="Name it, e.g. Shepherd's pie" aria-label="Built dish name" autocomplete="off" enterkeyhint="done">
            <div class="b-phase"><b>1 · Cook these first</b><span>side by side, all done together</span></div>
            ${pickRow(g.id)}
            ${itemsHtml(g.items)}
            <div class="b-down">↓ when they're all done</div>
            <div class="b-phase"><b>2 · Then finish</b><span>one after another</span></div>
            <div class="b-stages fin">${stepsHtml(`fin${g.id}`, g.finish)}</div>
            ${addRow(`fin${g.id}`)}
          </div>`;
      }
      h += '<button type="button" class="b-add b-another" data-act="addgroup">+ Another built dish</button>';
    }

    h += `<div class="b-card">
        <span class="b-cap">${meal.together ? 'Everything else' : 'Items'}</span>
        ${meal.together ? `<p class="b-hint">Cooks alongside and is ready at dinner, with ${esc(dishName)}.</p>` : ''}
        ${pickRow('main')}
        ${itemsHtml(meal.items)}
      </div>`;

    h += `<div class="b-card">
        <span class="b-cap">When's it ready? · takes ${fmtT(mins)}</span>
        <div class="b-seg" role="group" aria-label="When to start">
          <button type="button" data-act="mode" data-m="now" class="${S.mode === 'now' ? 'on' : ''}" aria-pressed="${S.mode === 'now'}">Start now</button>
          <button type="button" data-act="mode" data-m="later" class="${S.mode === 'later' ? 'on' : ''}" aria-pressed="${S.mode === 'later'}">Ready later</button>
        </div>
        ${S.mode === 'now'
    ? `<p class="b-when-text">Start now → <b>ready at ${clock(asap)}</b></p>`
    : `<div class="b-stepper"><button type="button" data-act="later" data-d="-15" aria-label="15 minutes earlier">−</button><span class="b-val">Ready at ${clock(at)}</span><button type="button" data-act="later" data-d="15" aria-label="15 minutes later">+</button></div>
           <p class="b-when-text">First alarm at <b>${clock(at - mins * MIN)}</b></p>`}
        <div class="b-preheat"><span>Oven preheat</span>
          <div class="b-stepper"><button type="button" data-act="preheat" data-d="-5" aria-label="5 minutes less preheat">−</button><span class="b-val">${S.preheat} min</span><button type="button" data-act="preheat" data-d="5" aria-label="5 minutes more preheat">+</button></div>
        </div>
        <button type="button" class="b-go" data-act="go">Start timers</button>
        <div class="b-addrow"><button type="button" class="b-save" data-act="savemeal">Save as a meal</button></div>
        <p class="b-toast" role="status">${esc(S.toast)}</p>
      </div>`;

    root.innerHTML = h;
    if (S.focusNew) {
      const [o, i] = S.focusNew.split(':');
      root.querySelector(`.b-st-name[data-o="${o}"][data-i="${i}"]`)?.focus();
      S.focusNew = '';
    }
  }

  const refresh = () => { save(); draw(); };

  // ---------- events ----------

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act, o, i, d, k } = b.dataset;
    const item = allItems().find(x => x.id === +o);
    const index = Number(i);
    S.toast = '';
    if (act === 'open') item.open = !item.open;
    else if (act === 'rm') {
      S.meal.items = S.meal.items.filter(x => x !== item);
      S.meal.groups.forEach(g => { g.items = g.items.filter(x => x !== item); });
    } else if (act === 'min') {
      const s = stepsOf(o)[index];
      s.min = Math.min(600, Math.max(5, s.min + Number(d)));
      if (s.check) s.check.at = Math.min(s.check.at, s.min);
    } else if (act === 'slowset') {
      stepsOf(o)[index].setting = b.dataset.v === 'high' ? 'high' : 'low';
    } else if (act === 'temp') {
      const s = stepsOf(o)[index];
      s.temp = Math.min(250, Math.max(100, s.temp + Number(d)));
    } else if (act === 'rmst') stepsOf(o).splice(index, 1);
    else if (act === 'addst') {
      stepsOf(o).push(newStep(k));
      S.focusNew = `${o}:${stepsOf(o).length - 1}`;
    } else if (act === 'addchk') {
      const s = stepsOf(o)[index];
      s.check = { at: Math.max(5, Math.round(s.min / 2 / 5) * 5), text: 'Check' };
    } else if (act === 'chk') {
      const s = stepsOf(o)[index];
      s.check.at = Math.min(s.min, Math.max(5, s.check.at + Number(d)));
    } else if (act === 'rmchk') delete stepsOf(o)[index].check;
    else if (act === 'addgroup') S.meal.groups.push({ id: uid++, name: '', items: [], finish: [] });
    else if (act === 'rmgroup') S.meal.groups = S.meal.groups.filter(g => g.id !== +o);
    else if (act === 'mode') {
      S.mode = b.dataset.m;
      if (S.mode === 'later') S.laterAt = up15(Math.max(S.laterAt, soon()));
    } else if (act === 'later') S.laterAt = Math.max(up15(soon()), readyAt() + Number(d) * MIN);
    else if (act === 'preheat') {
      S.preheat = Math.min(60, Math.max(0, S.preheat + Number(d)));
      store.saveSettings({ preheatMinutes: S.preheat });
    } else if (act === 'savemeal') saveMeal();
    else if (act === 'go') {
      if (!total()) S.toast = 'Add an item with some steps first.';
      else { save(); draw(); onStart(); return; }
    }
    if (['min', 'temp', 'slowset', 'rmst', 'addst', 'addchk', 'chk', 'rmchk'].includes(act)) autosave(o);
    refresh();
  });

  function saveMeal() {
    const name = S.meal.name.trim();
    if (!name) { S.toast = 'Give the meal a name first.'; return; }
    for (const item of allItems()) if (item.steps.length && item.name.trim()) store.saveLibraryItem(item.name, clone(item.steps));
    store.saveLibraryMeal(name, savedFromMeal(S.meal));
    S.toast = `Saved "${name}". It's in Saved meals now.`;
  }

  root.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'meal-pick' && t.value) loadMeal(t.value);
    else if (t.classList.contains('b-item-pick') && t.value) addItem(listOf(t.dataset.list), t.value);
    else if (t.id === 'meal-name') { S.meal.name = t.value.trim(); save(); return; }
    else if (t.id === 'together') {
      S.meal.together = t.checked;
      if (t.checked && !S.meal.groups.length) S.meal.groups.push({ id: uid++, name: '', items: [], finish: [] });
    } else return;
    S.toast = '';
    refresh();
  });

  // Names and reminder text update as you type and nothing redraws, so the box keeps focus.
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.classList.contains('b-st-name')) stepsOf(t.dataset.o)[t.dataset.i].text = t.value;
    else if (t.classList.contains('b-check-text')) stepsOf(t.dataset.o)[t.dataset.i].check.text = t.value;
    else if (t.classList.contains('b-group-name')) S.meal.groups.find(g => g.id === +t.dataset.g).name = t.value;
    else if (t.id === 'meal-name') S.meal.name = t.value;
    else return;
    if (t.dataset.o !== undefined) autosave(t.dataset.o);
    save();
  });

  root.addEventListener('keydown', e => {
    const t = e.target;
    if (e.key !== 'Enter') return;
    if (t.classList.contains('b-item-add')) {
      e.preventDefault();
      if (!t.value.trim()) return;
      const key = t.dataset.list;
      addItem(listOf(key), t.value);
      refresh();
      root.querySelector(`.b-item-add[data-list="${key}"]`).focus();
    } else if (t.matches('.b-st-name, .b-check-text, .b-group-name, #meal-name')) {
      t.blur();
    }
  });

  // ---------- startup, and what the app can ask ----------

  const saved = store.getTonight();
  if (saved) {
    S.meal = own({ ...emptyMeal(), ...saved.meal });
    S.mode = saved.mode === 'later' ? 'later' : 'now';
    S.laterAt = Number(saved.laterAt) || 0;
    S.prepFirst = saved.prepFirst !== false;
  }
  S.preheat = store.getSettings().preheatMinutes;
  draw();

  return {
    // Everything the plan needs, as plain data.
    state: () => ({ meal: strip(S.meal), readyAt: readyAt(), mode: S.mode, prepFirst: S.prepFirst, preheat: S.preheat }),
    setPrepFirst(on) { S.prepFirst = on; save(); draw(); },
    // Ready at a time picked outside this screen (the hidden "When's dinner" panel).
    setLater(at) { S.mode = 'later'; S.laterAt = at; save(); draw(); },
    setNow() { S.mode = 'now'; save(); draw(); },
    reset() { S.meal = own(emptyMeal()); S.mode = 'now'; S.prepFirst = true; S.toast = ''; store.clearTonight(); onChange(); draw(); },
    // Put a saved meal on the home page so it can be changed (Save as a meal with the same name replaces it).
    openMeal(name) { loadMeal(name); S.mode = 'now'; S.toast = `Editing "${name}". Change it, then Save as a meal.`; save(); draw(); },
    // A step was renamed while cooking: make the saved items, saved meals and tonight's meal say the same.
    // owners is the item (or items, joined with " + ") or built dish the step belongs to.
    renameStep({ owners, kind, from, to }) {
      const names = String(owners).split(' + ');
      const hit = st => st.kind === kind && st.text.trim() === from;
      const rename = steps => { let n = 0; for (const st of steps) if (hit(st)) { st.text = to; n++; } return n; };
      const lib = store.getLibraryItems();
      for (const name of names) if (lib[name] && rename(lib[name])) store.saveLibraryItem(name, lib[name]);
      const meals = store.getLibraryMeals();
      for (const [mealName, m] of Object.entries(meals)) {
        let changed = 0;
        for (const g of m.groups ?? []) if (names.includes(g.name)) changed += rename(g.finish ?? []);
        if (changed) store.saveLibraryMeal(mealName, m);
      }
      for (const i of allItems()) if (names.includes(i.name)) rename(i.steps);
      for (const g of S.meal.groups) if (names.includes(g.name)) rename(g.finish);
      save();
      draw();
    },
    redraw: draw,
  };
}
