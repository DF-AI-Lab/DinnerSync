import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepAliveWav, KEEP_ALIVE } from '../js/ring.js';

const rate = 8000;
const bytes = keepAliveWav(rate);
const view = new DataView(bytes.buffer);
const text = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
const n = (bytes.length - 44) / 2;
const sample = i => view.getInt16(44 + i * 2, true);
const peakDbfs = () => {
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(sample(i)));
  return 20 * Math.log10(peak / 32768);
};

test('keep-alive is a valid 16-bit mono WAV', () => {
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(36, 4), 'data');
  assert.equal(view.getUint16(22, true), 1);   // mono
  assert.equal(view.getUint32(24, true), rate);
  assert.equal(view.getUint16(34, true), 16);  // 16-bit
  assert.equal(view.getUint32(40, true), n * 2);
  assert.equal(n, Math.round(KEEP_ALIVE.seconds * rate));
});

// Chrome treats sound below about -72 dBFS as silence and may pause the page; keep above that, but far too quiet to notice
test('keep-alive is loud enough for Chrome to count it as playing, but still very quiet', () => {
  const db = peakDbfs();
  assert.ok(db > -66, `peak ${db.toFixed(1)} dBFS should be above -66`);
  assert.ok(db < -50, `peak ${db.toFixed(1)} dBFS should be below -50`);
});

test('keep-alive is a low hum that loops without a click', () => {
  assert.ok(KEEP_ALIVE.hz <= 40, 'low enough that phone speakers barely play it');
  // whole cycles in one loop: last sample leads smoothly into the first
  assert.ok(Math.abs(sample(0)) <= 1);
  assert.ok(Math.abs(sample(n - 1) - sample(0)) <= Math.abs(sample(1) - sample(0)) + 1);
});
