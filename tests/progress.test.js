import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, stepStatuses } from '../js/plan.js';

const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const plan = buildPlan({
  items: [{ name: 'Chicken', minutes: 90, temp: 180 }, { name: 'Veg', minutes: 20, temp: 180 }],
  readyAt: at(19, 0), now: at(17, 0), preheatMinutes: 15,
}); // steps: preheat 17:15, Chicken 17:30, Veg 18:40, ready 19:00

test('nothing done: first step is current, rest upcoming', () => {
  const s = stepStatuses(plan, at(17, 0), []);
  assert.deepEqual(s.map(x => x.status), ['current', 'upcoming', 'upcoming', 'upcoming']);
  assert.equal(s[0].due, false);
});

test('done steps are ticked; next not-done step is current', () => {
  const s = stepStatuses(plan, at(17, 31), [0, 1]);
  assert.deepEqual(s.map(x => x.status), ['done', 'done', 'current', 'upcoming']);
});

test('current step is due once its time has come', () => {
  const s = stepStatuses(plan, at(17, 31), [0]);
  assert.equal(s[1].status, 'current');
  assert.equal(s[1].due, true);
});

test('all done', () => {
  const s = stepStatuses(plan, at(19, 1), [0, 1, 2, 3]);
  assert.ok(s.every(x => x.status === 'done'));
});
