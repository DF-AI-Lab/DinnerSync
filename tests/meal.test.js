import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  step, sumMinutes, starterItems, starterMeals, mealFromSaved, savedFromMeal,
  findShared, schedule, totalMinutes, prepFirstExtra, ovenNotes, toPlan,
} from '../js/meal.js';
import { alarmSteps, nextAlarm, jobsOnTheGo } from '../js/plan.js';

const MIN = 60_000;
const D = new Date(2026, 9, 18, 19, 0).getTime(); // dinner 7:00pm
const at = (h, m) => new Date(2026, 9, 18, h, m).getTime();
const lib = () => starterItems();
const meal = name => mealFromSaved(starterMeals()[name], lib(), name);
const flat = rows => rows.map(r => [r.at, r.who, r.text ?? r.preheat ?? r.remind]);

test('starter data has the items and meals from the mock', () => {
  const items = starterItems();
  for (const n of ['Roast potatoes', 'Roast chicken', 'Gammon joint', 'Carrots', 'Peas', 'Gravy', 'Yorkshire puddings', 'Mince', 'Mash']) {
    assert.ok(items[n], n);
  }
  assert.deepEqual(Object.keys(starterMeals()), ["Shepherd's pie & roasties", "Shepherd's pie", 'Chicken dinner', 'Gammon dinner']);
  const roasties = items['Roast potatoes'];
  assert.deepEqual(roasties.map(s => [s.kind, s.min]), [['prep', 15], ['hob', 25], ['rest', 30], ['oven', 55]]);
  assert.equal(roasties[3].temp, 200);
  assert.deepEqual(roasties[3].check, { at: 30, text: 'Turn potatoes' });
});

test('starter data is a fresh copy each time', () => {
  starterItems()['Peas'][0].min = 99;
  assert.equal(starterItems()['Peas'][0].min, 5);
});

test('mealFromSaved builds items from the library; unknown items start with no steps', () => {
  const m = mealFromSaved({ items: ['Peas', 'Nope'] }, lib(), 'Tea');
  assert.equal(m.name, 'Tea');
  assert.equal(m.together, false);
  assert.deepEqual(m.items.map(i => i.name), ['Peas', 'Nope']);
  assert.equal(m.items[1].steps.length, 0);
  const pie = meal("Shepherd's pie & roasties");
  assert.equal(pie.together, true);
  assert.equal(pie.groups[0].name, "Shepherd's pie");
  assert.deepEqual(pie.groups[0].items.map(i => i.name), ['Mince', 'Mash']);
  assert.deepEqual(pie.groups[0].finish.map(s => s.text), ['Build pie', 'Bake']);
});

test('savedFromMeal keeps names and built dishes; a meal round-trips', () => {
  const pie = meal("Shepherd's pie & roasties");
  const saved = savedFromMeal(pie);
  assert.deepEqual(saved.items, ['Roast potatoes', 'Peas']);
  assert.deepEqual(saved.groups[0].items, ['Mince', 'Mash']);
  assert.equal(saved.groups[0].finish.length, 2);
  const back = mealFromSaved(saved, lib(), pie.name);
  assert.deepEqual(back.groups.map(g => g.items.map(i => i.name)), [['Mince', 'Mash']]);
  // with the switch off, built dishes are not saved
  assert.deepEqual(savedFromMeal({ ...pie, together: false }).groups, []);
});

test('a plain item is timed backwards to end at dinner, steps one after another', () => {
  const m = mealFromSaved({ items: ['Carrots'] }, lib(), 'x');
  const rows = schedule(m, D, { prepFirst: false });
  assert.deepEqual(rows.map(r => [r.at, r.text]), [[at(18, 35), 'Peel & chop'], [at(18, 40), 'Boil']]);
});

