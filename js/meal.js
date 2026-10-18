// Pure meal logic. No DOM access.
//
// A step is { kind: 'prep'|'hob'|'oven'|'slow'|'rest', text, min, temp?, setting?: 'low'|'high', check?: { at, text } }.
// check is a reminder: its own alarm `at` minutes into the step.
// An item is { name, steps }. A meal is { name, together, groups, items }:
//   items   = "everything else": each item is timed to be ready at dinner.
//   groups  = built dishes (only when together is on): { name, items, finish }.
//             The items are cooked side by side and all done together, then the finish steps run
//             one after another up to dinner.

const MIN = 60_000;
export const DEFAULT_PREHEAT = 15;
export const KINDS = ['prep', 'hob', 'oven', 'slow', 'rest'];
export const KIND_LABEL = { prep: '🥄 Prep', hob: '🔥 Hob', oven: '♨️ Oven', slow: '🍲 Slow cook', rest: '⏸ Rest' };

export const step = (kind, text, min, temp, check) => ({
  kind, text, min, ...(temp ? { temp } : {}), ...(check ? { check } : {}),
});
export const sumMinutes = steps => steps.reduce((total, s) => total + s.min, 0);
const clone = x => JSON.parse(JSON.stringify(x));

// ---------- starter data ----------

export function starterItems() {
  const items = {
    'Roast potatoes': [step('prep', 'Peel potatoes', 15), step('hob', 'Boil', 25), step('rest', 'Rest / steam dry', 30), step('oven', 'Roast', 55, 200, { at: 30, text: 'Turn potatoes' })],
    'Roast chicken': [step('prep', 'Season, into tray', 10), step('oven', 'Roast', 80, 190), step('rest', 'Rest under foil', 20)],
    'Gammon joint': [step('hob', 'Simmer', 60), step('oven', 'Glaze & roast', 30, 200), step('rest', 'Rest', 15)],
    'Carrots': [step('prep', 'Peel & chop', 5), step('hob', 'Boil', 20)],
    'Peas': [step('hob', 'Boil', 5)],
    'Gravy': [step('hob', 'Make gravy', 10)],
    'Yorkshire puddings': [step('oven', 'Bake', 20, 220)],
    'Mince': [step('prep', 'Chop onion & carrot', 10), step('hob', 'Fry onion & mince', 25)],
    'Mash': [step('prep', 'Peel potatoes', 10), step('hob', 'Boil', 20), step('prep', 'Mash potatoes', 5)],
  };
  return clone(items);
}

export function starterMeals() {
  const pie = { name: "Shepherd's pie", items: ['Mince', 'Mash'], finish: [step('prep', 'Build pie', 5), step('oven', 'Bake', 30, 200)] };
  return clone({
    "Shepherd's pie & roasties": { together: true, groups: [pie], items: ['Roast potatoes', 'Peas'] },
    "Shepherd's pie": { together: true, groups: [pie], items: [] },
    'Chicken dinner': { items: ['Roast chicken', 'Roast potatoes', 'Carrots', 'Gravy'] },
    'Gammon dinner': { items: ['Gammon joint', 'Roast potatoes', 'Carrots', 'Peas'] },
  });
}

// ---------- saved <-> working meal ----------

// A saved meal names its items; the steps come from the saved-items library (a copy, so edits are separate).
export function mealFromSaved(saved, library, name = '') {
  const item = n => ({ name: n, steps: clone(library[n] ?? []) });
  const groups = (saved.groups ?? []).map(g => ({
    name: g.name ?? '', items: (g.items ?? []).map(item), finish: clone(g.finish ?? []),
  }));
  return {
    name,
    together: Boolean(saved.together ?? groups.length),
    groups,
    items: (saved.items ?? []).map(item),
  };
}

// What "Save as a meal" stores: item names (their steps live in the saved items) and the built dishes.
export function savedFromMeal(meal) {
  return {
    together: meal.together,
    items: meal.items.map(i => i.name),
    groups: meal.together
      ? meal.groups.map(g => ({ name: g.name, items: g.items.map(i => i.name), finish: clone(g.finish) }))
      : [],
  };
}

// ---------- scheduling ----------

