// Pure dinner-planning logic. No DOM access.
//
// An item is { name, stages: [{ method: 'oven'|'hob'|'rest', minutes, temp? }] }.
// Stages run back-to-back in order; the last one finishes at readyAt.
// Old items { name, minutes, temp } are a single oven stage.

const MIN = 60_000;
export const DEFAULT_PREHEAT = 15;

// Hours/minutes from form fields. Blank, invalid or negative counts as 0.
const count = v => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function toMinutes(h, m) {
  return count(h) * 60 + count(m);
}

export function splitMinutes(min) {
  const total = count(min);
  return { h: Math.floor(total / 60), m: total % 60 };
}

// "1 hr 30 min", "45 min", "2 hr". Minutes over 59 are fine.
export function formatDuration(min) {
  const { h, m } = splitMinutes(min);
  if (!h) return `${m} min`;
  if (!m) return `${h} hr`;
  return `${h} hr ${m} min`;
}

const METHOD_TEXT = {
  oven: (name, temp) => `${name} into the oven — ${temp}°C`,
  hob: name => `${name} on the hob`,
  rest: name => `${name} out to rest`,
};

// Old single-stage items become one oven stage. Stage items are left alone.
export function normalizeItem(item) {
  if (Array.isArray(item.stages)) return item;
  const { minutes, temp, ...rest } = item;
  return { ...rest, stages: [{ method: 'oven', minutes, temp }] };
}

// Scale an item's cook time to the oven temperature (hotter oven = shorter).
export function adjustedMinutes(item, ovenTemp) {
  return Math.round((item.minutes * item.temp) / ovenTemp);
}

const ovenMinutes = item =>
  normalizeItem(item).stages
    .filter(s => s.method === 'oven')
    .reduce((total, s) => total + s.minutes, 0);

// The main item has the most oven minutes. Ties go to the first item listed.
export function pickMain(items) {
  let main = null;
  let best = -1;
  for (const item of items) {
    const minutes = ovenMinutes(item);
    if (minutes > best) {
      main = item;
      best = minutes;
    }
  }
  return main;
}

export function buildPlan({ items = [], readyAt, now, preheatMinutes = DEFAULT_PREHEAT }) {
  if (!items.length) {
    return { ovenTemp: null, readyAt, items: [], steps: [], enoughTime: true, earliestReady: null, shortByMinutes: 0 };
  }

  const normalized = items.map(normalizeItem);
  const main = pickMain(normalized);
  const mainIndex = normalized.indexOf(main);

  // Oven temp = the main item's first oven stage (or the first oven stage anywhere).
  const firstOven = normalized.flatMap(i => i.stages).find(s => s.method === 'oven');
  const ovenStage = main.stages.find(s => s.method === 'oven') ?? firstOven;
  const ovenTemp = ovenStage?.temp ?? null;

  // Only oven stages are scaled to the oven temperature.
  const planItems = normalized.map((item, i) => {
    const stages = item.stages.map(st => ({
      ...st,
      cookMinutes: st.method === 'oven' && st.temp && ovenTemp
        ? adjustedMinutes(st, ovenTemp)
        : st.minutes,
    }));
    return {
      ...item,
      stages,
      cookMinutes: stages.reduce((total, st) => total + st.cookMinutes, 0),
      main: i === mainIndex,
    };
  });

  // Lay each item out backwards from readyAt so its last stage finishes then.
  // rank breaks ties at the same time: preheat, main item, other items, ready.
  const ranked = [];
  for (const item of planItems) {
    let at = readyAt - item.cookMinutes * MIN;
    for (const st of item.stages) {
      // A stage label (e.g. "Boil potatoes") replaces the item name in the step text.
      const label = (typeof st.label === 'string' && st.label.trim()) || item.name;
      const text = (METHOD_TEXT[st.method] ?? (name => name))(label, ovenTemp);
      ranked.push({
        rank: item.main ? 1 : 2,
        step: { type: 'in', name: item.name, label, method: st.method, at, text, minutes: st.cookMinutes },
      });
      at += st.cookMinutes * MIN;
    }
  }

  const ovenStarts = ranked.filter(r => r.step.method === 'oven').map(r => r.step.at);
  if (ovenStarts.length) {
    ranked.push({
      rank: 0,
      step: { type: 'preheat', at: Math.min(...ovenStarts) - preheatMinutes * MIN, text: `Preheat oven to ${ovenTemp}°C` },
    });
  }
  ranked.push({ rank: 3, step: { type: 'ready', at: readyAt, text: 'Dinner is ready!' } });
  ranked.sort((a, b) => a.step.at - b.step.at || a.rank - b.rank);
  const steps = ranked.map(r => r.step);

  // Lead time = from the earliest step (preheat included) to dinner.
  // Round up to the whole minute (the UI shows minutes) so "use this time"
  // stays enough a few ms later when the status is redrawn.
  const earliestStep = Math.min(...steps.map(s => s.at));
  const lead = readyAt - earliestStep;
  const earliestReady = Math.ceil((now + lead) / MIN) * MIN;
  const enoughTime = earliestReady <= readyAt;
  const shortByMinutes = enoughTime ? 0 : Math.round((earliestReady - readyAt) / MIN);

  return { ovenTemp, readyAt, items: planItems, steps, enoughTime, earliestReady, shortByMinutes };
}

