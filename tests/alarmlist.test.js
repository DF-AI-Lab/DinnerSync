import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../js/plan.js';
import { buildAlarmList, diffSchedule } from '../android-src/alarmlist.js';

const at = (h, m, s = 0) => new Date(2026, 9, 18, h, m, s).getTime();
const MIN = 60_000;
const plan = buildPlan({
  items: [{ name: 'Chicken', minutes: 90, temp: 180 }, { name: 'Veg', minutes: 20, temp: 180 }],
  readyAt: at(19, 0), now: at(17, 0), preheatMinutes: 15,
}); // preheat 17:15, Chicken in 17:30, Veg in 18:40, ready 19:00
const settings = { headsUp: '30' };
const ids = list => list.map(a => a.id);

test('rings the current step and the next one, nothing else', () => {
  const list = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  assert.deepEqual(ids(list), ['0:start', '1:start', '1:end']);
  assert.equal(list[0].at, at(17, 15));
});

test('a step that is running also rings when its time is up', () => {
  const list = buildAlarmList(plan, { done: [0] }, settings, at(17, 35));
  assert.deepEqual(ids(list), ['1:end', '2:start', '2:end']);
  assert.equal(list[0].at, at(17, 30) + 90 * MIN);
});

test('alarms already in the past are dropped', () => {
  const list = buildAlarmList(plan, { done: [] }, settings, at(17, 20));
  assert.ok(list.every(a => a.at > at(17, 20)));
});

test('a step marked "On it" does not ring when it starts', () => {
  const list = buildAlarmList(plan, { done: [], headed: { 0: 'onit' } }, settings, at(17, 0));
  assert.ok(!ids(list).includes('0:start'));
  assert.ok(ids(list).includes('1:start'));
});

test('heads-up is 30 sec before, 1 min before, or off', () => {
  const find = (s, now = at(17, 0)) => buildAlarmList(plan, { done: [] }, { headsUp: s }, now).find(a => a.id === '0:start');
  assert.equal(find('30').headsUpAt, at(17, 15) - 30_000);
  assert.equal(find('60').headsUpAt, at(17, 15) - 60_000);
  assert.equal(find('off').headsUpAt, null);
});

test('no heads-up once it was shown, or when it is already too late', () => {
  const shown = buildAlarmList(plan, { done: [], headed: { 0: 'ignored' } }, settings, at(17, 0));
  assert.equal(shown[0].headsUpAt, null);
  const late = buildAlarmList(plan, { done: [] }, settings, at(17, 14, 45));
  assert.equal(late[0].headsUpAt, null);
});

test('only steps that start something get a heads-up', () => {
  const list = buildAlarmList(plan, { done: [0, 1, 2] }, settings, at(17, 0));
  assert.deepEqual(ids(list), ['3:start']);
  assert.equal(list[0].headsUpAt, null); // dinner is ready: no heads-up
});

test('Done on the current step moves the list on to the next one', () => {
  const before = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  const after = buildAlarmList(plan, { done: [0] }, settings, at(17, 0));
  assert.equal(before[0].id, '0:start');
  assert.deepEqual(ids(after), ['1:start', '1:end', '2:start', '2:end']);
});

test('Undo brings the previous step back', () => {
  const undone = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  assert.deepEqual(ids(undone), ['0:start', '1:start', '1:end']);
});

test('no plan means no alarms', () => {
  assert.deepEqual(buildAlarmList(null, { done: [] }, settings, at(17, 0)), []);
});

test('alarms carry a title and body to show', () => {
  const [first] = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  assert.ok(first.title.length > 0);
  assert.equal(typeof first.body, 'string');
});

test('changing the plan cancels old ids and schedules the new ones', () => {
  const old = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  const sent = new Map(old.map(a => [a.id, JSON.stringify(a)]));
  const next = buildAlarmList(plan, { done: [0] }, settings, at(17, 0));
  const { cancel, schedule } = diffSchedule(sent, next);
  assert.deepEqual(cancel, ['0:start']);
  assert.deepEqual(schedule.map(a => a.id), ['2:start', '2:end']);
});

test('nothing changed means nothing is sent, so there are no duplicates', () => {
  const list = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  const sent = new Map(list.map(a => [a.id, JSON.stringify(a)]));
  assert.deepEqual(diffSchedule(sent, list), { cancel: [], schedule: [] });
});

test('a changed time under the same id is sent again', () => {
  const list = buildAlarmList(plan, { done: [] }, settings, at(17, 0));
  const sent = new Map(list.map(a => [a.id, JSON.stringify(a)]));
  const moved = list.map((a, i) => (i === 0 ? { ...a, at: a.at + MIN } : a));
  const { cancel, schedule } = diffSchedule(sent, moved);
  assert.deepEqual(cancel, []);
  assert.deepEqual(schedule.map(a => a.id), ['0:start']);
});
