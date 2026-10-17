import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, fromSections, jobsOnTheGo, endAlarms, endText, nextAlarm } from '../js/plan.js';

const MIN = 60_000;
const at = (h, m) => new Date(2026, 9, 16, h, m).getTime();
const pie = {
  name: 'Mince pie',
  stages: fromSections({
    ready: [{ method: 'prep', minutes: 10, label: 'Peel potatoes' }],
    cook: [
      [{ method: 'hob', minutes: 25, label: 'Fry mince' }],
      [{ method: 'hob', minutes: 15, label: 'Boil potatoes' }, { method: 'prep', minutes: 5, label: 'Mash' }],
    ],
    finish: [{ method: 'prep', minutes: 5, label: 'Build pie' }, { method: 'oven', minutes: 30, temp: 200, label: 'Into the oven' }],
  }),
};
const plan = buildPlan({ items: [pie], readyAt: at(18, 0), now: at(16, 0), preheatMinutes: 15 });
// steps: 0 Peel 16:50-17:00, 1 Fry 17:00-17:25, 2 Boil 17:05-17:20, 3 Preheat 17:15-17:30,
//        4 Mash 17:20-17:25, 5 Build 17:25-17:30, 6 Oven 17:30-18:00, 7 Dinner 18:00
const idx = label => plan.steps.findIndex(s => s.label === label);

test('plan steps say which dish, group and track they belong to', () => {
  const fry = plan.steps[idx('Fry mince')];
  assert.deepEqual([fry.name, fry.item, fry.group, fry.track], ['Mince pie', 0, 1, 0]);
  const mash = plan.steps[idx('Mash')];
  assert.deepEqual([mash.group, mash.track], [1, 1]);
  assert.equal(plan.steps[3].type, 'preheat');
});

test('jobs on the go: one per step that has started and is not done, with its own countdown', () => {
  const jobs = jobsOnTheGo(plan, at(17, 12), [idx('Peel potatoes')]);
  assert.deepEqual(jobs.map(j => j.step.label), ['Fry mince', 'Boil potatoes']);
  const [fry, boil] = jobs;
  assert.equal(fry.index, idx('Fry mince'));
  assert.equal(fry.endAt, at(17, 25));
  assert.equal(fry.leftMs, 13 * MIN);
  assert.equal(Math.round(fry.pct), 52);
  assert.equal(fry.over, false);
  assert.equal(fry.then, null);
  // the next step in the same cook line
  assert.equal(boil.then, 'Mash');
  assert.equal(boil.leftMs, 8 * MIN);
});

test('jobs on the go: preheat counts down to the first oven stage', () => {
  const jobs = jobsOnTheGo(plan, at(17, 22), [0, 1, 2]);
  const pre = jobs.find(j => j.step.type === 'preheat');
  assert.ok(pre);
  assert.equal(pre.endAt, at(17, 30));
  assert.equal(pre.leftMs, 8 * MIN);
  // in start order
  assert.deepEqual(jobs.map(j => j.step.type === 'preheat' ? 'preheat' : j.step.label), ['preheat', 'Mash']);
});

test('a job whose time is up stays on the go (over) until it is ticked done', () => {
  const jobs = jobsOnTheGo(plan, at(17, 12), []);
  const peel = jobs.find(j => j.step.label === 'Peel potatoes');
  assert.ok(peel);
  assert.equal(peel.over, true);
  assert.equal(peel.leftMs, 0);
  assert.equal(peel.pct, 0);
  // jobs not started yet and the dinner step are never on the go
  assert.equal(jobsOnTheGo(plan, at(16, 40), []).length, 0);
  assert.equal(jobsOnTheGo(plan, at(18, 1), [0, 1, 2, 3, 4, 5, 6]).length, 0);
});

test('each job has its own alarm when its time is up', () => {
  assert.deepEqual(endAlarms(plan, at(17, 19), at(17, 20), []).map(s => s.label), ['Boil potatoes']);
  // two lines finishing together both ring
  assert.deepEqual(endAlarms(plan, at(17, 24), at(17, 25), []).map(s => s.label).sort(), ['Fry mince', 'Mash']);
  // ticked done = no alarm
  assert.deepEqual(endAlarms(plan, at(17, 19), at(17, 20), [idx('Boil potatoes')]), []);
  // only cooking steps have an end alarm (not preheat, not dinner)
  assert.deepEqual(endAlarms(plan, at(17, 29), at(17, 30), []).map(s => s.label), ['Build pie']);
  assert.equal(endText(plan.steps[idx('Boil potatoes')]), "Boil potatoes — time's up");
});

test('next alarm: the soonest start or job end still to come', () => {
  const a = nextAlarm(plan, at(17, 12), [0]);
  assert.equal(a.at, at(17, 15));
  assert.equal(a.text, 'Preheat oven to 200°C');
  const b = nextAlarm(plan, at(17, 16), [0]);
  assert.equal(b.at, at(17, 20));
  // a job ticked done early does not ring at its end
  const c = nextAlarm(plan, at(17, 21), [0, 2, 3, 4]);
  assert.equal(c.at, at(17, 25));
  assert.match(c.text, /Fry mince — time's up|Build pie/);
  assert.equal(nextAlarm(plan, at(18, 1), []), null);
});