test('an oven step adds a preheat row before the first oven step; reminder is its own row', () => {
  const m = mealFromSaved({ items: ['Roast potatoes'] }, lib(), 'x');
  const rows = schedule(m, D, { prepFirst: false });
  // roast 55 min starts 6:05; turn alarm 30 min in; preheat 15 min before
  const roast = rows.find(r => r.text === 'Roast');
  assert.equal(roast.at, at(18, 5));
  assert.equal(rows.find(r => r.remind).at, at(18, 35));
  assert.equal(rows.find(r => r.remind).remind, 'Turn potatoes');
  const pre = rows.find(r => r.preheat);
  assert.equal(pre.at, at(17, 50));
  assert.equal(pre.preheat, 200);
});

test('built dish: parts end when the finish starts; finish runs to dinner', () => {
  const m = meal("Shepherd's pie");
  const rows = schedule(m, D, { prepFirst: false });
  const find = (who, text) => rows.find(r => r.who === who && r.text === text);
  assert.equal(find("Shepherd's pie", 'Build pie').at, at(18, 25));
  assert.equal(find("Shepherd's pie", 'Bake').at, at(18, 30));
  // parts end at 6:25: Mince fry 25 -> 6:00, chop 10 -> 5:50
  assert.equal(find("Shepherd's pie › Mince", 'Fry onion & mince').at, at(18, 0));
  assert.equal(find("Shepherd's pie › Mince", 'Chop onion & carrot').at, at(17, 50));
  // Mash: peel 10, boil 20, mash 5 ends 6:25 -> mash 6:20, boil 6:00, peel 5:50
  assert.equal(find("Shepherd's pie › Mash", 'Mash potatoes').at, at(18, 20));
  assert.equal(find("Shepherd's pie › Mash", 'Boil').at, at(18, 0));
  assert.equal(find("Shepherd's pie › Mash", 'Peel potatoes').at, at(17, 50));
});

test('everything else is ready at dinner, same time as the built dish', () => {
  const m = meal("Shepherd's pie & roasties");
  const rows = schedule(m, D, { prepFirst: false });
  const ends = rows.filter(r => r.s && (r.who === 'Peas' || r.who === 'Roast potatoes'))
    .map(r => r.at + r.min * MIN);
  assert.equal(Math.max(...ends), D);
  const pieBake = rows.find(r => r.who === "Shepherd's pie" && r.text === 'Bake');
  assert.equal(pieBake.at + pieBake.min * MIN, D);
});

test('findShared: two items starting with the same prep step', () => {
  const shared = findShared(meal("Shepherd's pie & roasties"));
  assert.equal(shared.length, 1);
  assert.equal(shared[0].text, 'Peel potatoes');
  assert.deepEqual(shared[0].names.sort(), ['Mash', 'Roast potatoes']);
  assert.equal(findShared(meal("Shepherd's pie")).length, 0);
  // case and spaces do not matter
  const m = mealFromSaved({ items: ['Mash', 'Roast potatoes'] }, lib(), 'x');
  m.items[0].steps[0].text = '  peel POTATOES ';
  assert.equal(findShared(m).length, 1);
});

test('built dishes are ignored for sharing when the switch is off', () => {
  const m = meal("Shepherd's pie & roasties");
  m.together = false;
  assert.equal(findShared(m).length, 0);
});

test('shared peel is done once with the times added, ahead of the earlier boil', () => {
  const m = meal("Shepherd's pie & roasties");
  const rows = schedule(m, D, { prepFirst: false });
  const peels = rows.filter(r => r.text === 'Peel potatoes');
  assert.equal(peels.length, 1);
  assert.equal(peels[0].min, 25); // 10 + 15
  assert.equal(peels[0].shared, true);
  assert.equal(peels[0].who, 'Mash + Roast potatoes');
  // the boils stay separate, each at its own time
  assert.equal(rows.filter(r => r.text === 'Boil').length >= 2, true);
  const boils = rows.filter(r => r.text === 'Boil').map(r => r.who);
  assert.ok(boils.includes("Shepherd's pie › Mash") && boils.includes('Roast potatoes'));
  // peel finishes right before the earliest first cooking step (roasties boil at 5:35pm?)
  const first = Math.min(...rows.filter(r => r.s && r.text !== 'Peel potatoes').map(r => r.at));
  assert.equal(peels[0].at + 25 * MIN <= first, true);
});

