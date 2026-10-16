import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringWav, RING } from '../js/ring.js';

const rate = 8000;
const bytes = ringWav(rate);
const text = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
const samples = bytes.slice(44);
// Loudness of a time window: average distance from silence (128)
const loud = (from, to) => {
  const part = samples.slice(Math.round(from * rate), Math.round(to * rate));
  return part.reduce((s, v) => s + Math.abs(v - 128), 0) / part.length;
};

test('ring is a valid 8-bit mono WAV', () => {
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(36, 4), 'data');
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(24, true), rate);
  assert.equal(view.getUint16(34, true), 8);
  assert.equal(view.getUint32(40, true), samples.length);
});

test('ring pattern: ring, short gap, ring, long pause (one loop)', () => {
  assert.equal(samples.length, Math.round(RING.loopSeconds * rate));
  assert.ok(loud(0.05, 0.35) > 40, 'first ring is loud');
  assert.ok(loud(0.45, 0.55) < 2, 'short gap is quiet');
  assert.ok(loud(0.65, 0.95) > 40, 'second ring is loud');
  assert.ok(loud(1.1, RING.loopSeconds) < 2, 'long pause is quiet');
});
