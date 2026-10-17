// Pure dinner-planning logic. No DOM access.
//
// An item is { name, stages: [{ method: 'oven'|'hob'|'rest'|'slow'|'prep', minutes, temp?, setting?, label?, group?, track? }] }.
// A slow stage is a slow cooker: setting is 'low' (default) or 'high', and it never uses the oven.
// Groups run one after another, in increasing group order. Within a group, tracks run side by side
// and all finish together at the group's end. Stages in the same group and track run in array order.
// A stage with no group gets group = its index, and no track gets track = 0, so old items run in order.
// The last group finishes at readyAt.
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
  slow: (name, _temp, setting) => `${name} into the slow cooker — ${setting === 'high' ? 'High' : 'Low'}`,
  prep: name => name,
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

// Stages grouped for layout: groups in order, each a list of tracks, each track a list of
// stages in array order. A stage with no group/track gets group = its index and track 0.
export function stageGroups(stages) {
  const groups = new Map();
  stages.forEach((st, i) => {
    const g = Number.isInteger(st.group) ? st.group : i;
    const t = Number.isInteger(st.track) ? st.track : 0;
    if (!groups.has(g)) groups.set(g, new Map());
    const tracks = groups.get(g);
    if (!tracks.has(t)) tracks.set(t, []);
    tracks.get(t).push(st);
  });
  const inOrder = m => [...m.keys()].sort((a, b) => a - b).map(k => m.get(k));
  return inOrder(groups).map(tracks => inOrder(tracks));
}

// Lay one item's stages out backwards from readyAt. Fills startAt (stage object -> start ms)
// and returns the item's total minutes: the sum of its group durations.
// A group lasts as long as its longest track. Every track in a group ends at the group's end.
function layoutStages(stages, readyAt, startAt) {
  const groups = stageGroups(stages);
  const trackMinutes = list => list.reduce((total, st) => total + st.cookMinutes, 0);
  const groupMinutes = tracks => Math.max(...tracks.map(trackMinutes));

  let end = readyAt;
  for (let g = groups.length - 1; g >= 0; g--) {
    const tracks = groups[g];
    for (const list of tracks) {
      let at = end - trackMinutes(list) * MIN;
      for (const st of list) {
        startAt.set(st, at);
        at += st.cookMinutes * MIN;
      }
    }
    end -= groupMinutes(tracks) * MIN;
  }
  return groups.reduce((total, tracks) => total + groupMinutes(tracks), 0);
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
  const startAt = new Map(); // stage object -> start time
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
      cookMinutes: layoutStages(stages, readyAt, startAt),
      main: i === mainIndex,
    };
  });

  // rank breaks ties at the same time: preheat, main item, other items, ready.
  const ranked = [];
  planItems.forEach((item, i) => {
    item.stages.forEach((st, si) => {
      // A stage label (e.g. "Boil potatoes") replaces the item name in the step text.
      const label = (typeof st.label === 'string' && st.label.trim()) || item.name;
      const text = (METHOD_TEXT[st.method] ?? (name => name))(label, ovenTemp, st.setting);
      // The layout slot, as stageGroups reads it: no group = its index, no track = 0.
      const group = Number.isInteger(st.group) ? st.group : si;
      const track = Number.isInteger(st.track) ? st.track : 0;
      ranked.push({
        rank: item.main ? 1 : 2,
        step: { type: 'in', name: item.name, item: i, label, method: st.method, at: startAt.get(st), text, minutes: st.cookMinutes, group, track },
      });
    });
  });

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

// ---------- sections: the form's three boxes ----------
// A dish is built from Get ready (one after another, group 0), Cook (each line is a track
// in group 1, all at the same time) and Finish (one after another, group 2).

const SECTIONS = ['ready', 'cook', 'finish'];

// { ready: [stage], cook: [[stage, ...], ...], finish: [stage] } -> flat stage list.
export function fromSections({ ready = [], cook = [], finish = [] } = {}) {
  const out = [];
  for (const st of ready) out.push({ ...st, section: 'ready', group: 0, track: 0 });
  let track = 0;
  for (const line of cook) {
    if (!line.length) continue; // empty lines leave no gap in the track numbers
    for (const st of line) out.push({ ...st, section: 'cook', group: 1, track });
    track++;
  }
  for (const st of finish) out.push({ ...st, section: 'finish', group: 2, track: 0 });
  return out;
}

