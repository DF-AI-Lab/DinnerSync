import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildWww, webVersion } from '../scripts/sync-web.mjs';

test('the web version is read from live/index.html', () => {
  assert.match(webVersion(), /^\d+\.\d+\.\d+$/);
});

test('the Android web copy is live/ plus the alarm bridge', () => {
  const out = mkdtempSync(join(tmpdir(), 'ds-www-'));
  buildWww(out);
  assert.ok(existsSync(join(out, 'index.html')));
  assert.ok(existsSync(join(out, 'js/alarmlist.js')));
  const app = readFileSync(join(out, 'js/app.js'), 'utf8');
  assert.match(app, /from '\.\/alarmlist\.js'/);
  assert.match(app, /DinnerAlarms/);
});

test('the copy is silent in the page when the plugin is there (native rings instead)', () => {
  const out = mkdtempSync(join(tmpdir(), 'ds-www-'));
  buildWww(out);
  const app = readFileSync(join(out, 'js/app.js'), 'utf8');
  assert.match(app, /setSound\(window\.DinnerAlarms \? 'silent' : 'alarm'\)/);
});

test('the service worker is not shipped in the app', () => {
  const out = mkdtempSync(join(tmpdir(), 'ds-www-'));
  buildWww(out);
  assert.ok(!existsSync(join(out, 'sw.js')));
});

test('live/ itself is untouched', () => {
  assert.ok(!readFileSync(new URL('../live/js/app.js', import.meta.url), 'utf8').includes('DinnerAlarms'));
});