test('prep first: leading prep steps are pulled into one block before any cooking', () => {
  const m = meal("Shepherd's pie");
  const rows = schedule(m, D, { prepFirst: true });
  const prep = rows.filter(r => r.prep1);
  assert.deepEqual(prep.map(r => r.text).sort(), ['Chop onion & carrot', 'Peel potatoes']);
  // one after another, no overlap
  const sorted = [...prep].sort((a, b) => a.at - b.at);
  assert.equal(sorted[0].at + sorted[0].min * MIN <= sorted[1].at, true);
  // all prep ends before the first cooking step starts
  const cookStart = Math.min(...rows.filter(r => r.s && !r.prep1).map(r => r.at));
  assert.equal(sorted[1].at + sorted[1].min * MIN <= cookStart, true);
  // prep that comes after cooking (mash, build pie) stays where it is
  assert.equal(rows.find(r => r.text === 'Mash potatoes').prep1, undefined);
  assert.equal(rows.find(r => r.text === 'Build pie').prep1, undefined);
});

test('prep first adds time; the extra is reported', () => {
  const m = meal("Shepherd's pie");
  const off = totalMinutes(m, { prepFirst: false });
  const on = totalMinutes(m, { prepFirst: true });
  assert.ok(on > off);
  assert.equal(prepFirstExtra(m), on - off);
  assert.equal(prepFirstExtra(mealFromSaved({ items: ['Peas'] }, lib(), 'x')), 0);
});

test('totalMinutes: plain items = longest item (+ preheat if there is an oven)', () => {
  assert.equal(totalMinutes(mealFromSaved({ items: ['Peas'] }, lib(), 'x'), { prepFirst: false }), 5);
  assert.equal(totalMinutes(mealFromSaved({ items: ['Yorkshire puddings'] }, lib(), 'x'), { prepFirst: false }), 35); // 20 + 15 preheat
  assert.equal(totalMinutes(mealFromSaved({ items: ['Yorkshire puddings'] }, lib(), 'x'), { prepFirst: false, preheat: 0 }), 20);
  assert.equal(totalMinutes({ name: '', together: false, groups: [], items: [] }), 0);
});

test('one oven: the shorter oven step moves to the longer one\'s temp and its time is scaled', () => {
  const m = mealFromSaved({ items: ['Roast chicken', 'Roast potatoes'] }, lib(), 'x');
  const rows = schedule(m, D, { prepFirst: false });
  const roast = rows.find(r => r.who === 'Roast potatoes' && r.kind === 'oven');
  assert.equal(roast.temp, 190); // chicken (80 min) is the main item
  assert.equal(roast.min, Math.round(55 * 200 / 190));
  assert.deepEqual(roast.was, { min: 55, temp: 200 });
  assert.equal(rows.find(r => r.preheat).preheat, 190);
  assert.match(ovenNotes(rows)[0], /Roast potatoes: oven 190°C, not 200°C/);
  // the potatoes still end at dinner
  assert.equal(roast.at + roast.min * 60_000, D);
  // the saved meal is not changed
  assert.equal(m.items[1].steps[3].temp, 200);
  // same temp: nothing changes
  const same = mealFromSaved({ items: ['Roast chicken', 'Roast chicken'] }, lib(), 'x');
  assert.deepEqual(ovenNotes(schedule(same, D, { prepFirst: false })), []);
  // do not overlap in time: nothing changes
  const seq = { name: 'x', together: false, groups: [], items: [
    { name: 'A', steps: [step('oven', 'Bake', 10, 180)] },
  ], };
  assert.deepEqual(ovenNotes(schedule(seq, D)), []);
});

