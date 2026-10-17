import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustedMinutes, pickMain, buildPlan, cookingState } from '../js/plan.js';

const MIN = 60_000;
// 2026-10-16 17:05 local
const now = new Date(2026, 9, 16, 17, 5).getTime();
const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const dinner = [
  { name: 'Chicken', minutes: 90, temp: 180 },
  { name: 'Roast potatoes', minutes: 45, temp: 220 },
  { name: 'Veg', minutes: 20, temp: 200 },
];

test('adjustedMinutes scales time by temp ratio, rounded', () => {
  assert.equal(adjustedMinutes({ minutes: 45, temp: 220 }, 180), 55);
  assert.equal(adjustedMinutes({ minutes: 20, temp: 200 }, 180), 22);
  assert.equal(adjustedMinutes({ minutes: 90, temp: 180 }, 180), 90);
  assert.equal(adjustedMinutes({ minutes: 30, temp: 160 }, 200), 24); // hotter oven = shorter
});

test('pickMain chooses the longest cook', () => {
  assert.equal(pickMain(dinner).name, 'Chicken');
});

test('buildPlan: oven at main temp, steps in time order', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now, preheatMinutes: 15 });
  assert.equal(p.ovenTemp, 180);
  assert.equal(p.enoughTime, true);
  const s = p.steps.map(x => [x.type, x.name ?? null, x.at]);
  assert.deepEqual(s, [
    ['preheat', null, at(17, 15)],
    ['in', 'Chicken', at(17, 30)],
    ['in', 'Roast potatoes', at(18, 5)],
    ['in', 'Veg', at(18, 38)],
    ['ready', null, at(19, 0)],
  ]);
  const pot = p.items.find(i => i.name === 'Roast potatoes');
  assert.equal(pot.cookMinutes, 55);
});

test('buildPlan: every step has a readable message', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now });
  assert.match(p.steps[0].text, /preheat.*180°C/i);
  assert.match(p.steps[2].text, /Roast potatoes in/i);
  assert.match(p.steps[2].text, /180°C/);
});

test('buildPlan: not enough time gives earliest ready time', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now: at(17, 25), preheatMinutes: 15 });
  assert.equal(p.enoughTime, false);
  assert.equal(p.earliestReady, at(19, 10));
  assert.equal(p.shortByMinutes, 10);
});

test('buildPlan: preheat is editable', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now, preheatMinutes: 10 });
  assert.equal(p.steps[0].at, at(17, 20));
});

test('buildPlan: no items gives no plan', () => {
  const p = buildPlan({ items: [], readyAt: at(19, 0), now });
  assert.equal(p.steps.length, 0);
});

test('cookingState: before preheat', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now });
  const c = cookingState(p, at(17, 10));
  assert.equal(c.next.type, 'preheat');
  assert.equal(c.msToNext, 5 * MIN);
  assert.equal(c.msToDinner, 110 * MIN);
  assert.equal(c.current, null);
});

test('cookingState: during preheat shows preheat countdown', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now });
  const c = cookingState(p, at(17, 20));
  assert.equal(c.current.type, 'preheat');
  assert.equal(c.preheatLeftMs, 10 * MIN);
  assert.equal(c.next.name, 'Chicken');
});

test('cookingState: mid-cook', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now });
  const c = cookingState(p, at(18, 5));
  assert.equal(c.current.name, 'Roast potatoes');
  assert.equal(c.next.name, 'Veg');
  assert.equal(c.msToNext, 33 * MIN);
  assert.equal(c.preheatLeftMs, 0);
  assert.equal(c.done, false);
});

test('cookingState: done at ready time', () => {
  const p = buildPlan({ items: dinner, readyAt: at(19, 0), now });
  const c = cookingState(p, at(19, 0));
  assert.equal(c.done, true);
  assert.equal(c.msToDinner, 0);
});

