import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, cookingState, normalizeItem, pickMain } from '../js/plan.js';

const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const now = at(17, 0);

const chicken = { name: 'Chicken', stages: [
  { method: 'oven', minutes: 90, temp: 180 },
  { method: 'rest', minutes: 15 },
] };
const potatoes = { name: 'Roast potatoes', stages: [
  { method: 'hob', minutes: 10 },
  { method: 'oven', minutes: 45, temp: 220 },
] };

test('normalizeItem: old single-stage item becomes one oven stage', () => {
  const n = normalizeItem({ name: 'Veg', minutes: 20, temp: 200 });
  assert.deepEqual(n.stages, [{ method: 'oven', minutes: 20, temp: 200 }]);
});

test('main item = longest oven time; oven temp from it', () => {
  assert.equal(pickMain([potatoes, chicken]).name, 'Chicken');
  const p = buildPlan({ items: [potatoes, chicken], readyAt: at(19, 30), now });
  assert.equal(p.ovenTemp, 180);
});

test('stages chain back-to-back; only oven stages are scaled', () => {
  const p = buildPlan({ items: [chicken, potatoes], readyAt: at(19, 30), now, preheatMinutes: 15 });
  const s = p.steps.map(x => [x.type, x.name ?? null, x.method ?? null, x.at]);
  assert.deepEqual(s, [
    ['preheat', null, null, at(17, 30)],
    ['in', 'Chicken', 'oven', at(17, 45)],
    ['in', 'Roast potatoes', 'hob', at(18, 25)],   // 55 min oven (scaled) + 10 hob before 19:30
    ['in', 'Roast potatoes', 'oven', at(18, 35)],
    ['in', 'Chicken', 'rest', at(19, 15)],
    ['ready', null, null, at(19, 30)],
  ]);
  const pot = p.items.find(i => i.name === 'Roast potatoes');
  assert.deepEqual(pot.stages.map(st => st.cookMinutes), [10, 55]);
});

test('step text says what to do for each method', () => {
  const p = buildPlan({ items: [chicken, potatoes], readyAt: at(19, 30), now });
  const t = p.steps.map(x => x.text).join('\n');
  assert.match(t, /Roast potatoes.*hob/i);
  assert.match(t, /Roast potatoes.*oven.*180°C/i);
  assert.match(t, /Chicken.*rest/i);
});

test('preheat lines up with the first oven stage, not a hob stage', () => {
  const p = buildPlan({ items: [potatoes], readyAt: at(19, 0), now, preheatMinutes: 15 });
  // oven 45 at 220 (main, unscaled), hob 10 before it
  assert.deepEqual(p.steps.map(x => [x.type, x.method ?? null, x.at]), [
    ['in', 'hob', at(18, 5)],
    ['preheat', null, at(18, 0)],
    ['in', 'oven', at(18, 15)],
    ['ready', null, at(19, 0)],
  ].sort((a, b) => a[2] - b[2]));
});

test('hob-only dinner: no oven, no preheat', () => {
  const p = buildPlan({ items: [{ name: 'Pasta', stages: [{ method: 'hob', minutes: 12 }] }], readyAt: at(18, 0), now });
  assert.equal(p.ovenTemp, null);
  assert.deepEqual(p.steps.map(x => x.type), ['in', 'ready']);
});

test('enough-time check counts the whole chain and preheat', () => {
  // chicken needs preheat 15 + 90 oven + 15 rest = 120 min
  const p = buildPlan({ items: [chicken], readyAt: at(18, 50), now, preheatMinutes: 15 });
  assert.equal(p.enoughTime, false);
  assert.equal(p.earliestReady, at(19, 0));
  assert.equal(p.shortByMinutes, 10);
});

test('cookingState walks through stages', () => {
  const p = buildPlan({ items: [chicken, potatoes], readyAt: at(19, 30), now });
  const c = cookingState(p, at(18, 26));
  assert.equal(c.current.method, 'hob');
  assert.equal(c.next.method, 'oven');
  assert.equal(c.next.name, 'Roast potatoes');
});

test('stage label replaces item name in step text', () => {
  const item = { name: 'Potatoes', stages: [
    { method: 'hob', minutes: 10, label: 'Boil potatoes' },
    { method: 'oven', minutes: 45, temp: 200, label: 'Roast potatoes' },
  ] };
  const p = buildPlan({ items: [item], readyAt: at(19, 0), now });
  const t = p.steps.filter(s => s.type === 'in').map(s => s.text);
  assert.match(t[0], /^Boil potatoes on the hob/);
  assert.match(t[1], /^Roast potatoes into the oven/);
  assert.equal(p.steps.find(s => s.method === 'hob').label, 'Boil potatoes');
});

test('blank stage label falls back to item name', () => {
  const p = buildPlan({ items: [{ name: 'Veg', stages: [{ method: 'hob', minutes: 5, label: '  ' }] }], readyAt: at(18, 0), now });
  assert.match(p.steps[0].text, /^Veg on the hob/);
});
