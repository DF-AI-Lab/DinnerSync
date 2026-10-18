// Local storage wrapper. Every read and write is guarded so a broken or
// missing storage never crashes the app.

import { normalizeItem } from './plan.js';

const PREFIX = 'dinnersync.demo.'; // demo has its own data, live keeps 'dinnersync.' (swap back on release)
const KEYS = {
  items: PREFIX + 'items',
  lastDinner: PREFIX + 'lastDinner',
  settings: PREFIX + 'settings',
  cooking: PREFIX + 'cooking',
  libItems: PREFIX + 'lib.items', // saved items: name -> steps
  libMeals: PREFIX + 'lib.meals', // saved meals: name -> { together, items, groups }
  tonight: PREFIX + 'tonight',   // the meal being set up
};
const DEFAULT_SETTINGS = { preheatMinutes: 15 };

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export function createStore(storage) {
  function read(key, fallback) {
    try {
      const raw = storage?.getItem(key);
      if (raw == null) return fallback;
      const value = JSON.parse(raw);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      storage?.setItem(key, JSON.stringify(value));
    } catch {
      // storage full or blocked: carry on without saving
    }
  }

  function remove(key) {
    try {
      storage?.removeItem(key);
    } catch {
      // ignore
    }
  }

  // Saved items keep their stages, with their section, group and track. minutes/temp mirror the
  // first oven stage so older copies of the app can still read the list.
  function cleanItem(item) {
    const n = normalizeItem(item);
    const stages = n.stages.map(({ method, minutes, temp, setting, label, section, group, track }) => {
      const out = method === 'oven' ? { method, minutes, temp } : { method, minutes };
      const text = typeof label === 'string' ? label.trim() : '';
      if (text) out.label = text;
      if (method === 'slow') out.setting = setting === 'high' ? 'high' : 'low';
      if (['ready', 'cook', 'finish'].includes(section)) out.section = section;
      if (Number.isInteger(group)) out.group = group;
      if (Number.isInteger(track)) out.track = track;
      return out;
    });
    const oven = stages.find(s => s.method === 'oven');
    return { name: n.name, stages, minutes: oven?.minutes, temp: oven?.temp };
  }

  function getSavedItems() {
    const value = read(KEYS.items, []);
    if (!Array.isArray(value)) return [];
    return value
      .filter(x => x && typeof x.name === 'string' && x.name.trim())
      .map(normalizeItem);
  }

  function saveItem(item) {
    const list = getSavedItems();
    const clean = cleanItem(item);
    const i = list.findIndex(x => sameName(x.name, clean.name));
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    write(KEYS.items, list);
  }

  function removeItem(name) {
    write(KEYS.items, getSavedItems().filter(x => !sameName(x.name, name)));
  }

  function getLastDinner() {
    const dinner = read(KEYS.lastDinner, null);
    if (!dinner || !Array.isArray(dinner.items)) return dinner;
    return { ...dinner, items: dinner.items.filter(x => x && typeof x.name === 'string').map(normalizeItem) };
  }

  function saveLastDinner(dinner) {
    write(KEYS.lastDinner, dinner);
  }

  function clearLastDinner() {
    remove(KEYS.lastDinner);
  }

  function getSettings() {
    const value = read(KEYS.settings, {});
    const stored = value && typeof value === 'object' ? value : {};
    const preheatMinutes = Number.isFinite(stored.preheatMinutes) ? stored.preheatMinutes : DEFAULT_SETTINGS.preheatMinutes;
    return { ...DEFAULT_SETTINGS, ...stored, preheatMinutes };
  }

  function saveSettings(patch) {
    write(KEYS.settings, { ...getSettings(), ...patch });
  }

  // Saved items and meals. A fresh install starts empty; you build your own.
  const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
  function readMap(key) {
    const value = read(key, null);
    return isMap(value) ? value : {};
  }

  function getLibraryItems() {
    return readMap(KEYS.libItems);
  }

  function saveLibraryItem(name, steps) {
    write(KEYS.libItems, { ...getLibraryItems(), [name]: steps });
  }

  function removeLibraryItem(name) {
    const { [name]: _gone, ...rest } = getLibraryItems();
    write(KEYS.libItems, rest);
  }

  function getLibraryMeals() {
    return readMap(KEYS.libMeals);
  }

  function saveLibraryMeal(name, meal) {
    write(KEYS.libMeals, { ...getLibraryMeals(), [name]: meal });
  }

  function removeLibraryMeal(name) {
    const { [name]: _gone, ...rest } = getLibraryMeals();
    write(KEYS.libMeals, rest);
  }

  function getTonight() {
    const value = read(KEYS.tonight, null);
    return isMap(value) && isMap(value.meal) ? value : null;
  }

  function saveTonight(tonight) {
    write(KEYS.tonight, tonight);
  }

  function clearTonight() {
    remove(KEYS.tonight);
  }

  function getCooking() {
    return read(KEYS.cooking, null);
  }

  function saveCooking(state) {
    write(KEYS.cooking, state);
  }

  function clearCooking() {
    remove(KEYS.cooking);
  }

  // Backup file: saved items and meals, plus the preheat setting. Loading replaces what is here.
  function exportData() {
    return {
      app: 'DinnerSync',
      version: 1,
      savedAt: new Date().toISOString(),
      items: getLibraryItems(),
      meals: getLibraryMeals(),
      settings: getSettings(),
    };
  }

  // Reads a backup without saving anything: the clean items and meals, or null if it isn't one.
  function readBackup(data) {
    if (!isMap(data) || data.app !== 'DinnerSync') return null;
    const keep = (m, ok) => Object.fromEntries(Object.entries(isMap(m) ? m : {}).filter(([n, v]) => n.trim() && ok(v)));
    return {
      items: keep(data.items, Array.isArray),
      meals: keep(data.meals, isMap),
      preheat: isMap(data.settings) && Number.isFinite(data.settings.preheatMinutes) ? data.settings.preheatMinutes : null,
    };
  }

  function importData(data) {
    const backup = readBackup(data);
    if (!backup) return null;
    write(KEYS.libItems, backup.items);
    write(KEYS.libMeals, backup.meals);
    if (backup.preheat != null) saveSettings({ preheatMinutes: backup.preheat });
    return { items: Object.keys(backup.items).length, meals: Object.keys(backup.meals).length };
  }

  return {
    exportData,
    readBackup,
    importData,
    getSavedItems,
    saveItem,
    removeItem,
    getLastDinner,
    saveLastDinner,
    clearLastDinner,
    getSettings,
    saveSettings,
    getLibraryItems,
    saveLibraryItem,
    removeLibraryItem,
    getLibraryMeals,
    saveLibraryMeal,
    removeLibraryMeal,
    getTonight,
    saveTonight,
    clearTonight,
    getCooking,
    saveCooking,
    clearCooking,
  };
}