test('one oven: three temps settle on the longest one\'s temp', () => {
  const m = mealFromSaved({ items: ['Roast chicken', 'Roast potatoes', 'Yorkshire puddings'] }, lib(), 'x');
  const ovens = schedule(m, D, { prepFirst: false }).filter(r => r.kind === 'oven');
  assert.deepEqual([...new Set(ovens.map(r => r.temp))], [190]);
});

test('toPlan: steps the cook screen understands, in time order, dinner last', () => {
  const m = meal("Shepherd's pie");
  const now = at(16, 0);
  const plan = toPlan(m, D, now, { prepFirst: true });
  assert.equal(plan.readyAt, D);
  assert.equal(plan.steps.at(-1).type, 'ready');
  assert.equal(plan.steps.at(-1).at, D);
  const ats = plan.steps.map(s => s.at);
  assert.deepEqual([...ats].sort((a, b) => a - b), ats);
  assert.equal(plan.steps[0].type === 'in' || plan.steps[0].type === 'preheat', true);
  const bake = plan.steps.find(s => s.type === 'in' && s.label.endsWith('Bake'));
  assert.equal(bake.method, 'oven');
  assert.equal(bake.minutes, 30);
  assert.equal(bake.name, "Shepherd's pie");
  assert.equal(plan.ovenTemp, 200);
  assert.equal(plan.enoughTime, true);
  assert.deepEqual(plan.items, []);
});

test('toPlan: preheat is a step; reminder is a remind step that alarms', () => {
  const m = mealFromSaved({ items: ['Roast potatoes'] }, lib(), 'x');
  const plan = toPlan(m, D, at(16, 0), { prepFirst: false });
  assert.equal(plan.steps.filter(s => s.type === 'preheat').length, 1);
  const rem = plan.steps.find(s => s.type === 'remind');
  assert.equal(rem.at, at(18, 35));
  assert.match(rem.say, /Turn potatoes/);
  const rung = alarmSteps(plan, at(18, 34), at(18, 36));
  assert.deepEqual(rung.map(s => s.type), ['remind']);
  // the cook screen's helpers work on it
  assert.ok(nextAlarm(plan, at(18, 30)));
  assert.equal(jobsOnTheGo(plan, at(18, 10)).some(j => j.step.method === 'oven'), true);
});

test('toPlan: not enough time says the earliest ready time', () => {
  const m = mealFromSaved({ items: ['Roast chicken'] }, lib(), 'x');
  const plan = toPlan(m, at(16, 30), at(16, 0), { prepFirst: false });
  assert.equal(plan.enoughTime, false);
  assert.ok(plan.shortByMinutes > 0);
  assert.ok(plan.earliestReady > at(16, 30));
});

test('alarm text names the item so "Boil" is not ambiguous', () => {
  const m = meal("Shepherd's pie");
  const plan = toPlan(m, D, at(16, 0), { prepFirst: false });
  const boil = plan.steps.find(s => s.type === 'in' && s.text === 'Boil');
  assert.match(boil.say, /Mash/);
  assert.match(boil.say, /Boil/);
});

test('slow cook step: its own kind, with a Low/High setting shown in the plan', () => {
  const stew = { name: 'Stew', steps: [{ kind: 'slow', text: 'Slow cook stew', min: 240, setting: 'high' }] };
  const meal = { name: '', together: false, groups: [], items: [stew] };
  const D = Date.UTC(2026, 0, 1, 18, 0);
  const rows = schedule(meal, D);
  assert.equal(rows.length, 1); // no oven preheat for a slow cooker
  assert.equal(rows[0].kind, 'slow');
  assert.equal(new Date(rows[0].at).getUTCHours(), 14);
  const plan = toPlan(meal, D, D - 5 * 3600_000);
  assert.match(plan.steps.find(x => x.type === 'in').text, /Slow cook stew · High/);
});
