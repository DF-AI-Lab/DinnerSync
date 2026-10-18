// Browser smoke test: loads the app in Chromium at phone width, builds a meal, shows the timer
// sequence, starts cooking and rings the alarms. Run with: npm run check
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const server = spawn('python3', ['-m', 'http.server', '8099'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const URL = 'http://localhost:8099/index.html';
const errors = [];

const newPage = async (viewport = { width: 400, height: 860 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  return page;
};
const pick = (page, select, name) => page.selectOption(select, name);
const item = (page, name) => page.locator('.b-item', { has: page.locator('.b-item-name', { hasText: new RegExp(`^${name}$`) }) });
const lib = (page, key) => page.evaluate(k => JSON.parse(localStorage.getItem(`dinnersync.lib.${k}`) || 'null'), key);

try {
  const page = await newPage();
  await page.goto(URL);

  // ---- header (unchanged): Reset small and clear of the title, logo home button, version, clock ----
  const rb = await page.locator('#cook-reset').boundingBox();
  const bb = await page.locator('.brand').boundingBox();
  assert.ok(rb.height <= 36, 'reset is small');
  assert.equal(rb.x < bb.x + bb.width && bb.x < rb.x + rb.width && rb.y < bb.y + bb.height && bb.y < rb.y + rb.height, false, 'reset does not touch the title');
  const logo = await page.locator('#home img').boundingBox();
  const titleBlock = await page.locator('.brand-text').boundingBox();
  assert.ok(Math.abs(logo.height - titleBlock.height) <= 4, 'logo is as tall as title + tagline');
  assert.ok(logo.x + logo.width <= bb.x, 'logo is left of the title');
  const ver = (await page.textContent('#app-version')).trim();
  assert.match(ver, /^v\d+(\.\d+)*$/);
  assert.match(readFileSync('sw.js', 'utf8'), new RegExp(`const CACHE = 'dinnersync-${ver.replace(/\./g, '\\.')}'`), 'sw cache matches version');
  assert.match(await page.textContent('#now-clock'), /^\d{1,2}:\d\d(am|pm)$/);
  const resetBox = await page.locator('#cook-reset').boundingBox();
  const nowBox = await page.locator('#now-clock').boundingBox();
  assert.ok(nowBox.y >= resetBox.y + resetBox.height - 1, 'clock is under Reset');

  // ---- 1. Simple timer and When's dinner are hidden; the app opens on "What are you cooking?" ----
  assert.equal(await page.locator('#tile-dinner').isVisible(), false);
  assert.equal(await page.locator('#tile-timer').isVisible(), false);
  assert.match(await page.textContent('#setup'), /What are you cooking\?/);
  assert.equal(await page.locator('#setup .b-card').first().isVisible(), true);

  // ---- 2. Meal card: name box, "Saved meals" picker, the switch ----
  assert.equal(await page.locator('#meal-name').isVisible(), true);
  assert.equal(await page.locator('#meal-pick').isVisible(), true);
  const nameBox = await page.locator('#meal-name').boundingBox();
  const pickBox = await page.locator('#meal-pick').boundingBox();
  assert.ok(pickBox.x > nameBox.x + nameBox.width - 1, 'saved meals is to the right of the name');
  assert.ok(pickBox.width < 400 / 2.5, 'saved meals is about a third wide');
  assert.match(await page.textContent('#setup'), /Cook some together first/);
  assert.equal(await page.locator('.b-group').count(), 0, 'switch off: no built dish card');
  assert.match(await page.locator('.b-card').nth(1).textContent(), /Items/);

  // ---- 3 + 4. Saved meal with a built dish ----
  await pick(page, '#meal-pick', "Shepherd's pie & roasties");
  assert.equal(await page.locator('#together').isChecked(), true);
  assert.equal(await page.inputValue('#meal-name'), "Shepherd's pie & roasties");
  assert.equal(await page.locator('.b-group').count(), 1);
  assert.equal(await page.inputValue('.b-group-name'), "Shepherd's pie");
  const group = page.locator('.b-group');
  assert.match(await group.textContent(), /1 · Cook these first/);
  assert.match(await group.textContent(), /when they're all done/);
  assert.match(await group.textContent(), /2 · Then finish/);
  assert.equal(await group.locator('.b-item').count(), 2);
  assert.equal(await group.locator('.b-st-name').count(), 2, 'finish steps: Build pie, Bake');
  const rest = page.locator('.b-card', { hasText: 'Everything else' });
  assert.equal(await rest.locator('.b-item').count(), 2);
  assert.match(await rest.textContent(), /Roast potatoes/);

  // ---- 5. An item is named steps: a total time, a coloured bar, tap to open ----
  const roast = item(page, 'Roast potatoes');
  assert.match(await roast.locator('.b-item-time').textContent(), /2h 5m/);
  assert.equal(await roast.locator('.b-strip i').count(), 4);
  assert.equal(await roast.locator('.b-st-name').count(), 0, 'closed until tapped');
  await roast.locator('.b-item-head').click();
  assert.equal(await roast.locator('.b-st-name').count(), 4);
  assert.deepEqual(await roast.locator('.b-st-name').evaluateAll(n => n.map(x => x.value)), ['Peel potatoes', 'Boil', 'Rest / steam dry', 'Roast']);
  assert.equal(await roast.locator('.b-check-text').inputValue(), 'Turn potatoes');
  assert.match(await roast.textContent(), /after 30 min/);
  assert.match(await roast.textContent(), /200°/);

  // ---- 6. Auto-save: change a step and Saved items has it straight away ----
  await roast.locator('[data-act="min"][data-i="1"][data-d="5"]').click();
  assert.match(await item(page, 'Roast potatoes').locator('.b-item-time').textContent(), /2h 10m/);
  assert.equal((await lib(page, 'items'))['Roast potatoes'][1].min, 30);
  await item(page, 'Roast potatoes').locator('[data-act="temp"][data-i="3"][data-d="-10"]').click();
  assert.equal((await lib(page, 'items'))['Roast potatoes'][3].temp, 190);
  await item(page, 'Roast potatoes').locator('[data-act="temp"][data-i="3"][data-d="10"]').click();
  // typing a step name saves too, and "+ Hob" puts the cursor in the new step's name
  await item(page, 'Roast potatoes').locator('[data-act="addst"][data-k="hob"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.className), 'b-st-name');
  await page.keyboard.type('Make onion gravy');
  assert.equal((await lib(page, 'items'))['Roast potatoes'].at(-1).text, 'Make onion gravy');
  assert.equal((await lib(page, 'items'))['Roast potatoes'].at(-1).kind, 'hob');
  await item(page, 'Roast potatoes').locator('[data-act="rmst"]').last().click();
  assert.equal((await lib(page, 'items'))['Roast potatoes'].length, 4);
  // a step can carry its own reminder
  await item(page, 'Roast potatoes').locator('[data-act="addchk"]').first().click();
  assert.equal((await lib(page, 'items'))['Roast potatoes'][0].check.text, 'Check');
  await item(page, 'Roast potatoes').locator('[data-act="rmchk"]').first().click();
  assert.equal((await lib(page, 'items'))['Roast potatoes'][0].check, undefined);
  await item(page, 'Roast potatoes').locator('[data-act="min"][data-i="1"][data-d="-5"]').click(); // back to 25
  await item(page, 'Roast potatoes').locator('.b-item-head').click();

  // ---- 4. Type an item + Enter, or pick one from Saved items ----
  await page.fill('.b-item-add[data-list="main"]', 'carrots');
  await page.keyboard.press('Enter');
  assert.equal(await rest.locator('.b-item').count(), 3);
  assert.match(await item(page, 'Carrots').locator('.b-item-time').textContent(), /25 min/);
  await pick(page, '.b-item-pick[data-list="main"]', 'Gravy');
  assert.equal(await rest.locator('.b-item').count(), 4);
  // a brand-new item opens so its steps can be added
  await page.fill('.b-item-add[data-list="main"]', 'Leeks');
  await page.keyboard.press('Enter');
  assert.equal(await item(page, 'Leeks').locator('.b-item-time').textContent(), 'add steps');
  await item(page, 'Leeks').locator('[data-act="addst"][data-k="hob"]').click();
  await page.keyboard.type('Steam');
  assert.deepEqual((await lib(page, 'items'))['Leeks'].map(s => [s.kind, s.text]), [['hob', 'Steam']]);
  await item(page, 'Leeks').locator('[data-act="rm"]').click();
  assert.equal(await item(page, 'Leeks').count(), 0);
  for (const n of ['Carrots', 'Gravy']) await item(page, n).locator('.b-item-head').click().then(() => item(page, n).locator('[data-act="rm"]').click());

  // ---- 9. When's it ready card at the bottom ----
  const when = page.locator('.b-card', { hasText: "When's it ready?" });
  assert.match(await when.textContent(), /takes/);
  assert.match(await when.textContent(), /Start now → ready at \d{1,2}:\d\d(am|pm)/);
  await when.locator('[data-act="mode"][data-m="later"]').click();
  const later1 = await when.locator('.b-val').first().textContent();
  await when.locator('[data-act="later"][data-d="15"]').click();
  assert.notEqual(await when.locator('.b-val').first().textContent(), later1);
  assert.match(await when.textContent(), /First alarm at/);
  await when.locator('[data-act="mode"][data-m="now"]').click();
  assert.equal(await page.locator('.b-go').textContent(), 'Start timers');

  // ---- 6. Save as a meal ----
  await page.fill('#meal-name', '');
  await page.click('[data-act="savemeal"]');
  assert.match(await page.textContent('.b-toast'), /name/i);
  await page.fill('#meal-name', 'Test dinner');
  await page.click('[data-act="savemeal"]');
  assert.match(await page.textContent('.b-toast'), /Saved "Test dinner"/);
  assert.ok((await lib(page, 'meals'))['Test dinner']);
  assert.deepEqual((await lib(page, 'meals'))['Test dinner'].groups[0].items, ['Mince', 'Mash']);
  assert.ok((await page.locator('#meal-pick option').allTextContents()).includes('Test dinner'));

  // ---- the meal being set up is remembered across a reload ----
  await page.reload();
  assert.equal(await page.inputValue('#meal-name'), 'Test dinner');
  assert.equal(await page.locator('.b-group').count(), 1);

  // ---- phone width: nothing scrolls sideways ----
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 400px');
  await page.setViewportSize({ width: 320, height: 700 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll at 320px');
  await page.setViewportSize({ width: 400, height: 860 });

  // ---- 7 + 8. Timer sequence: one shared peel, prep block, prep-first switch ----
  await page.click('.b-go');
  assert.equal(await page.locator('#timeline-screen').isVisible(), true);
  assert.match(await page.textContent('#timeline-screen'), /Your timer sequence/);
  assert.equal(await page.locator('#prep-first-box').isChecked(), true, 'prep first is on by default');
  assert.match(await page.textContent('#prep-first-hint'), /Adds \d+ min overall|Same total time/);
  const stepsText = () => page.textContent('#plan-steps');
  assert.match(await stepsText(), /Prep block/);
  assert.match(await stepsText(), /Now cook/);
  const peelRows = page.locator('#plan-steps li', { hasText: 'Peel potatoes' });
  assert.equal(await peelRows.count(), 1, 'one shared peel');
  assert.match(await peelRows.first().textContent(), /all of it, keep in cold water/);
  assert.match(await peelRows.first().textContent(), /Mash \+ Roast potatoes/);
  assert.match(await peelRows.first().textContent(), /25 min|Prep/);
  assert.equal(await page.locator('#plan-steps li', { hasText: 'Boil' }).count(), 3, 'the boils stay separate: roasties, mash, peas');
  assert.match(await stepsText(), /Preheat oven to 200°C/);
  assert.match(await stepsText(), /Turn potatoes/);
  assert.match(await page.textContent('#timeline-ready'), /Dinner at/);
  await page.locator('#prep-first').click();
  assert.equal(await page.locator('#prep-first-box').isChecked(), false);
  assert.doesNotMatch(await stepsText(), /Prep block/);
  assert.equal(await page.locator('#plan-steps li', { hasText: 'Peel potatoes' }).count(), 1);
  await page.locator('#prep-first').click();
  assert.match(await stepsText(), /Prep block/);

  // ---- 10. Oven clash warning ----
  await page.click('#back-plan');
  await page.click('#cook-reset');
  await page.click('#reset-yes');
  assert.equal(await page.inputValue('#meal-name'), '');
  assert.equal(await page.locator('.b-group').count(), 0);
  assert.equal(await page.locator('.b-card', { hasText: 'Items' }).locator('.b-item').count(), 0);
  await pick(page, '#meal-pick', 'Chicken dinner');
  await page.click('.b-go');
  assert.equal(await page.locator('#oven-clash').isVisible(), true);
  assert.match(await page.textContent('#oven-clash'), /190°C/);
  assert.match(await page.textContent('#oven-clash'), /200°C/);
  await page.click('#back-plan');
  await page.click('#cook-reset');
  await page.click('#reset-yes');
  await pick(page, '#meal-pick', "Shepherd's pie");
  await page.click('.b-go');
  assert.equal(await page.locator('#oven-clash').isVisible(), false);

  // ---- cooking carries on across a reload ----
  await page.click('#start-cooking');
  assert.equal(await page.locator('#cook-screen').isVisible(), true);
  assert.match(await page.textContent('#dinner-in'), /\d:\d\d/);
  await page.reload();
  await page.waitForSelector('#cook-screen:not([hidden])');
  assert.match(await page.textContent('#dinner-in'), /\d:\d\d/, 'cooking resumes after a reload');
  await page.close();

  // ---- cooking with a fake clock: step alarms, end alarms, and a reminder alarm ----
  const mp = await newPage();
  await mp.clock.install({ time: new Date(2026, 9, 18, 16, 49) });
  await mp.clock.pauseAt(new Date(2026, 9, 18, 16, 50));
  await mp.goto(URL);
  await mp.fill('.b-item-add[data-list="main"]', 'Roast potatoes');
  await mp.keyboard.press('Enter');
  await mp.click('.b-go');
  await mp.click('#start-cooking');
  const jobs = mp.locator('#jobs .job-timer');
  assert.equal(await jobs.count(), 1);
  assert.match(await jobs.first().locator('.job-text').textContent(), /Peel potatoes/);
  assert.equal(await jobs.first().locator('.job-dish').textContent(), 'Roast potatoes');
  assert.equal(await jobs.first().locator('.job-count').textContent(), '15:00');
  // peel ends: its own alarm names the item; Done ticks it
  await mp.clock.runFor(15 * 60_000 + 1_000);
  await mp.waitForSelector('#alarm-banner:not([hidden])');
  assert.match(await mp.textContent('#alarm-text'), /Roast potatoes: Peel potatoes — time's up/);
  await mp.click('#alarm-done');
  await mp.waitForSelector('#alarm-banner', { state: 'hidden' });
  // jump to the reminder: dinner is 6:55pm, the roast starts 6:00pm and the turn alarm is 30 min in
  await mp.clock.fastForward(86 * 60_000); // 5:05pm -> 6:31pm; the turn alarm was 6:30pm
  await mp.waitForSelector('#alarm-banner:not([hidden])');
  assert.match(await mp.textContent('#alarm-text'), /Turn potatoes/);
  await mp.click('#alarm-done');
  assert.ok(await mp.locator('#cook-steps li.done', { hasText: 'Turn potatoes' }).count() >= 1, 'the reminder is ticked off by Done');
  await mp.close();

  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  console.log('browser check passed');
} finally {
  await browser.close();
  server.kill();
}
