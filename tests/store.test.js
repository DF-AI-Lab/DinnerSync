import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';

function memStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}

test('saved items: add, list, update same name, remove', () => {
  const s = createStore(memStorage());
  assert.deepEqual(s.getSavedItems(), []);
  s.saveItem({ name: 'Chicken', minutes: 90, temp: 180 });
  s.saveItem({ name: 'Veg', minutes: 20, temp: 200 });
  s.saveItem({ name: 'chicken', minutes: 80, temp: 190 }); // same name, case-insensitive -> update
  assert.deepEqual(s.getSavedItems().map(i => [i.name, i.minutes, i.temp]),
    [['chicken', 80, 190], ['Veg', 20, 200]]);
  s.removeItem('VEG');
  assert.equal(s.getSavedItems().length, 1);
});

test('last dinner persists', () => {
  const st = memStorage();
  createStore(st).saveLastDinner({ items: [{ name: 'Chicken', minutes: 90, temp: 180 }], preheatMinutes: 15 });
  assert.equal(createStore(st).getLastDinner().items[0].name, 'Chicken');
});

test('settings default preheat 15', () => {
  const s = createStore(memStorage());
  assert.equal(s.getSettings().preheatMinutes, 15);
  s.saveSettings({ preheatMinutes: 10 });
  assert.equal(s.getSettings().preheatMinutes, 10);
});

test('broken or missing storage does not crash', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  const s = createStore(bad);
  assert.deepEqual(s.getSavedItems(), []);
  s.saveItem({ name: 'A', minutes: 1, temp: 100 });
  const s2 = createStore(memStorage());
  s2.storage = null;
  const junk = memStorage(); junk.setItem('dinnersync.items', '{not json');
  assert.deepEqual(createStore(junk).getSavedItems(), []);
});

test('saved slow-cook stages keep High / Low', () => {
  const s = createStore(memStorage());
  s.saveItem({ name: 'Stew', stages: [{ method: 'slow', minutes: 240, setting: 'high' }] });
  assert.equal(s.getSavedItems()[0].stages[0].setting, 'high');
});
