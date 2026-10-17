// Browser smoke test: loads the app in Chromium, builds a dinner, starts cooking.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3', ['-m', 'http.server', '8099'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const pickSaved = async name => {
    await page.click('#saved-toggle');
    await page.locator('#saved-list li', { hasText: name }).locator('.saved-pick').click();
  };
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8099/index.html');
  // Reset is at the top of every screen, small, not touching the title
  assert.equal(await page.locator('#cook-reset').isVisible(), true);
  const rb = await page.locator('#cook-reset').boundingBox();
  const bb = await page.locator('.brand').boundingBox();
  assert.ok(rb.height <= 36, 'reset is small');
  const overlap = rb.x < bb.x + bb.width && bb.x < rb.x + rb.width && rb.y < bb.y + bb.height && bb.y < rb.y + rb.height;
  assert.equal(overlap, false, 'reset does not touch the title');
  // Logo on the left of the title, same height as title + tagline; it's a home button
  const logo = await page.locator('#home img').boundingBox();
  const titleBlock = await page.locator('.brand-text').boundingBox();
  assert.ok(Math.abs(logo.height - titleBlock.height) <= 4, 'logo is as tall as title + tagline');
  assert.ok(logo.x + logo.width <= bb.x, 'logo is left of the title');
  // Version to the right of the title, same as the offline cache version
  const ver = (await page.textContent('#app-version')).trim();
  assert.match(ver, /^v\d+(\.\d+)*$/);
  const vb = await page.locator('#app-version').boundingBox();
  assert.ok(vb.x >= bb.x + bb.width, 'version is right of the title');
  const sw = (await import('node:fs')).readFileSync('sw.js', 'utf8');
  assert.match(sw, new RegExp(`const CACHE = 'dinnersync-${ver.replace(/\./g, '\\.')}'`), 'sw cache matches version');
  // Current time in the header, under Reset, on every screen
  assert.match(await page.textContent('#now-clock'), /^\d{1,2}:\d\d(am|pm)$/);
  const resetBox = await page.locator('#cook-reset').boundingBox(), nowBox = await page.locator('#now-clock').boundingBox();
  assert.ok(nowBox.y >= resetBox.y + resetBox.height - 1, 'clock is under Reset');
  // Two tiles at the top: When's dinner + Timer. Tap opens a panel, one at a time, tap again closes.
  const isOpen = async id => /\bopen\b/.test(await page.getAttribute(id, 'class'));
  assert.match(await page.textContent('#tile-dinner'), /When's dinner/);
  assert.match(await page.textContent('#tile-dinner'), /\d{1,2}:\d\d(am|pm)/);
  assert.match(await page.textContent('#tile-timer'), /Timer/);
  assert.match(await page.textContent('#tile-timer'), /0:00/);
  await page.click('#tile-dinner');
  assert.equal(await isOpen('#panel-dinner'), true);
  assert.match(await page.textContent('#panel-dinner'), /Ready in/);
  assert.match(await page.textContent('#panel-dinner'), /or at/);
  assert.match(await page.textContent('#panel-dinner'), /Dinner at \d{1,2}:\d\d(am|pm)/);
  await page.click('#tile-timer');
  assert.equal(await isOpen('#panel-dinner'), false);
  assert.equal(await isOpen('#panel-timer'), true);
  // Timer open hides the add-item card and the rest of the plan
  assert.equal(await page.locator('#add-card').isVisible(), false);
  assert.equal(await page.locator('#show-plan').isVisible(), false);
  // Countdown only: +1/+5/+10, Start/Pause, Reset to 0:00
  assert.match(await page.textContent('#panel-timer'), /Remaining/);
  assert.equal(await page.textContent('#timer-display'), '0:00');
  await page.click('#panel-timer [data-add="60"]');
  await page.click('#panel-timer [data-add="300"]');
  assert.equal(await page.textContent('#timer-display'), '6:00');
  await page.click('#panel-timer [data-add="600"]');
  assert.equal(await page.textContent('#timer-display'), '16:00');
  await page.click('#timer-start');
  assert.equal(await page.textContent('#timer-start'), 'Pause');
  await page.waitForFunction(() => document.getElementById('timer-display').textContent !== '16:00');
  assert.match(await page.textContent('#tile-timer'), /15:5\d/);
  await page.click('#timer-start');
  assert.equal(await page.textContent('#timer-start'), 'Start');
  await page.click('#timer-reset');
  assert.equal(await page.textContent('#timer-display'), '0:00');
  await page.click('#tile-timer');
  assert.equal(await isOpen('#panel-timer'), false);
  assert.equal(await page.locator('#add-card').isVisible(), true);
  await page.click('#tile-dinner');
  // ---- Add-item card: no keyboard for numbers; keyboard only when a text box is tapped ----
  await page.waitForTimeout(500); // let the dinner drawer finish sliding open before measuring positions
  const card = page.locator('#add-card');
  assert.equal(await card.locator('input[type="number"]').count(), 0, 'no number boxes (no keyboard)');
  // Saved ▾ is small, on the "Add an item" line, on the right
  const headBox = await card.locator('h2').boundingBox(), savedBox = await page.locator('#saved-toggle').boundingBox();
  assert.ok(Math.abs((savedBox.y + savedBox.height / 2) - (headBox.y + headBox.height / 2)) < 12, 'Saved is in line with the heading');
  assert.ok(savedBox.x > headBox.x + headBox.width, 'Saved is right of the heading');
  // ✓ sits right of the name box, faded until the box is tapped; tapping it closes the keyboard
  const nameBox = await page.locator('#item-name').boundingBox(), tickBox = await page.locator('#name-done').boundingBox();
  assert.ok(tickBox.x >= nameBox.x + nameBox.width - 1 && Math.abs(tickBox.y - nameBox.y) < 12, 'tick right of the name box');
  assert.match(await page.getAttribute('#name-done', 'class'), /\boff\b/);
  await page.click('#item-name');
  assert.doesNotMatch(await page.getAttribute('#name-done', 'class'), /\boff\b/);
  await page.click('#name-done');
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'tick closes the keyboard');
  assert.match(await page.getAttribute('#name-done', 'class'), /\boff\b/);
  // Stage name boxes get a ✓ too
  assert.equal(await page.locator('.stage-row').first().locator('.stage-tick').count(), 1);
  // Time and temp: − / + buttons. Defaults 30 min and 200°C; 5 min and 10° a tap
  const first = page.locator('.stage-row').first();
  assert.equal(await first.getAttribute('data-minutes'), '30');
  assert.equal(await first.getAttribute('data-temp'), '200');
  assert.equal(await first.locator('.stage-time').textContent(), '30 min');
  assert.equal(await first.locator('.stage-temp').textContent(), '200°C');
  await first.locator('.time-up').click();
  assert.equal(await first.getAttribute('data-minutes'), '35');
  await first.locator('.time-down').click();
  await first.locator('.temp-up').click();
  assert.equal(await first.getAttribute('data-temp'), '210');
  await first.locator('.temp-down').click();
  // Slow cook: Low / High instead of a temp, 30 min a tap, starts at 4 hr
  await first.getByRole('button', { name: /Slow cook/ }).click();
  assert.equal(await first.locator('.temp-field').isVisible(), false);
  assert.equal(await first.locator('.slow-field').isVisible(), true);
  assert.equal(await first.getAttribute('data-minutes'), '240');
  assert.equal(await first.locator('.stage-time').textContent(), '4 hr');
  await first.locator('.time-up').click();
  assert.equal(await first.getAttribute('data-minutes'), '270');
  assert.equal(await first.getAttribute('data-setting'), 'low');
  await first.getByRole('button', { name: 'High' }).click();
  assert.equal(await first.getAttribute('data-setting'), 'high');
  assert.equal(await first.getByRole('button', { name: 'High' }).getAttribute('aria-pressed'), 'true');
  await page.fill('#item-name', 'Beef stew');
  await page.click('#add-item');
  assert.match(await page.textContent('#items'), /Slow cook 4 hr 30 min \(High\)/);
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'no keyboard after Add');
  // the form is back to one oven stage with the defaults
  assert.equal(await first.getAttribute('data-method'), 'oven');
  assert.equal(await first.getAttribute('data-minutes'), '30');
  await page.locator('#items li', { hasText: 'Beef stew' }).locator('button').last().click();
  assert.equal(await page.locator('#items li', { hasText: 'Beef stew' }).count(), 0);

  // Steps a stage row to a time / temp with the − / + buttons
  const setTime = async (row, mins) => {
    for (let i = 0; i < 100; i++) {
      const v = Number(await row.getAttribute('data-minutes'));
      if (v === mins) return;
      await row.locator(v < mins ? '.time-up' : '.time-down').click();
    }
    throw new Error(`could not set time ${mins}`);
  };
  const setTemp = async (row, t) => {
    for (let i = 0; i < 40; i++) {
      const v = Number(await row.getAttribute('data-temp'));
      if (v === t) return;
      await row.locator(v < t ? '.temp-up' : '.temp-down').click();
    }
    throw new Error(`could not set temp ${t}`);
  };
  await page.fill('#item-name', 'Chicken');
  await setTime(first, 90);
  await setTemp(first, 180);
  await page.click('#add-item');
  await page.fill('#item-name', 'Potatoes');
  await first.getByRole('button', { name: /Hob/ }).click();
  await setTime(first, 10);
  await first.locator('.stage-label').fill('Boil potatoes');
  // "+ then" in the cook line adds the next stage to that line
  await page.locator('.sec[data-sec="cook"] .line-then').first().click();
  const row2 = page.locator('.stage-row').nth(1);
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'no keyboard after + then');
  await row2.locator('.stage-label').fill('Roast potatoes');
  await setTime(row2, 45);
  await setTemp(row2, 220);
  // stage rows live inside the add-item card
  assert.equal(await page.locator('#add-card .stage-row').count(), 2);
  await page.click('#add-item');
  assert.equal(await page.locator('#items li').count(), 2);
  // Cook now: dinner set to the earliest it can be ready if starting right now
  if (!(await isOpen('#panel-dinner'))) await page.click('#tile-dinner');
  await page.click('#cook-now');
  assert.match(await page.textContent('#status'), /Enough time — start (preheating|cooking) at/);
  const startAt = (await page.textContent('#status')).match(/at (\d{1,2}:\d\d(am|pm))/)[1];
  // dinner time is rounded up to the whole minute, so the start is this minute or the next
  const nowAndNext = await page.evaluate(() => [0, 60_000].map(d => {
    const t = new Date(Date.now() + d), h = t.getHours();
    return `${h % 12 || 12}:${String(t.getMinutes()).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  }));
  assert.ok(nowAndNext.includes(startAt), `starts now (${startAt} vs ${nowAndNext})`);
  await page.fill('#ready-hours', '3');
  await page.fill('#ready-minutes', '0');
  await page.click('#show-plan');
  await page.waitForSelector('#plan-steps li');
  const txt = await page.textContent('#plan-steps');
  assert.match(txt, /Preheat/i);
  assert.match(txt, /Boil potatoes on the hob/);
  assert.match(txt, /Roast potatoes into the oven/);
  await page.click('#start-cooking');
  await page.waitForSelector('#cook-screen:not([hidden])');
  // Silent sound loops while cooking, so Android keeps the app (and its alarms) running when locked
  const keep = page.locator('#keep-alive');
  assert.equal(await keep.count(), 1);
  await page.waitForFunction(() => { const a = document.getElementById('keep-alive'); return a && !a.paused; });
  assert.equal(await keep.evaluate(a => a.loop), true);
  // The ring plays through the same, already-playing element (so a locked phone lets it start); silent until an alarm
  assert.equal(await keep.getAttribute('data-sound'), 'silent');
  // Only "Dinner in" at the top: no big countdown, no preheat card, no big Done
  assert.match(await page.textContent('#cook-screen'), /Dinner in/i);
  assert.equal(await page.locator('#next-time').count(), 0);
  assert.equal(await page.locator('#preheat-block').count(), 0);
  assert.equal(await page.locator('#cook-done').count(), 0);
  const steps = page.locator('#cook-steps li');
  assert.ok(await steps.count() >= 4);
  // Dinner is 3 hours away: nothing on the go yet, the next alarm is the preheat
  assert.equal(await page.locator('#jobs .job-timer').count(), 0);
  assert.equal(await page.locator('#jobs-empty').isVisible(), true);
  assert.match(await page.textContent('#next-alarm'), /Preheat/);
  assert.match(await page.textContent('#next-alarm'), /\d{1,2}:\d\d(am|pm)/);
  assert.equal(await page.locator('#cook-steps .card-done').count(), 0, 'no big current card any more');
  const stepCount = await steps.count();
  // Phone back button: leave the cooking screen but keep cooking in the background
  await page.goBack();
  await page.waitForSelector('#plan-screen:not([hidden])');
  assert.equal(await page.locator('#cook-screen').isVisible(), false);
  assert.equal(await page.locator('#back-to-cook').isVisible(), true);
  assert.match(await page.textContent('#back-to-cook'), /Cooking/);
  assert.match(await page.textContent('#back-to-cook'), /\d+:\d\d/);
  // Tap the bar to go back: same steps
  await page.click('#back-to-cook');
  await page.waitForSelector('#cook-screen:not([hidden])');
  assert.equal(await steps.count(), stepCount);
  assert.equal(await page.locator('#back-to-cook').isVisible(), false);
  // The logo is a home button: goes to the plan, cooking carries on
  await page.click('#home');
  await page.waitForSelector('#plan-screen:not([hidden])');
  assert.equal(await page.locator('#back-to-cook').isVisible(), true);
  await page.click('#back-to-cook');
  await page.waitForSelector('#cook-screen:not([hidden])');
  await page.waitForSelector('#cook-reset');
  // Reset asks first; "No" keeps cooking
  await page.click('#cook-reset');
  await page.waitForSelector('#reset-confirm:not([hidden])');
  await page.click('#reset-no');
  await page.waitForSelector('#reset-confirm', { state: 'hidden' });
  assert.equal(await page.locator('#cook-screen').isVisible(), true);
  await page.click('#cook-reset');
  await page.click('#reset-yes');
  await page.waitForSelector('#cook-screen', { state: 'hidden' });
  // Cooking stopped: the silent sound stops too
  assert.equal(await keep.evaluate(a => a.paused), true);
  // reset clears tonight's items but keeps saved items
  assert.equal(await page.locator('#items li').count(), 0);
  // saved items survive reload
  await page.reload();
  // Saved items live in a dropdown inside the add-item card
  assert.equal(await page.locator('#add-card #saved-toggle').count(), 1);
  assert.equal(await page.locator('#saved-items').count(), 0);
  await pickSaved('Chicken');
  assert.equal(await page.inputValue('#item-name'), 'Chicken');
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'no keyboard after picking a saved item');
  assert.equal(await page.locator('.stage-row').first().getAttribute('data-minutes'), '90');
  assert.equal(await page.locator('.stage-row').first().getAttribute('data-temp'), '180');
  assert.equal(await page.locator('.stage-row').first().locator('.stage-time').textContent(), '1 hr 30 min');
  // multi-stage saved item fills every stage, and can be edited before adding
  await pickSaved('Potatoes');
  assert.equal(await page.locator('.stage-row').count(), 2);
  assert.equal(await page.locator('.stage-row').nth(1).getAttribute('data-temp'), '220');
  await page.locator('.stage-row').nth(1).locator('.temp-down').click();
  await page.locator('.stage-row').nth(1).locator('.temp-down').click();
  await page.click('#add-item');
  await page.reload();
  await pickSaved('Potatoes');
  assert.equal(await page.locator('.stage-row').nth(1).getAttribute('data-temp'), '200');
  // saved items can be deleted
  await page.click('#saved-toggle');
  await page.locator('#saved-list li', { hasText: 'Chicken' }).locator('.saved-del').click();
  assert.equal(await page.locator('#saved-list li', { hasText: 'Chicken' }).count(), 0);
  await page.reload();
  await page.click('#saved-toggle');
  assert.equal(await page.locator('#saved-list li', { hasText: 'Chicken' }).count(), 0);
  // Narrow phones (Z Fold cover screen): header fits, nothing overlaps Reset, tagline on one line
  for (const width of [320, 344, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const r = await page.locator('#cook-reset').boundingBox();
    const t = await page.locator('.brand-text').boundingBox();
    const lg = await page.locator('#home img').boundingBox();
    const tag = await page.locator('.tagline').boundingBox();
    const tagLine = await page.locator('.tagline').evaluate(n => parseFloat(getComputedStyle(n).lineHeight) || parseFloat(getComputedStyle(n).fontSize) * 1.3);
    assert.ok(t.x + t.width <= r.x, `title clear of Reset at ${width}px`);
    assert.ok(tag.height <= tagLine * 1.5, `tagline on one line at ${width}px`);
    assert.ok(Math.abs(lg.height - t.height) <= 4, `logo matches text height at ${width}px`);
    assert.ok(lg.height <= 64, `logo not too big at ${width}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `no side scroll at ${width}px`);
  }
  // Kitchen timer: keeps the app awake while running, and rings like the cooking alarm when it hits 0
  const tp = await browser.newPage({ viewport: { width: 400, height: 860 } });
  tp.on('pageerror', e => errors.push(e.message));
  await tp.clock.install();
  // Count alarm notifications (stand-in for the phone's notification system)
  await tp.addInitScript(() => {
    window.__notes = [];
    const fake = function (title, opts) { window.__notes.push(opts); };
    fake.permission = 'granted';
    fake.requestPermission = async () => 'granted';
    window.Notification = fake;
    if (window.ServiceWorkerRegistration) {
      ServiceWorkerRegistration.prototype.showNotification = async function (title, opts) { window.__notes.push(opts); };
      ServiceWorkerRegistration.prototype.getNotifications = async () => [];
    }
  });
  await tp.goto('http://localhost:8099/index.html');
  await tp.click('#tile-timer');
  await tp.click('#panel-timer [data-add="60"]');
  await tp.click('#timer-start');
  await tp.waitForFunction(() => !document.getElementById('keep-alive').paused);
  assert.equal(await tp.getAttribute('#keep-alive', 'data-sound'), 'silent');
  await tp.clock.runFor(62_000);
  await tp.waitForSelector('#alarm-banner:not([hidden])');
  assert.match(await tp.textContent('#alarm-text'), /Timer/i);
  // The app plays its own alarm beep through the already-playing element (works locked); no notification at all
  assert.equal(await tp.getAttribute('#keep-alive', 'data-sound'), 'alarm');
  assert.equal(await tp.locator('#keep-alive').evaluate(a => a.paused), false);
  await tp.clock.runFor(10_000);
  assert.equal(await tp.evaluate(() => window.__notes.length), 0, 'no notifications');
  // If the phone pauses the alarm, it starts again until Done
  await tp.locator('#keep-alive').evaluate(a => a.pause());
  await tp.clock.runFor(1_000);
  await tp.waitForFunction(() => !document.getElementById('keep-alive').paused);
  assert.equal(await tp.getAttribute('#keep-alive', 'data-sound'), 'alarm');
  // Done stops the alarm; nothing else running, so the hum stops too
  await tp.click('#alarm-done');
  await tp.waitForSelector('#alarm-banner', { state: 'hidden' });
  assert.equal(await tp.getAttribute('#keep-alive', 'data-sound'), 'silent');
  assert.equal(await tp.locator('#keep-alive').evaluate(a => a.paused), true);
  assert.equal(await tp.isVisible('#cook-screen'), false);
  await tp.close();

  // ---- Mockup 5: a dish in 3 sections (mince pie), total time, Start now / Ready later, a timer per job ----
  const mp = await browser.newPage({ viewport: { width: 360, height: 900 } });
  mp.on('pageerror', e => errors.push(e.message));
  await mp.clock.install({ time: new Date(2026, 9, 17, 16, 49) });
  await mp.clock.pauseAt(new Date(2026, 9, 17, 16, 50));
  await mp.goto('http://localhost:8099/index.html');
  await mp.evaluate(() => localStorage.clear());
  await mp.reload();
  const sec = name => mp.locator(`#stage-rows .sec[data-sec="${name}"]`);
  const setT = async (row, mins) => {
    for (let i = 0; i < 100; i++) {
      const v = Number(await row.getAttribute('data-minutes'));
      if (v === mins) return;
      await row.locator(v < mins ? '.time-up' : '.time-down').click();
    }
    throw new Error(`could not set time ${mins}`);
  };
  // 3 fixed sections in order: Get ready → Cook → Finish. The old + Then / + Same time buttons are gone.
  assert.deepEqual(await mp.locator('#stage-rows .sec').evaluateAll(n => n.map(x => x.dataset.sec)), ['ready', 'cook', 'finish']);
  assert.match(await sec('ready').textContent(), /Get ready/);
  assert.match(await sec('ready').textContent(), /one after another/i);
  assert.match(await sec('cook').textContent(), /Cook/);
  assert.match(await sec('cook').textContent(), /at the same time/i);
  assert.match(await sec('finish').textContent(), /Finish/);
  assert.match(await sec('finish').textContent(), /one after another/i);
  assert.equal(await mp.locator('#add-stage').count(), 0);
  assert.equal(await mp.locator('#add-same').count(), 0);
  assert.equal(await mp.locator('.together').count(), 0);
  const secR = await sec('ready').boundingBox(), cb = await sec('cook').boundingBox(), fb = await sec('finish').boundingBox();
  assert.ok(secR.y + secR.height <= cb.y + 1 && cb.y + cb.height <= fb.y + 1, 'sections stack top to bottom');
  // a new dish: one oven stage in the first cook line, Get ready and Finish empty
  assert.equal(await sec('ready').locator('.stage-row').count(), 0);
  assert.equal(await sec('cook').locator('.line').count(), 1);
  assert.equal(await sec('cook').locator('.stage-row').count(), 1);
  assert.equal(await sec('finish').locator('.stage-row').count(), 0);
  const c0 = sec('cook').locator('.stage-row').first();
  assert.deepEqual([await c0.getAttribute('data-sec'), await c0.getAttribute('data-group'), await c0.getAttribute('data-track')], ['cook', '1', '0']);
  // ⏱ total time by the dish name: oven 30 min + 15 min preheat
  assert.equal(await mp.locator('#dish-total').isVisible(), true);
  assert.match(await mp.textContent('#dish-total'), /⏱\s*45 min/);
  // Start now is the default: ready at X if you start now
  assert.equal(await mp.getAttribute('#when-now', 'aria-pressed'), 'true');
  assert.equal(await mp.getAttribute('#when-later', 'aria-pressed'), 'false');
  assert.match(await mp.textContent('#when-text'), /Start now \(4:50pm\) → ready at 5:35pm/);

  await mp.fill('#item-name', 'Mince pie');
  // Get ready: a new step is prep, 10 min
  await sec('ready').locator('.sec-add').click();
  const r0 = sec('ready').locator('.stage-row').first();
  assert.deepEqual([await r0.getAttribute('data-method'), await r0.getAttribute('data-minutes'), await r0.getAttribute('data-group')], ['prep', '10', '0']);
  assert.notEqual(await mp.evaluate(() => document.activeElement?.tagName), 'INPUT', 'no keyboard after adding a step');
  await r0.locator('.stage-label').fill('Peel potatoes');
  // Cook line 1: fry mince
  await c0.getByRole('button', { name: /Hob/ }).click();
  await c0.locator('.stage-label').fill('Fry mince');
  await setT(c0, 25);
  // total time is live: 10 + 25, no oven so no preheat
  assert.match(await mp.textContent('#dish-total'), /⏱\s*35 min/);
  // + Add a line: a second cook line, same group, next track, under the first
  await sec('cook').locator('.sec-add').click();
  assert.equal(await sec('cook').locator('.line').count(), 2);
  const line2 = sec('cook').locator('.line').nth(1);
  const c1 = line2.locator('.stage-row').first();
  assert.deepEqual([await c1.getAttribute('data-group'), await c1.getAttribute('data-track')], ['1', '1']);
  const l1b = await sec('cook').locator('.line').first().boundingBox(), l2b = await line2.boundingBox();
  assert.ok(l2b.y >= l1b.y + l1b.height - 1, 'cook lines stack one under the other');
  await c1.getByRole('button', { name: /Hob/ }).click();
  await c1.locator('.stage-label').fill('Boil potatoes');
  await setT(c1, 15);
  // each line has its own "+ then"
  assert.equal(await sec('cook').locator('.line-then').count(), 2);
  await line2.locator('.line-then').click();
  assert.equal(await line2.locator('.stage-row').count(), 2);
  const c2 = line2.locator('.stage-row').nth(1);
  assert.equal(await c2.getAttribute('data-track'), '1');
  await c2.getByRole('button', { name: /Prep/ }).click();
  assert.equal(await c2.locator('.temp-field').isVisible(), false);
  await c2.locator('.stage-label').fill('Mash');
  await setT(c2, 5);
  // the longest line sets the cook time: still 10 + 25
  assert.match(await mp.textContent('#dish-total'), /⏱\s*35 min/);
  // Finish: build pie, then the oven
  await sec('finish').locator('.sec-add').click();
  const f0 = sec('finish').locator('.stage-row').first();
  assert.equal(await f0.getAttribute('data-group'), '2');
  await f0.getByRole('button', { name: /Prep/ }).click();
  await f0.locator('.stage-label').fill('Build pie');
  await setT(f0, 5);
  await sec('finish').locator('.sec-add').click();
  const f1 = sec('finish').locator('.stage-row').nth(1);
  assert.equal(await f1.getAttribute('data-method'), 'oven');
  await f1.locator('.stage-label').fill('Into the oven');
  await setT(f1, 30);
  // 10 + 25 + 5 + 30 = 70 (the preheat fits inside)
  assert.match(await mp.textContent('#dish-total'), /⏱\s*1 hr 10 min/);
  assert.match(await mp.textContent('#when-text'), /Start now \(4:50pm\) → ready at 6:00pm/);
  // Start now / Ready later live in the When's dinner panel
  assert.equal(await mp.locator('#panel-dinner #when-now').count(), 1);
  assert.equal(await mp.locator('#add-card .when').count(), 0);
  await mp.click('#tile-dinner');
  await mp.waitForTimeout(500);
  assert.equal(await mp.locator('#when-later').isVisible(), true);
  // Ready later: − / + dinner time, 15 min a tap, never earlier than the soonest
  await mp.click('#when-later');
  assert.equal(await mp.getAttribute('#when-later', 'aria-pressed'), 'true');
  assert.match(await mp.textContent('#later-val'), /Ready at 6:00pm/);
  await mp.click('#later-up');
  assert.match(await mp.textContent('#later-val'), /Ready at 6:15pm/);
  assert.match(await mp.textContent('#when-text'), /Start at 5:05pm/);
  assert.match(await mp.textContent('#tile-dinner-time'), /6:15pm/);
  await mp.click('#later-down');
  await mp.click('#later-down');
  assert.match(await mp.textContent('#later-val'), /Ready at 6:00pm/);
  await mp.click('#when-now');
  assert.equal(await mp.locator('#later-val').isVisible(), false);
  assert.match(await mp.textContent('#when-text'), /ready at 6:00pm/);
  await mp.click('#add-item');
  assert.match(await mp.textContent('#items'), /Mince pie/);
  assert.match(await mp.textContent('#items'), /‖/);
  assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no side scroll');
  // The plan: the dish name above each step, things in the right order
  await mp.click('#show-plan');
  await mp.waitForSelector('#plan-steps li');
  assert.equal(await mp.locator('#plan-steps .step-dish').count(), 6);
  assert.deepEqual([...new Set(await mp.locator('#plan-steps .step-dish').allTextContents())], ['Mince pie']);
  const order = await mp.locator('#plan-steps li').allTextContents();
  const idx = re => order.findIndex(t => re.test(t));
  assert.ok(idx(/Peel potatoes/) < idx(/Fry mince/));
  assert.ok(idx(/Fry mince/) < idx(/Boil potatoes/));
  assert.ok(idx(/Boil potatoes/) < idx(/Preheat/));
  assert.ok(idx(/Preheat/) < idx(/Mash/));
  assert.ok(idx(/Mash/) < idx(/Build pie/));
  assert.ok(idx(/Build pie/) < idx(/Into the oven/));
  assert.match(await mp.textContent('#timeline-ready'), /6:00pm/);
  // Cooking: one countdown per job on the go, each with Done ✓, then the next alarm below
  await mp.click('#start-cooking');
  await mp.waitForSelector('#cook-screen:not([hidden])');
  const jobs = mp.locator('#jobs .job-timer');
  assert.equal(await jobs.count(), 1);
  assert.equal(await jobs.first().locator('.job-dish').textContent(), 'Mince pie');
  assert.match(await jobs.first().locator('.job-text').textContent(), /Peel potatoes/);
  assert.equal(await jobs.first().locator('.job-count').textContent(), '10:00');
  assert.equal(await jobs.first().locator('.job-done').count(), 1);
  assert.equal(await jobs.first().locator('.job-bar').count(), 1);
  assert.equal(await mp.locator('#jobs-empty').isVisible(), false);
  assert.match(await mp.textContent('#next-alarm'), /Fry mince/);
  assert.match(await mp.textContent('#next-alarm'), /5:00pm/);
  const jb = await mp.locator('#jobs').boundingBox(), nb = await mp.locator('#next-alarm').boundingBox();
  assert.ok(nb.y >= jb.y + jb.height - 1, 'next alarm is below the timers');
  // its own alarm when its time is up; the job stays until Done
  await mp.clock.runFor(10 * 60_000 + 1_000);
  await mp.waitForSelector('#alarm-banner:not([hidden])');
  assert.match(await mp.textContent('#alarm-text'), /Peel potatoes — time's up/);
  assert.match(await mp.textContent('#alarm-text'), /Fry mince/);
  assert.equal(await jobs.count(), 2);
  assert.match(await jobs.first().getAttribute('class'), /\bover\b/);
  // alarm Done ticks the job whose time was up
  await mp.click('#alarm-done');
  await mp.waitForSelector('#alarm-banner', { state: 'hidden' });
  assert.equal(await jobs.count(), 1);
  assert.match(await jobs.first().locator('.job-text').textContent(), /Fry mince/);
  // 17:05: boil starts too; two timers side by side in time, each with its own Done
  await mp.clock.runFor(5 * 60_000 - 1_000);
  await mp.waitForSelector('#alarm-banner:not([hidden])');
  assert.match(await mp.textContent('#alarm-text'), /Boil potatoes/);
  await mp.click('#alarm-done');
  assert.equal(await jobs.count(), 2);
  assert.equal(await mp.locator('#cook-screen').isVisible(), true, 'a start alarm does not end cooking');
  const boil = jobs.filter({ hasText: 'Boil potatoes' });
  assert.match(await boil.locator('.job-then').textContent(), /then: Mash/);
  assert.match(await boil.locator('.job-count').textContent(), /^15:00$/);
  assert.match(await jobs.filter({ hasText: 'Fry mince' }).locator('.job-count').textContent(), /^20:00$/);
  assert.match(await mp.textContent('#next-alarm'), /Preheat/);
  // Done ✓ on one job: only that one goes, and it's ticked in the step list
  await boil.locator('.job-done').click();
  assert.equal(await jobs.count(), 1);
  assert.match(await jobs.first().locator('.job-text').textContent(), /Fry mince/);
  const boilLi = mp.locator('#cook-steps li', { hasText: 'Boil potatoes' });
  assert.match(await boilLi.getAttribute('class'), /\bdone\b/);
  // tap its ✓ in the list to undo: the timer comes back
  await boilLi.locator('.dot').click();
  assert.equal(await jobs.count(), 2);
  const savedJson = await mp.evaluate(() => localStorage.getItem('dinnersync.items'));
  await mp.close();

  // ---- Saved dishes come back in their sections; old saved items still load ----
  const sv = await browser.newPage({ viewport: { width: 360, height: 900 } });
  sv.on('pageerror', e => errors.push(e.message));
  await sv.goto('http://localhost:8099/index.html');
  await sv.evaluate(json => localStorage.setItem('dinnersync.items', json), savedJson);
  await sv.reload();
  const ssec = name => sv.locator(`#stage-rows .sec[data-sec="${name}"]`);
  const pick = async name => {
    await sv.click('#saved-toggle');
    await sv.locator('#saved-list li', { hasText: name }).locator('.saved-pick').click();
  };
  await pick('Mince pie');
  assert.equal(await ssec('ready').locator('.stage-row').count(), 1);
  assert.equal(await ssec('cook').locator('.line').count(), 2);
  assert.equal(await ssec('cook').locator('.line').nth(1).locator('.stage-row').count(), 2);
  assert.equal(await ssec('cook').locator('.line').nth(1).locator('.stage-row').nth(1).getAttribute('data-method'), 'prep');
  assert.equal(await ssec('finish').locator('.stage-row').count(), 2);
  assert.match(await sv.textContent('#dish-total'), /⏱\s*1 hr 10 min/);
  // removing: a cook line with no stages left goes; an empty section stays, ready for a new step
  const l2 = ssec('cook').locator('.line').nth(1);
  await l2.locator('.stage-row').nth(1).locator('.stage-remove').click();
  await l2.locator('.stage-row').first().locator('.stage-remove').click();
  assert.equal(await ssec('cook').locator('.line').count(), 1);
  await ssec('ready').locator('.stage-row').first().locator('.stage-remove').click();
  assert.equal(await ssec('ready').locator('.stage-row').count(), 0);
  assert.equal(await ssec('ready').locator('.sec-add').isVisible(), true);
  // an old v1.1.11 same-time item: before the same-time group = Get ready, the group = Cook, after = Finish
  await sv.evaluate(() => {
    const items = JSON.parse(localStorage.getItem('dinnersync.items') || '[]');
    items.push({ name: 'Old pie', stages: [
      { method: 'prep', minutes: 10, label: 'Peel', group: 0, track: 0 },
      { method: 'hob', minutes: 25, label: 'Fry', group: 1, track: 0 },
      { method: 'hob', minutes: 15, label: 'Boil', group: 1, track: 1 },
      { method: 'oven', minutes: 30, temp: 200, group: 2, track: 0 },
    ] });
    items.push({ name: 'Old chicken', minutes: 90, temp: 180 });
    localStorage.setItem('dinnersync.items', JSON.stringify(items));
  });
  await sv.reload();
  await pick('Old pie');
  assert.equal(await ssec('ready').locator('.stage-row').count(), 1);
  assert.equal(await ssec('cook').locator('.line').count(), 2);
  assert.equal(await ssec('finish').locator('.stage-row').count(), 1);
  await pick('Old chicken');
  assert.equal(await ssec('cook').locator('.stage-row').count(), 1);
  assert.equal(await ssec('cook').locator('.stage-row').first().getAttribute('data-minutes'), '90');
  assert.equal(await ssec('ready').locator('.stage-row').count() + await ssec('finish').locator('.stage-row').count(), 0);
  await sv.close();
  assert.deepEqual(errors, []);
  console.log('app.check: OK');
} finally {
  await browser.close();
  server.kill();
}
