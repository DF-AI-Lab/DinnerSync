// Pure dinner-planning logic. No DOM access.

const MIN = 60_000;
export const DEFAULT_PREHEAT = 15;

// Scale an item's cook time to the oven temperature (hotter oven = shorter).
export function adjustedMinutes(item, ovenTemp) {
  return Math.round((item.minutes * item.temp) / ovenTemp);
}

// The main item is the longest cook. Ties go to the first item listed.
export function pickMain(items) {
  let main = null;
  for (const item of items) {
    if (!main || item.minutes > main.minutes) main = item;
  }
  return main;
}

export function buildPlan({ items = [], readyAt, now, preheatMinutes = DEFAULT_PREHEAT }) {
  if (!items.length) {
    return { ovenTemp: null, readyAt, items: [], steps: [], enoughTime: true, earliestReady: null, shortByMinutes: 0 };
  }

  const main = pickMain(items);
  const mainIndex = items.indexOf(main);
  const ovenTemp = main.temp;

  const planItems = items.map((item, i) => ({
    ...item,
    cookMinutes: adjustedMinutes(item, ovenTemp),
    main: i === mainIndex,
  }));

  const longest = Math.max(...planItems.map(i => i.cookMinutes));
  const earliestIn = readyAt - longest * MIN;

  // rank breaks ties at the same time: preheat, main item, other items, ready.
  const ranked = [
    {
      rank: 0,
      step: { type: 'preheat', at: earliestIn - preheatMinutes * MIN, text: `Preheat oven to ${ovenTemp}°C` },
    },
    ...planItems.map((item, i) => ({
      rank: item.main ? 1 : 2,
      step: { type: 'in', name: item.name, at: readyAt - item.cookMinutes * MIN, text: `${item.name} in — oven ${ovenTemp}°C` },
    })),
    { rank: 3, step: { type: 'ready', at: readyAt, text: 'Dinner is ready!' } },
  ];
  ranked.sort((a, b) => a.step.at - b.step.at || a.rank - b.rank);
  const steps = ranked.map(r => r.step);

  // Round up to the whole minute (the UI shows minutes) so "use this time"
  // stays enough a few ms later when the status is redrawn.
  const earliestReady = Math.ceil((now + (preheatMinutes + longest) * MIN) / MIN) * MIN;
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

  let preheatLeftMs = 0;
  if (current?.type === 'preheat') {
    const firstIn = steps.find(s => s.type === 'in');
    if (firstIn) preheatLeftMs = Math.max(0, firstIn.at - now);
  }

  return { current, next, msToNext, msToDinner, preheatLeftMs, done: now >= readyAt };
}
