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

// ---------- alarm: the app's own beep-beep-beep, looped through the same element until Done ----------
import { alarmWav, ALARM } from '../js/ring.js';

const ab = alarmWav(rate);
const av = new DataView(ab.buffer);
const an = (ab.length - 44) / 2;
const loudAt = (from, to) => {
  let peak = 0;
  for (let i = Math.round(from * rate); i < Math.round(to * rate); i++) peak = Math.max(peak, Math.abs(av.getInt16(44 + i * 2, true)));
  return peak / 32768;
};

test('alarm is a valid 16-bit mono WAV, one loop long', () => {
  assert.equal(String.fromCharCode(...ab.slice(0, 4)), 'RIFF');
  assert.equal(av.getUint16(34, true), 16);
  assert.equal(av.getUint32(40, true), an * 2);
  assert.equal(an, Math.round(ALARM.loopSeconds * rate));
});

test('alarm beeps loudly with gaps between (alarm clock, not a phone ring)', () => {
  assert.ok(ALARM.beeps.length >= 3, 'beep-beep-beep');
  for (const [from, to] of ALARM.beeps) {
    assert.ok(loudAt(from + 0.02, to - 0.02) > 0.5, `beep ${from}s is loud`);
  }
  for (let i = 1; i < ALARM.beeps.length; i++) {
    const gapFrom = ALARM.beeps[i - 1][1], gapTo = ALARM.beeps[i][0];
    assert.ok(loudAt(gapFrom + 0.01, gapTo - 0.01) < 0.01, 'silent gap between beeps');
  }
});
