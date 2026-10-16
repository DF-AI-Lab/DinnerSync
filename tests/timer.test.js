import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCountdown } from '../js/timer.js';

test('starts at 0:00, not running', () => {
  const t = createCountdown();
  assert.equal(t.remaining(0), 0);
  assert.equal(t.running, false);
  assert.equal(t.fraction(0), 0);
});

test('+1/+5/+10 min add up', () => {
  const t = createCountdown();
  t.add(60, 0); t.add(300, 0); t.add(600, 0);
  assert.equal(t.remaining(0), 16 * 60_000);
  assert.equal(t.fraction(0), 1);
});

test('start counts down, pause holds, start resumes', () => {
  const t = createCountdown();
  t.add(300, 0);
  t.start(0);
  assert.equal(t.running, true);
  assert.equal(t.remaining(60_000), 240_000);
  t.pause(60_000);
  assert.equal(t.running, false);
  assert.equal(t.remaining(200_000), 240_000);
  t.start(200_000);
  assert.equal(t.remaining(260_000), 180_000);
  assert.equal(t.fraction(260_000), 180 / 300);
});

test('start with nothing on it does nothing', () => {
  const t = createCountdown();
  t.start(0);
  assert.equal(t.running, false);
});

test('adding time while running extends it', () => {
  const t = createCountdown();
  t.add(60, 0);
  t.start(0);
  t.add(60, 30_000);
  assert.equal(t.remaining(30_000), 90_000);
});

test('hits 0: finished, stops, never negative', () => {
  const t = createCountdown();
  t.add(60, 0);
  t.start(0);
  assert.equal(t.finished(59_000), false);
  assert.equal(t.finished(61_000), true);
  assert.equal(t.remaining(61_000), 0);
  assert.equal(t.running, false);
  t.start(70_000); // nothing left: stays stopped
  assert.equal(t.running, false);
});

test('reset goes back to 0:00 and stopped', () => {
  const t = createCountdown();
  t.add(600, 0);
  t.start(0);
  t.reset();
  assert.equal(t.remaining(10_000), 0);
  assert.equal(t.running, false);
  assert.equal(t.finished(10_000), false);
});