const sharedKey = s => (s && s.kind === 'prep' && s.text.trim() ? s.text.trim().toLowerCase() : '');
const everyItem = meal => [...meal.items, ...(meal.together ? meal.groups.flatMap(g => g.items) : [])];

// Items in the meal that start with the same prep step: done once, the times added.
export function findShared(meal) {
  const by = new Map();
  for (const it of everyItem(meal)) {
    const key = sharedKey(it.steps[0]);
    if (!key) continue;
    if (!by.has(key)) by.set(key, { key, text: it.steps[0].text.trim(), names: [] });
    by.get(key).names.push(it.name);
  }
  return [...by.values()].filter(x => x.names.length > 1);
}

// Every row is { at, who, s, text, min, kind, temp?, ... } for a step, { at, who, remind } for a
// reminder, or { at, preheat } for the oven. Flags: fin (a built dish's finish step), prep1 (in the
// prep block), shared (one peel for several items).
const stepRow = (at, who, s, extra = {}) => ({ at, who, s, text: s.text, min: s.min, kind: s.kind, temp: s.temp, setting: s.setting, ...extra });

// Work backwards from dinner D (ms). Everything ends at dinner. A built dish's parts end together
// when its finish steps start. With prepFirst, the prep steps at the START of each item are done
// one after another in a block before any cooking; prep after cooking (mash, build pie) stays put.
export function schedule(meal, D, { prepFirst = true, preheat = DEFAULT_PREHEAT } = {}) {
  const rows = [];
  const queue = [];
  const shared = new Map();
  const sharedKeys = new Set(findShared(meal).map(x => x.key));

  const place = (item, end, who) => {
    let steps = item.steps;
    const key = sharedKey(steps[0]);
    if (key && sharedKeys.has(key)) {
      const first = steps[0];
      steps = steps.slice(1);
      if (!shared.has(key)) shared.set(key, { text: first.text.trim(), who: [], min: 0, cookAt: Infinity });
      const g = shared.get(key);
      g.who.push(item.name);
      g.min += first.min;
      g.cookAt = Math.min(g.cookAt, end - sumMinutes(steps) * MIN);
    }
    if (prepFirst) {
      const n = steps.findIndex(s => s.kind !== 'prep');
      const lead = n < 0 ? steps : steps.slice(0, n);
      if (lead.length) {
        steps = steps.slice(lead.length);
        queue.push({ who, lead, cookAt: end - sumMinutes(steps) * MIN });
      }
    }
    let t = end - sumMinutes(steps) * MIN;
    for (const s of steps) {
      rows.push(stepRow(t, who, s, { item: item.name }));
      if (s.check) rows.push({ at: t + s.check.at * MIN, who, remind: s.check.text });
      t += s.min * MIN;
    }
  };

  if (meal.together) {
    for (const g of meal.groups) {
      const dish = g.name || 'Built dish';
      const finStart = D - sumMinutes(g.finish) * MIN;
      g.items.forEach(it => place(it, finStart, `${dish} › ${it.name}`));
      let t = finStart;
      for (const s of g.finish) {
        rows.push(stepRow(t, dish, s, { fin: true, item: dish }));
        if (s.check) rows.push({ at: t + s.check.at * MIN, who: dish, remind: s.check.text });
        t += s.min * MIN;
      }
    }
  }
  meal.items.forEach(it => place(it, D, it.name));

  for (const g of shared.values()) {
    const s = { kind: 'prep', text: g.text, min: g.min };
    const who = g.who.join(' + ');
    if (prepFirst) queue.push({ who, lead: [s], cookAt: g.cookAt, shared: true });
    else rows.push(stepRow(g.cookAt - g.min * MIN, who, s, { shared: true, item: who }));
  }

  if (queue.length) {
    const cookStart = Math.min(D, ...rows.map(r => r.at), ...queue.map(q => q.cookAt));
    let t = cookStart - queue.reduce((total, q) => total + sumMinutes(q.lead), 0) * MIN;
    for (const q of queue.sort((a, b) => a.cookAt - b.cookAt)) {
      for (const s of q.lead) {
        rows.push(stepRow(t, q.who, s, { prep1: true, shared: q.shared, item: q.who }));
        if (s.check) rows.push({ at: t + s.check.at * MIN, who: q.who, remind: s.check.text });
        t += s.min * MIN;
      }
    }
  }

  const ovens = rows.filter(r => r.kind === 'oven').sort((a, b) => a.at - b.at);
  if (ovens.length) rows.push({ at: ovens[0].at - preheat * MIN, preheat: ovens[0].temp });
  return rows.sort((a, b) => a.at - b.at);
}

