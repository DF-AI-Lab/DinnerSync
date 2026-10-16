import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, alarmSteps } from '../js/plan.js';

const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const plan = buildPlan({
  items: [{ name: 'Chicken', minutes: 90, temp: 180 }, { name: 'Veg', minutes: 20, temp: 180 }],
  readyAt: at(19, 0), now: at(17, 0), preheatMinutes: 15,
}); // steps: preheat 17:15, Chicken 17:30, Veg 18:40, ready 19:00

test('steps whose time arrives sound', () => {
  assert.deepEqual(alarmSteps(plan, at(17, 14), at(17, 15), []).map(s => s.type), ['preheat']);
});

test('a step already marked done does not sound when its time comes', () => {
  assert.deepEqual(alarmSteps(plan, at(17, 29), at(17, 30), [0, 1]), []);
});

test('only steps inside the window sound', () => {
  assert.deepEqual(alarmSteps(plan, at(17, 15), at(17, 29), []), []);
  assert.equal(alarmSteps(plan, at(17, 0), at(17, 31), [1]).length, 1); // preheat only
});
