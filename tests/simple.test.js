import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN, stepTime, nextEarly, totalMinutes, schedule, alarms, dishState, clock, countdown, nextMinute } from '../demo/js/simple.js';

const dinner = new Date(2026, 9, 22, 18, 35).getTime();
const mash = { name: 'Mash', time: 35, early: 0 };
const chicken = { name: 'Chicken', time: 30, early: 5 };
const peas = { name: 'Peas', time: 5, early: 0 };

test('time steps: 1 min up to 10, then 5', () => {
  assert.equal(stepTime(5, 1), 6);
  assert.equal(stepTime(10, 1), 15);
  assert.equal(stepTime(12, 1), 15);
  assert.equal(stepTime(15, -1), 10);
  assert.equal(stepTime(12, -1), 10);
  assert.equal(stepTime(10, -1), 9);
  assert.equal(stepTime(1, -1), 1);
});

test('done early cycles and wraps to off', () => {
  assert.equal(nextEarly(0), 5);
  assert.equal(nextEarly(20), 30);
  assert.equal(nextEarly(30), 0);
});

test('total = longest time + early', () => {
  assert.equal(totalMinutes([]), 0);
  assert.equal(totalMinutes([mash, chicken, peas]), 35);
  assert.equal(totalMinutes([{ ...chicken, early: 10 }, mash]), 40);
});

test('simple case: chicken 30, potatoes 20 go on 10 min later', () => {
  const { startAt, rows } = schedule([{ name: 'Chicken', time: 30, early: 0 }, { name: 'Potatoes', time: 20, early: 0 }], dinner);
  assert.equal(startAt, dinner - 30 * MIN);
  assert.equal(rows[1].onAt - startAt, 10 * MIN);
  assert.equal(rows[0].offAt, dinner);
  assert.equal(rows[1].offAt, dinner);
});

test('done early: chicken comes off 5 min before dinner', () => {
  const { startAt, rows } = schedule([mash, chicken, peas], dinner);
  assert.equal(startAt, dinner - 35 * MIN);
  assert.equal(rows[1].onAt, startAt);
  assert.equal(rows[1].offAt, dinner - 5 * MIN);
  assert.equal(rows[2].onAt, dinner - 5 * MIN);
});

test('alarms share a moment and end with dinner', () => {
  const list = alarms([mash, chicken, peas], dinner);
  assert.deepEqual(list.map(a => [(dinner - a.at) / MIN, a.text]), [
    [35, 'Put Mash & Chicken on'],
    [5, 'Take Chicken off · Put Peas on'],
    [0, "Dinner's ready!"],
  ]);
  assert.equal(list.at(-1).last, true);
});

test('three names read naturally', () => {
  const list = alarms([{ name: 'A', time: 10, early: 0 }, { name: 'B', time: 10, early: 0 }, { name: 'C', time: 10, early: 0 }], dinner);
  assert.equal(list[0].text, 'Put A, B & C on');
});

test('dish state: waiting, cooking, ready', () => {
  const { rows } = schedule([mash, peas], dinner);
  assert.equal(dishState(rows[1], dinner - 10 * MIN), 'waiting');
  assert.equal(dishState(rows[1], dinner - 2 * MIN), 'cooking');
  assert.equal(dishState(rows[1], dinner), 'ready');
});

test('clock and countdown text', () => {
  assert.equal(clock(dinner), '6:35pm');
  assert.equal(clock(new Date(2026, 9, 22, 0, 5).getTime()), '12:05am');
  assert.equal(countdown(23 * MIN), '23:00');
  assert.equal(countdown(62 * MIN + 9000), '1:02:09');
  assert.equal(countdown(-5), '0:00');
  assert.equal(nextMinute(dinner + 1), dinner + MIN);
});