export function cookingState(plan, now) {
  const steps = plan.steps;
  let current = null;
  let next = null;
  for (const s of steps) {
    if (s.at <= now) current = s;
    else if (!next) next = s;
  }

  const readyAt = plan.readyAt ?? steps.find(s => s.type === 'ready')?.at ?? now;
  const msToNext = next ? next.at - now : 0;
  const msToDinner = Math.max(0, readyAt - now);

  // Preheat counts down to the first oven stage, not a hob stage.
  let preheatLeftMs = 0;
  if (current?.type === 'preheat') {
    const firstOven = steps.find(s => s.type === 'in' && s.method === 'oven');
    if (firstOven) preheatLeftMs = Math.max(0, firstOven.at - now);
  }

  return { current, next, msToNext, msToDinner, preheatLeftMs, done: now >= readyAt };
}

// Steps whose time falls in (from, to] that should sound: not already ticked off.
export function alarmSteps(plan, from, to, doneIndexes = []) {
  const done = new Set(doneIndexes);
  return plan.steps.filter((s, i) => s.at > from && s.at <= to && !done.has(i));
}

// Progress through the steps. doneIndexes are the steps the cook has ticked off.
// The first step not ticked off is 'current'; everything after it is 'upcoming'.
export function stepStatuses(plan, now, doneIndexes = []) {
  const done = new Set(doneIndexes);
  let currentFound = false;
  return plan.steps.map((step, index) => {
    let status;
    if (done.has(index)) status = 'done';
    else if (!currentFound) {
      status = 'current';
      currentFound = true;
    } else status = 'upcoming';
    return { ...step, index, status, due: step.at <= now };
  });
}

// The card for the current step: what the cook sees under "Dinner in".
// Due: counts down to the next step, with a bar that shrinks. Not due: counts
// down to the start of the current step. The last step ('ready') has no target.
export function currentCard(statuses, now) {
  const current = statuses.find(s => s.status === 'current');
  if (!current) return null;
  if (current.type === 'ready') {
    return { badge: 'NOW', countdownMs: 0, barPct: null, until: null, last: true };
  }
  if (!current.due) {
    return { badge: 'NEXT', countdownMs: current.at - now, barPct: null, until: null, last: false };
  }
  const next = statuses[current.index + 1];
  const left = next.at - now;
  const span = next.at - current.at;
  return {
    badge: 'NOW',
    countdownMs: Math.max(0, left),
    barPct: span > 0 ? Math.max(0, (left / span) * 100) : 0,
    until: next.text,
    last: false,
  };
}

// Whole minutes between now and a step's start. Never negative.
export function spareMinutes(step, now) {
  return Math.max(0, Math.round((step.at - now) / MIN));
}