// Whole minutes from the first row (preheat included) to dinner. 0 for an empty meal.
export function totalMinutes(meal, opts = {}) {
  const rows = schedule(meal, 0, opts);
  return rows.length ? Math.round(-Math.min(...rows.map(r => r.at)) / MIN) : 0;
}

// How many more minutes "do all the prep first" adds.
export function prepFirstExtra(meal, opts = {}) {
  return totalMinutes(meal, { ...opts, prepFirst: true }) - totalMinutes(meal, { ...opts, prepFirst: false });
}

// A warning when two oven steps at different temperatures overlap, else ''.
export function ovenClash(rows) {
  const ovens = rows.filter(r => r.kind === 'oven' && r.temp);
  for (const a of ovens) {
    for (const b of ovens) {
      if (a !== b && a.temp !== b.temp && a.at < b.at + b.min * MIN && b.at < a.at + a.min * MIN) {
        return `${a.who} wants ${a.temp}°C and ${b.who} wants ${b.temp}°C at the same time. One oven, so pick a temperature for both.`;
      }
    }
  }
  return '';
}

// ---------- the plan the cook screen runs ----------

const SHARED_NOTE = ' · all of it, keep in cold water';

// The schedule as plan steps (see plan.js): preheat, 'in' steps, 'remind' steps and dinner.
// `say` is what an alarm reads out: it names the item, so a bare "Boil" is never ambiguous.
export function toPlan(meal, readyAt, now, { prepFirst = true, preheat = DEFAULT_PREHEAT } = {}) {
  const rows = schedule(meal, readyAt, { prepFirst, preheat });
  const itemIndex = new Map();
  const indexOf = name => {
    if (!itemIndex.has(name)) itemIndex.set(name, itemIndex.size);
    return itemIndex.get(name);
  };
  const ranked = [];
  for (const r of rows) {
    if (r.preheat) {
      ranked.push({ rank: 0, step: { type: 'preheat', at: r.at, text: `Preheat oven to ${r.preheat}°C`, say: `Preheat oven to ${r.preheat}°C` } });
    } else if (r.remind) {
      ranked.push({ rank: 2, step: { type: 'remind', at: r.at, name: r.who, text: `↻ ${r.remind}`, say: `${r.who}: ${r.remind}` } });
    } else {
      const action = r.text.trim() || KIND_LABEL[r.kind].split(' ').slice(1).join(' ');
      const text = `${action}${r.shared ? SHARED_NOTE : ''}${r.temp ? ` · ${r.temp}°C` : ''}${r.kind === 'slow' ? ` · ${r.setting === 'high' ? 'High' : 'Low'}` : ''}`;
      const label = `${r.item}: ${action}`;
      ranked.push({
        rank: 1,
        step: {
          type: 'in', name: r.who, item: indexOf(r.item), label, method: r.kind, at: r.at,
          text, say: `${r.who}: ${action}`, minutes: r.min, group: 0, track: 0,
          ...(r.prep1 ? { prep1: true } : {}),
        },
      });
    }
  }
  ranked.push({ rank: 3, step: { type: 'ready', at: readyAt, text: 'Dinner is ready!', say: 'Dinner is ready!' } });
  ranked.sort((a, b) => a.step.at - b.step.at || a.rank - b.rank);
  const steps = ranked.map(r => r.step);

  const earliestStep = Math.min(...steps.map(s => s.at));
  const earliestReady = Math.ceil((now + (readyAt - earliestStep)) / MIN) * MIN;
  const enoughTime = earliestReady <= readyAt;
  return {
    v: 6,
    ovenTemp: rows.find(r => r.kind === 'oven')?.temp ?? null,
    readyAt,
    items: [],
    steps,
    enoughTime,
    earliestReady,
    shortByMinutes: enoughTime ? 0 : Math.round((earliestReady - readyAt) / MIN),
  };
}
