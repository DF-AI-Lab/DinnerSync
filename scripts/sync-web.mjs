// Builds the web part of the Android app: a copy of live/ plus the alarm bridge.
// live/ is never changed. The copy is patched in two places; if live/js/app.js changes so that
// a patch no longer fits, this fails loudly (and the tests fail) instead of shipping a silent bug.
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(root, 'live');
const SRC = join(root, 'android-src');

export function webVersion() {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  const m = html.match(/id="app-version"[^>]*>v(\d+\.\d+\.\d+)</);
  if (!m) throw new Error('Could not find the version in live/index.html');
  return m[1];
}

function patch(text, from, to) {
  if (!text.includes(from)) throw new Error(`live/js/app.js changed: could not find ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

export function buildWww(out = join(root, 'www')) {
  rmSync(out, { recursive: true, force: true });
  cpSync(WEB, out, { recursive: true });
  rmSync(join(out, 'sw.js')); // the app is its own cache
  cpSync(join(SRC, 'alarmlist.js'), join(out, 'js/alarmlist.js'));

  const file = join(out, 'js/app.js');
  let app = readFileSync(file, 'utf8');
  // The page keeps its banner, but the phone's own alarm does the ringing.
  app = patch(app, "setSound('alarm');", "setSound(window.DinnerAlarms ? 'silent' : 'alarm');");
  app = `import { buildAlarmList, diffSchedule } from './alarmlist.js';\n${app}\n${readFileSync(join(SRC, 'bridge.fragment.js'), 'utf8')}`;
  writeFileSync(file, app);
  return out;
}

export function writeVersion(path = join(root, 'android-version.properties')) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `versionName=${webVersion()}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildWww();
  writeVersion();
  console.log(`Android web copy built (v${webVersion()}) in www/`);
}
