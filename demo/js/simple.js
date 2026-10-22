// The simple timer's maths. No DOM access; times are ms, so it is easy to test.
//
// A dish is { name, time, early }: time = minutes it cooks, early = minutes it comes off before dinner (to rest).
// Everything works back from dinner: a dish goes on at dinner - (time + early) and comes off at dinner - early.

export const MIN = 60000;
export const EARLY_STEPS = [0, 5, 10, 15, 20, 30];

// − / + on a dish's time: 1 min steps up to 10 min, then 5 min steps. Never below 1 min.
export function stepTime(min, dir) {
  if (dir > 0) return min < 10 ? min + 1 : Math.floor(min / 5) * 5 + 5;
  if (min <= 10) return Math.max(1, min - 1);
  return Math.ceil(min / 5) * 5 - 5;
}

// "Done early" cycles off → 5 → 10 → 15 → 20 → 30 → off.
export function nextEarly(early) {
  const i = EARLY_STEPS.indexOf(early);
  return EARLY_STEPS[(i + 1) % EARLY_STEPS.length];
}

// Minutes from the first dish going on to dinner: the longest time + early.
export function totalMinutes(dishes) {
  return dishes.reduce((most, d) => Math.max(most, d.time + d.early), 0);
}

// When each dish goes on and comes off, for dinner at `dinnerAt`.
export function schedule(dishes, dinnerAt) {
  const startAt = dinnerAt - totalMinutes(dishes) * MIN;
  const rows = dishes.map(d => ({
    ...d,
    onAt: dinnerAt - (d.time + d.early) * MIN,
    offAt: dinnerAt - d.early * MIN,
  }));
  return { dinnerAt, startAt, rows };
}

// Join names the way you'd say them: "Mash", "Mash & Chicken", "Mash, Chicken & Peas".
const say = names => (names.length < 2 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`);

// The alarms, in time order. Things due at the same moment share one alarm: "Take Chicken off · Put Peas on".
export function alarms(dishes, dinnerAt) {
  const { rows } = schedule(dishes, dinnerAt);
  const byTime = new Map();
  const at = t => {
    if (!byTime.has(t)) byTime.set(t, { on: [], off: [] });
    return byTime.get(t);
  };
  for (const r of rows) {
    at(r.onAt).on.push(r.name);
    if (r.early > 0) at(r.offAt).off.push(r.name);
  }
  const list = [...byTime.entries()].map(([t, { on, off }]) => {
    const parts = [];
    if (off.length) parts.push(`Take ${say(off)} off`);
    if (on.length) parts.push(`Put ${say(on)} on`);
    return { at: t, text: parts.join(' · ') };
  });
  list.push({ at: dinnerAt, text: "Dinner's ready!", last: true });
  return list.sort((a, b) => a.at - b.at);
}

// Where a dish is at `now`.
export function dishState(row, now) {
  if (now < row.onAt) return 'waiting';
  if (now < row.offAt) return 'cooking';
  return 'ready';
}

// 6:35pm
export function clock(ms) {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')}${d.getHours() < 12 ? 'am' : 'pm'}`;
}

// 23:05 or 1:02:09
export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const mmss = `${String(m).padStart(h ? 2 : 1, '0')}:${String(s % 60).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

// Round up to the next whole minute, so "Start now" times read cleanly.
export const nextMinute = ms => Math.ceil(ms / MIN) * MIN;
