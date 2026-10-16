// Browser smoke test: loads the app in Chromium, builds a dinner, starts cooking.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3', ['-m', 'http.server', '8099'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:8099/index.html');
  await page.fill('#item-name', 'Chicken');
  await page.fill('#item-minutes', '90');
  await page.fill('#item-temp', '180');
  await page.click('#add-item');
  await page.fill('#item-name', 'Potatoes');
  await page.fill('#item-minutes', '45');
  await page.fill('#item-temp', '220');
  await page.click('#add-item');
  assert.equal(await page.locator('#items li').count(), 2);
  await page.fill('#ready-in', '180');
  await page.click('#show-plan');
  await page.waitForSelector('#plan-steps li');
  const txt = await page.textContent('#plan-steps');
  assert.match(txt, /Preheat/i);
  assert.match(txt, /Potatoes/);
  await page.click('#start-cooking');
  await page.waitForSelector('#cook-screen:not([hidden])');
  assert.match(await page.textContent('#cook-screen'), /Dinner/i);
  // saved items survive reload
  await page.reload();
  assert.match(await page.textContent('body'), /Chicken/);
  assert.deepEqual(errors, []);
  console.log('app.check: OK');
} finally {
  await browser.close();
  server.kill();
}
