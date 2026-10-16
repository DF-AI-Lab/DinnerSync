import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMinutes, splitMinutes, formatDuration } from '../js/plan.js';

test('hours + minutes to minutes', () => {
  assert.equal(toMinutes(1, 30), 90);
  assert.equal(toMinutes('', '45'), 45);
  assert.equal(toMinutes('2', ''), 120);
  assert.equal(toMinutes(0, 90), 90);
  assert.equal(toMinutes('x', -5), 0);
});

test('minutes to hours + minutes', () => {
  assert.deepEqual(splitMinutes(90), { h: 1, m: 30 });
  assert.deepEqual(splitMinutes(45), { h: 0, m: 45 });
});

test('formatDuration reads nicely', () => {
  assert.equal(formatDuration(90), '1 hr 30 min');
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(120), '2 hr');
});