test('slow cook stage: own step text with its setting, never sets or scales the oven temp', () => {
  const items = [
    { name: 'Chicken', stages: [{ method: 'oven', minutes: 90, temp: 180 }] },
    { name: 'Beef stew', stages: [{ method: 'slow', minutes: 240, setting: 'high' }] },
  ];
  const plan = buildPlan({ items, readyAt: at(23, 0), now, preheatMinutes: 15 });
  assert.equal(plan.ovenTemp, 180);
  const stew = plan.steps.find(s => s.name === 'Beef stew');
  assert.equal(stew.method, 'slow');
  assert.equal(stew.text, 'Beef stew into the slow cooker — High');
  assert.equal(stew.at, at(19, 0)); // 4 hr before dinner, not scaled
  assert.equal(stew.minutes, 240);
  // a slow cook alone needs no oven and no preheat
  const alone = buildPlan({ items: [items[1]], readyAt: at(23, 0), now, preheatMinutes: 15 });
  assert.equal(alone.ovenTemp, null);
  assert.equal(alone.steps.some(s => s.type === 'preheat'), false);
  assert.equal(alone.steps.find(s => s.name === 'Beef stew').text, 'Beef stew into the slow cooker — High');
});

test('slow cook setting defaults to Low in the step text', () => {
  const plan = buildPlan({ items: [{ name: 'Stew', stages: [{ method: 'slow', minutes: 240 }] }], readyAt: at(23, 0), now, preheatMinutes: 15 });
  assert.equal(plan.steps.find(s => s.name === 'Stew').text, 'Stew into the slow cooker — Low');
});

// Mince pie: fry mince ‖ (boil potatoes → mash), then build, then oven. group = runs one after another; track = side by side in a group.
const pie = {
  name: 'Mince pie',
  stages: [
    { method: 'hob', minutes: 25, label: 'Fry mince', group: 0, track: 0 },
    { method: 'hob', minutes: 15, label: 'Boil potatoes', group: 0, track: 1 },
    { method: 'prep', minutes: 5, label: 'Mash', group: 0, track: 1 },
    { method: 'prep', minutes: 5, label: 'Build pie', group: 1, track: 0 },
    { method: 'oven', minutes: 30, temp: 200, group: 2, track: 0 },
  ],
};

test('same-time tracks finish together, then the next group starts', () => {
  const plan = buildPlan({ items: [pie], readyAt: at(18, 0), now, preheatMinutes: 15 });
  const when = label => plan.steps.find(s => s.label === label)?.at;
  assert.equal(when('Fry mince'), at(17, 0));
  assert.equal(when('Boil potatoes'), at(17, 5));
  assert.equal(when('Mash'), at(17, 20));
  assert.equal(when('Build pie'), at(17, 25));
  assert.equal(when('Mince pie'), at(17, 30)); // the unlabelled oven stage uses the item name
  assert.equal(plan.items[0].cookMinutes, 60); // 25 (longest track) + 5 + 30
  assert.equal(plan.ovenTemp, 200);
  // preheat is 15 min before the oven stage, so it comes after the hob work has started
  assert.equal(plan.steps.find(s => s.type === 'preheat').at, at(17, 15));
  // steps come out in time order
  const ats = plan.steps.map(s => s.at);
  assert.deepEqual(ats, [...ats].sort((a, b) => a - b));
});

test('the longest track sets the group time, whichever track it is', () => {
  const item = { name: 'X', stages: [
    { method: 'hob', minutes: 10, label: 'Short', group: 0, track: 0 },
    { method: 'hob', minutes: 40, label: 'Long', group: 0, track: 1 },
  ] };
  const plan = buildPlan({ items: [item], readyAt: at(18, 0), now, preheatMinutes: 15 });
  assert.equal(plan.steps.find(s => s.label === 'Long').at, at(17, 20));
  assert.equal(plan.steps.find(s => s.label === 'Short').at, at(17, 50));
  assert.equal(plan.items[0].cookMinutes, 40);
});

test('stages with no group or track still run one after another', () => {
  const item = { name: 'Potatoes', stages: [
    { method: 'hob', minutes: 10, label: 'Boil' },
    { method: 'oven', minutes: 45, temp: 200, label: 'Roast' },
  ] };
  const plan = buildPlan({ items: [item], readyAt: at(18, 0), now, preheatMinutes: 15 });
  assert.equal(plan.steps.find(s => s.label === 'Boil').at, at(17, 5));
  assert.equal(plan.steps.find(s => s.label === 'Roast').at, at(17, 15));
});

test('prep stage: hands-on time, no oven, step text is just the label', () => {
  const plan = buildPlan({ items: [{ name: 'Salad', stages: [{ method: 'prep', minutes: 10, label: 'Chop salad' }] }], readyAt: at(18, 0), now, preheatMinutes: 15 });
  assert.equal(plan.ovenTemp, null);
  assert.equal(plan.steps.find(s => s.label === 'Chop salad').text, 'Chop salad');
  assert.equal(plan.steps.some(s => s.type === 'preheat'), false);
});
