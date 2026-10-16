import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load sw.js with a fake service-worker world and grab its fetch handler.
function loadSw({ online }) {
  const handlers = {};
  const cache = new Map([['https://x/css/style.css', 'old css']]);
  const self = { location: { origin: 'https://x' }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim() {} } };
  const caches = {
    match: async req => cache.get(req.url),
    open: async () => ({ put: async (req, res) => cache.set(req.url, res.body), addAll: async () => {} }),
    keys: async () => [], delete: async () => true,
  };
  const fetch = async req => {
    if (!online) throw new Error('offline');
    return { ok: true, body: 'new css', clone() { return this; } };
  };
  new Function('self', 'caches', 'fetch', readFileSync('sw.js', 'utf8'))(self, caches, fetch);
  return { handlers, cache };
}

async function get(handlers, url) {
  let p;
  handlers.fetch({ request: { method: 'GET', url }, respondWith: r => { p = r; } });
  const res = await p;
  return typeof res === 'string' ? res : res.body;
}

test('online: always gets the newest file, not an old saved copy', async () => {
  const { handlers, cache } = loadSw({ online: true });
  assert.equal(await get(handlers, 'https://x/css/style.css'), 'new css');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(cache.get('https://x/css/style.css'), 'new css');
});

test('offline: falls back to the saved copy', async () => {
  const { handlers } = loadSw({ online: false });
  assert.equal(await get(handlers, 'https://x/css/style.css'), 'old css');
});
