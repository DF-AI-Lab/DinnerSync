// Browser smoke test for the simple timer in /demo: add dishes, start cooking, fast-forward and check the alarms.
// Run with: npm run check:demo
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3', ['-m', 'http.server', '8098'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date(2026, 9, 22, 18, 0, 0) });
  await page.goto('http://localhost:8098/demo/index.html');

  const add = async (name, mins, earlyTaps = 0) => {
    await page.fill('#add-name', name);
    await page.press('#add-name', 'Enter');
    const row = page.locator('.dish').last();
    for (let t = 20; t !== mins;) {
      const dir = mins > t ? 'More time' : 'Less time';
      await row.getByRole('button', { name: dir }).click();
      t = Number((await row.locator('.mins').textContent()).match(/\d+/)[0]);
    }
    for (let i = 0; i < earlyTaps; i++) await row.locator('.early').click();
  };
  await add('Mash', 35);
  await add('Chicken', 30, 1);
  await add('Peas', 5);

  assert.equal(await page.textContent('#dinner-at'), '6:35pm');
  assert.match(await page.locator('.dish').nth(2).textContent(), /Goes on at 6:30pm \(30 min in\)/);
  assert.match(await page.locator('.dish').nth(1).textContent(), /off at 6:30pm/);

  // Ready at: 15 min a tap, never earlier than possible
  await page.click('#mode-at');
  assert.equal(await page.textContent('#dinner-at'), '6:45pm');
  await page.click('#later-plus');
  assert.equal(await page.textContent('#dinner-at'), '7:00pm');
  await page.click('#mode-now');

  // Saved on the phone
  await page.reload();
  assert.equal(await page.locator('.dish').count(), 3);

  await page.click('#start');
  assert.equal(await page.isVisible('#cook'), true);
  assert.equal(await page.textContent('#ring-time'), '35:00');
  assert.equal(await page.textContent('#next-text'), 'Take Chicken off · Put Peas on');
  assert.equal(await page.isVisible('#done'), false);

  // 30 min in: rings until Done
  await page.clock.runFor(30 * 60 * 1000 + 1000);
  assert.equal(await page.textContent('#next-badge'), 'NOW');
  assert.equal(await page.locator('#keep-alive').getAttribute('data-sound'), 'alarm');
  await page.click('#done');
  assert.equal(await page.locator('#keep-alive').getAttribute('data-sound'), 'silent');
  assert.equal(await page.textContent('#next-text'), "Dinner's ready!");

  // Survives a reload mid-cook
  await page.reload();
  assert.equal(await page.isVisible('#cook'), true);
  assert.equal(await page.textContent('#next-text'), "Dinner's ready!");

  await page.clock.runFor(5 * 60 * 1000);
  assert.equal(await page.textContent('#next-badge'), 'NOW');
  await page.click('#done');
  assert.equal(await page.textContent('#next-text'), 'Enjoy your dinner!');
  await page.click('#done');
  assert.equal(await page.isVisible('#plan'), true);

  // Fits a phone: no sideways scroll
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });

  assert.deepEqual(errors, []);
  console.log('demo check passed');
} finally {
  await browser.close();
  server.kill();
}
