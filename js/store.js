// Local storage wrapper. Every read and write is guarded so a broken or
// missing storage never crashes the app.

const PREFIX = 'dinnersync.';
const KEYS = {
  items: PREFIX + 'items',
  lastDinner: PREFIX + 'lastDinner',
  settings: PREFIX + 'settings',
  cooking: PREFIX + 'cooking',
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

  function getSavedItems() {
    const value = read(KEYS.items, []);
    if (!Array.isArray(value)) return [];
    return value.filter(x => x && typeof x.name === 'string' && x.name.trim());
  }

  function saveItem(item) {
    const list = getSavedItems();
    const clean = { name: item.name, minutes: item.minutes, temp: item.temp };
    const i = list.findIndex(x => sameName(x.name, clean.name));
    if (i >= 0) list[i] = clean;
    else list.push(clean);
    write(KEYS.items, list);
  }

  function removeItem(name) {
    write(KEYS.items, getSavedItems().filter(x => !sameName(x.name, name)));
  }

  function getLastDinner() {
    return read(KEYS.lastDinner, null);
  }

  function saveLastDinner(dinner) {
    write(KEYS.lastDinner, dinner);
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

  function getCooking() {
    return read(KEYS.cooking, null);
  }

  function saveCooking(state) {
    write(KEYS.cooking, state);
  }

  function clearCooking() {
    remove(KEYS.cooking);
  }

  return {
    getSavedItems,
    saveItem,
    removeItem,
    getLastDinner,
    saveLastDinner,
    getSettings,
    saveSettings,
    getCooking,
    saveCooking,
    clearCooking,
  };
}