// The inverse: an item's stages back into the three sections. Old items (no sections) are
// placed by their groups: the first group with several tracks is Cook, the groups before it
// are Get ready and the ones after it are Finish. With no such group, every stage is one cook line.
export function toSections(item) {
  const stages = normalizeItem(item).stages;
  const out = { ready: [], cook: [], finish: [] };
  if (stages.every(st => SECTIONS.includes(st.section))) {
    for (const st of stages.filter(s => s.section === 'ready')) out.ready.push(st);
    for (const st of stages.filter(s => s.section === 'finish')) out.finish.push(st);
    const tracks = new Map();
    for (const st of stages.filter(s => s.section === 'cook')) {
      const t = Number.isInteger(st.track) ? st.track : 0;
      if (!tracks.has(t)) tracks.set(t, []);
      tracks.get(t).push(st);
    }
    out.cook = [...tracks.keys()].sort((a, b) => a - b).map(t => tracks.get(t));
    return out;
  }
  const groups = stageGroups(stages);
  const k = groups.findIndex(tracks => tracks.length > 1);
  if (k < 0) {
    out.cook = [stages];
    return out;
  }
  out.ready = groups.slice(0, k).flat(2);
  out.cook = groups[k];
  out.finish = groups.slice(k + 1).flat(2);
  return out;
}

// Whole minutes from the earliest step (preheat included) to dinner. 0 for no items.
export function leadMinutes({ items = [], preheatMinutes = DEFAULT_PREHEAT }) {
  if (!items.length) return 0;
  const plan = buildPlan({ items, readyAt: 0, now: 0, preheatMinutes });
  return Math.round(-Math.min(...plan.steps.map(s => s.at)) / MIN);
}

// ---------- cooking: a timer per job, and alarms at the end of each job ----------

// Oven steps are the 'in' steps with method oven. The preheat ends when the first one starts.
// Each step on the go: started, not ticked done, and not the dinner step.
export function jobsOnTheGo(plan, now, doneIndexes = []) {
  const done = new Set(doneIndexes);
  const firstOven = plan.steps.find(s => s.type === 'in' && s.method === 'oven');
  const jobs = [];
  plan.steps.forEach((step, index) => {
    if (done.has(index) || step.at > now) return;
    if (step.type !== 'in' && step.type !== 'preheat') return;
    const endAt = step.type === 'in' ? step.at + step.minutes * MIN : (firstOven?.at ?? step.at);
    const duration = endAt - step.at;
    const leftMs = Math.max(0, endAt - now);
    const then = step.type === 'in'
      ? plan.steps.find((s, j) => j > index && s.type === 'in' && s.item === step.item && s.group === step.group && s.track === step.track)?.label ?? null
      : null;
    jobs.push({
      index,
      step,
      endAt,
      leftMs,
      pct: duration > 0 ? (leftMs / duration) * 100 : 0,
      over: now >= endAt,
      then,
    });
  });
  return jobs;
}

// The 'in' steps whose end falls in (from, to] and that are not ticked done.
export function endAlarms(plan, from, to, doneIndexes = []) {
  const done = new Set(doneIndexes);
  return plan.steps.filter((s, i) => {
    if (s.type !== 'in' || done.has(i)) return false;
    const end = s.at + s.minutes * MIN;
    return end > from && end <= to;
  });
}

export function endText(step) {
  return `${step.label} — time's up`;
}

// The soonest event after now: a step starting (any step not done), or a job ending.
// A start wins a tie with an end. Returns {at, text} or null.
export function nextAlarm(plan, now, doneIndexes = []) {
  const done = new Set(doneIndexes);
  let best = null;
  const consider = (at, text, rank) => {
    if (!(at > now)) return;
    if (!best || at < best.at || (at === best.at && rank < best.rank)) best = { at, text, rank };
  };
  plan.steps.forEach((s, i) => {
    if (done.has(i)) return;
    consider(s.at, s.text, 0);
    if (s.type === 'in') consider(s.at + s.minutes * MIN, endText(s), 1);
  });
  return best ? { at: best.at, text: best.text } : null;
}
