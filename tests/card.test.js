import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, stepStatuses, currentCard, spareMinutes } from '../js/plan.js';

const MIN = 60_000;
const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const plan = buildPlan({
  items: [{ name: 'Chicken', minutes: 90, temp: 180 }, { name: 'Veg', minutes: 20, temp: 180 }],
  readyAt: at(19, 0), now: at(17, 0), preheatMinutes: 15,
}); // steps: preheat 17:15, Chicken 17:30, Veg 18:40, ready 19:00

test('current step not due yet: NEXT badge, counts down to its start, no bar', () => {
  const c = currentCard(stepStatuses(plan, at(17, 0), []), at(17, 0));
  assert.equal(c.badge, 'NEXT');
  assert.equal(c.countdownMs, 15 * MIN);
  assert.equal(c.barPct, null);
  assert.equal(c.until, null);
});

test('current step due: NOW badge, counts down to the next step, bar shrinks', () => {
  const s = stepStatuses(plan, at(17, 20), []); // preheat due 17:15, chicken 17:30
  const c = currentCard(s, at(17, 20));
  assert.equal(c.badge, 'NOW');
  assert.equal(c.countdownMs, 10 * MIN);
  assert.equal(Math.round(c.barPct), 67); // 10 of 15 min left
  assert.equal(c.until, plan.steps[1].text);
  const later = currentCard(s, at(17, 29));
  assert.ok(later.barPct < c.barPct);
});

test('bar never below 0 when the next step is overdue', () => {
  const c = currentCard(stepStatuses(plan, at(17, 40), []), at(17, 40));
  assert.equal(c.barPct, 0);
  assert.equal(c.countdownMs, 0);
});

test('last step (dinner ready) current: no countdown target', () => {
  const c = currentCard(stepStatuses(plan, at(19, 0), [0, 1, 2]), at(19, 0));
  assert.equal(c.last, true);
  assert.equal(c.until, null);
});

test('everything done: no card', () => {
  assert.equal(currentCard(stepStatuses(plan, at(19, 1), [0, 1, 2, 3]), at(19, 1)), null);
});

test('times never shift when a step is done early', () => {
  const s = stepStatuses(plan, at(17, 0), [0]);
  const c = currentCard(s, at(17, 0));
  assert.equal(s[1].at, at(17, 30));
  assert.equal(c.badge, 'NEXT');
  assert.equal(c.countdownMs, 30 * MIN);
});

test('spare minutes before the next step', () => {
  assert.equal(spareMinutes(plan.steps[1], at(17, 0)), 30);
  assert.equal(spareMinutes(plan.steps[1], at(17, 31)), 0);
});
