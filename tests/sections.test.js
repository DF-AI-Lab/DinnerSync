import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromSections, toSections, leadMinutes, buildPlan } from '../js/plan.js';
import { createStore } from '../js/store.js';

const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const now = at(16, 0);

// Mockup 5: a dish in 3 sections. Get ready (one after another) → Cook (lines side by side, all finish together) → Finish (one after another).
const pieSections = {
  ready: [{ method: 'prep', minutes: 10, label: 'Peel potatoes' }],
  cook: [
    [{ method: 'hob', minutes: 25, label: 'Fry mince' }],
    [{ method: 'hob', minutes: 15, label: 'Boil potatoes' }, { method: 'prep', minutes: 5, label: 'Mash' }],
  ],
  finish: [{ method: 'prep', minutes: 5, label: 'Build pie' }, { method: 'oven', minutes: 30, temp: 200, label: 'Into the oven' }],
};

test('fromSections: Get ready = group 0, Cook = group 1 one track per line, Finish = group 2', () => {
  const stages = fromSections(pieSections);
  assert.deepEqual(stages.map(s => [s.label, s.section, s.group, s.track]), [
    ['Peel potatoes', 'ready', 0, 0],
    ['Fry mince', 'cook', 1, 0],
    ['Boil potatoes', 'cook', 1, 1],
    ['Mash', 'cook', 1, 1],
    ['Build pie', 'finish', 2, 0],
    ['Into the oven', 'finish', 2, 0],
  ]);
  // the stage's own fields are kept
  assert.equal(stages[5].temp, 200);
  assert.equal(stages[0].method, 'prep');
});

test('fromSections: empty sections are skipped', () => {
  const stages = fromSections({ ready: [], cook: [[{ method: 'oven', minutes: 30, temp: 200 }]], finish: [] });
  assert.deepEqual(stages.map(s => [s.section, s.group, s.track]), [['cook', 1, 0]]);
  assert.deepEqual(fromSections({ ready: [], cook: [[], []], finish: [] }), []);
  // an empty cook line in the middle does not leave a gap in the track numbers
  const gap = fromSections({ cook: [[{ method: 'hob', minutes: 5 }], [], [{ method: 'hob', minutes: 10 }]] });
  assert.deepEqual(gap.map(s => s.track), [0, 1]);
});

test('the plan from sections: cook lines finish together, get ready before, finish after', () => {
  const plan = buildPlan({ items: [{ name: 'Mince pie', stages: fromSections(pieSections) }], readyAt: at(18, 0), now, preheatMinutes: 15 });
  const when = label => plan.steps.find(s => s.label === label)?.at;
  assert.equal(when('Peel potatoes'), at(16, 50));
  assert.equal(when('Fry mince'), at(17, 0));
  assert.equal(when('Boil potatoes'), at(17, 5));
  assert.equal(when('Mash'), at(17, 20));
  assert.equal(when('Build pie'), at(17, 25));
  assert.equal(when('Into the oven'), at(17, 30));
  assert.equal(plan.steps.find(s => s.type === 'preheat').at, at(17, 15));
});

test('toSections: items saved with sections come back the same', () => {
  const back = toSections({ name: 'Mince pie', stages: fromSections(pieSections) });
  const labels = list => list.map(s => s.label);
  assert.deepEqual(labels(back.ready), ['Peel potatoes']);
  assert.deepEqual(back.cook.map(labels), [['Fry mince'], ['Boil potatoes', 'Mash']]);
  assert.deepEqual(labels(back.finish), ['Build pie', 'Into the oven']);
  // a dish with only a Cook section
  const only = toSections({ name: 'Chicken', stages: fromSections({ cook: [[{ method: 'oven', minutes: 90, temp: 180 }]] }) });
  assert.deepEqual([only.ready.length, only.cook.length, only.finish.length], [0, 1, 0]);
});

test('toSections: old items with no sections still load', () => {
  // old single oven item: one cook line
  const chicken = toSections({ name: 'Chicken', minutes: 90, temp: 180 });
  assert.deepEqual([chicken.ready.length, chicken.cook.length, chicken.finish.length], [0, 1, 0]);
  assert.equal(chicken.cook[0][0].minutes, 90);
  assert.equal(chicken.cook[0][0].temp, 180);
  // old one-after-another stages: all in one cook line, in order
  const pots = toSections({ name: 'Potatoes', stages: [
    { method: 'hob', minutes: 10, label: 'Boil' },
    { method: 'oven', minutes: 45, temp: 220, label: 'Roast' },
  ] });
  assert.deepEqual(pots.cook.map(l => l.map(s => s.label)), [['Boil', 'Roast']]);
  assert.deepEqual([pots.ready.length, pots.finish.length], [0, 0]);
  // old v1.1.11 same-time item: groups before the same-time group = Get ready, the same-time group = Cook, after = Finish
  const old = toSections({ name: 'Mince pie', stages: [
    { method: 'prep', minutes: 10, label: 'Peel', group: 0, track: 0 },
    { method: 'hob', minutes: 25, label: 'Fry mince', group: 1, track: 0 },
    { method: 'hob', minutes: 15, label: 'Boil potatoes', group: 1, track: 1 },
    { method: 'prep', minutes: 5, label: 'Mash', group: 1, track: 1 },
    { method: 'prep', minutes: 5, label: 'Build pie', group: 2, track: 0 },
    { method: 'oven', minutes: 30, temp: 200, group: 3, track: 0 },
  ] });
  assert.deepEqual(old.ready.map(s => s.label), ['Peel']);
  assert.deepEqual(old.cook.map(l => l.map(s => s.label)), [['Fry mince'], ['Boil potatoes', 'Mash']]);
  assert.deepEqual(old.finish.map(s => s.label ?? s.method), ['Build pie', 'oven']);
});

test('leadMinutes: total time from the first step (preheat included) to ready', () => {
  const pie = { name: 'Mince pie', stages: fromSections(pieSections) };
  assert.equal(leadMinutes({ items: [pie], preheatMinutes: 15 }), 70);
  // the preheat starts before the oven stage: 15 + 30
  assert.equal(leadMinutes({ items: [{ name: 'Veg', minutes: 30, temp: 200 }], preheatMinutes: 15 }), 45);
  assert.equal(leadMinutes({ items: [{ name: 'Veg', minutes: 30, temp: 200 }], preheatMinutes: 0 }), 30);
  // no oven: no preheat
  assert.equal(leadMinutes({ items: [{ name: 'Pasta', stages: [{ method: 'hob', minutes: 12 }] }], preheatMinutes: 15 }), 12);
  assert.equal(leadMinutes({ items: [], preheatMinutes: 15 }), 0);
});

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test('saved items keep each stage\'s section', () => {
  const s = createStore(memStorage());
  s.saveItem({ name: 'Mince pie', stages: fromSections(pieSections) });
  const back = s.getSavedItems()[0];
  assert.deepEqual(back.stages.map(st => st.section), ['ready', 'cook', 'cook', 'cook', 'finish', 'finish']);
  assert.deepEqual(toSections(back).cook.map(l => l.map(st => st.label)), [['Fry mince'], ['Boil potatoes', 'Mash']]);
});
