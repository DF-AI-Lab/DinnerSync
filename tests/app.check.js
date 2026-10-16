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
  // Reset is at the top of every screen
  assert.equal(await page.locator('#cook-reset').isVisible(), true);
  await page.fill('#item-name', 'Chicken');
  await page.fill('#item-hours', '1');
  await page.fill('#item-minutes', '30');
  await page.fill('#item-temp', '180');
  await page.click('#add-item');
  await page.fill('#item-name', 'Potatoes');
  await page.fill('#item-hours', '');
  await page.fill('#item-minutes', '10');
  await page.locator('.stage-row').first().getByRole('button', { name: /Hob/ }).click();
  await page.locator('.stage-row').first().locator('.stage-label').fill('Boil potatoes');
  await page.click('#add-stage');
  const row2 = page.locator('.stage-row').nth(1);
  await row2.locator('.stage-label').fill('Roast potatoes');
  await row2.locator('.stage-minutes').fill('45');
  await row2.locator('.stage-temp').fill('220');
  // stage rows live inside the add-item card
  assert.equal(await page.locator('#add-card .stage-row').count(), 2);
  await page.click('#add-item');
  assert.equal(await page.locator('#items li').count(), 2);
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
  assert.match(await page.textContent('#cook-screen'), /Dinner/i);
  // Steps list on the cooking screen: Done ticks the current step, highlights the next
  const steps = page.locator('#cook-steps li');
  assert.ok(await steps.count() >= 4);
  assert.match(await steps.nth(0).getAttribute('class'), /current/);
  await page.click('#cook-done');
  assert.match(await steps.nth(0).getAttribute('class'), /done/);
  assert.match(await steps.nth(1).getAttribute('class'), /current/);
  // Done and Reset at the top of the cooking screen
  await page.waitForSelector('#cook-done');
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
  // reset clears tonight's items but keeps saved items
  assert.equal(await page.locator('#items li').count(), 0);
  // saved items survive reload
  await page.reload();
  // Saved items live in a dropdown inside the add-item card
  assert.equal(await page.locator('#add-card #saved-toggle').count(), 1);
  assert.equal(await page.locator('#saved-items').count(), 0);
  await pickSaved('Chicken');
  assert.equal(await page.inputValue('#item-name'), 'Chicken');
  assert.equal(await page.inputValue('#item-hours'), '1');
  assert.equal(await page.inputValue('#item-minutes'), '30');
  assert.equal(await page.inputValue('#item-temp'), '180');
  // multi-stage saved item fills every stage, and can be edited before adding
  await pickSaved('Potatoes');
  assert.equal(await page.locator('.stage-row').count(), 2);
  assert.equal(await page.locator('.stage-row').nth(1).locator('.stage-temp').inputValue(), '220');
  await page.locator('.stage-row').nth(1).locator('.stage-temp').fill('200');
  await page.click('#add-item');
  await page.reload();
  await pickSaved('Potatoes');
  assert.equal(await page.locator('.stage-row').nth(1).locator('.stage-temp').inputValue(), '200');
  // saved items can be deleted
  await page.click('#saved-toggle');
  await page.locator('#saved-list li', { hasText: 'Chicken' }).locator('.saved-del').click();
  assert.equal(await page.locator('#saved-list li', { hasText: 'Chicken' }).count(), 0);
  await page.reload();
  await page.click('#saved-toggle');
  assert.equal(await page.locator('#saved-list li', { hasText: 'Chicken' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('app.check: OK');
} finally {
  await browser.close();
  server.kill();
}
