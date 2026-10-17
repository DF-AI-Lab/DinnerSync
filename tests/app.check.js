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
  await page.click('#add-stage');
  const row2 = page.locator('.stage-row').nth(1);
  assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'no keyboard after + Then');
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
  assert.match(await steps.nth(0).getAttribute('class'), /current/);
  // Current card grows: countdown + small Done next to it + badge
  const cur = page.locator('#cook-steps li.current');
  assert.equal(await cur.count(), 1);
  assert.match(await cur.locator('.card-count').textContent(), /^\d+:\d\d(:\d\d)?$/);
  assert.equal(await cur.locator('.card-done').count(), 1);
  assert.equal(await cur.locator('.step-badge').textContent(), 'NEXT'); // preheat not due yet
  assert.equal(await page.locator('#cook-steps .card-done').count(), 1, 'Done only in the current card');
  const radius = await cur.locator('.card-done').evaluate(n => getComputedStyle(n).borderTopLeftRadius);
  assert.equal(radius, '6px');
  const firstAt = await steps.nth(1).locator('time').textContent();
  // Done early: step ticked, next card says how much spare, times don't shift
  await cur.locator('.card-done').click();
  assert.match(await steps.nth(0).getAttribute('class'), /done/);
  assert.match(await steps.nth(1).getAttribute('class'), /current/);
  assert.match(await page.locator('#cook-steps li.current .card-spare').textContent(), /Done early, \d+ min spare before this/);
  assert.equal(await steps.nth(1).locator('time').textContent(), firstAt);
  // Done sits in the bottom row of the card, beside the "Done early" line, below the countdown
  const curCard = page.locator('#cook-steps li.current');
  assert.equal(await curCard.locator('.card-foot .card-done').count(), 1);
  assert.equal(await curCard.locator('.card-foot .card-spare').count(), 1);
  const doneBox = await curCard.locator('.card-done').boundingBox();
  const countBox = await curCard.locator('.card-count').boundingBox();
  assert.ok(doneBox.y > countBox.y + countBox.height - 1, 'Done is below the countdown');
  // Done sits at the very bottom, level with the "Done early" line
  const spareBox = await curCard.locator('.card-spare').boundingBox();
  assert.ok(Math.abs((doneBox.y + doneBox.height) - (spareBox.y + spareBox.height)) <= 6, 'Done bottom lines up with the spare line');
  // Tap a ticked circle to undo that step: it becomes current again
  await steps.nth(0).locator('.dot').click();
  assert.match(await steps.nth(0).getAttribute('class'), /current/);
  assert.doesNotMatch(await steps.nth(1).getAttribute('class'), /done|current/);
  await page.locator('#cook-steps li.current .card-done').click();
  assert.match(await steps.nth(0).getAttribute('class'), /done/);
  // Phone back button: leave the cooking screen but keep cooking in the background
  await page.goBack();
  await page.waitForSelector('#plan-screen:not([hidden])');
  assert.equal(await page.locator('#cook-screen').isVisible(), false);
  assert.equal(await page.locator('#back-to-cook').isVisible(), true);
  assert.match(await page.textContent('#back-to-cook'), /Cooking/);
  assert.match(await page.textContent('#back-to-cook'), /\d+:\d\d/);
  // Tap the bar to go back: same steps, still ticked
  await page.click('#back-to-cook');
  await page.waitForSelector('#cook-screen:not([hidden])');
  assert.match(await steps.nth(0).getAttribute('class'), /done/);
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
  assert.deepEqual(errors, []);
  console.log('app.check: OK');
} finally {
  await browser.close();
  server.kill();
}
