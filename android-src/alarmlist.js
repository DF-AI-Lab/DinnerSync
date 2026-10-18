// Which alarms the phone should hold right now. Pure logic: the Android bridge sends the result to the native plugin.
// Only the current step and the next one are scheduled, so a Done tap on the lock screen can move on without the page.

const MIN = 60_000;

const headsUpMs = settings => {
  const v = settings?.headsUp;
  return v === '30' || v === '60' ? Number(v) * 1000 : 0;
};

const endText = step => `${step.label} — time's up`;

// done: ticked-off step indexes. headed: step index -> 'show' | 'onit' | 'ignored'.
export function buildAlarmList(plan, { done = [], headed = {} } = {}, settings = {}, now = Date.now()) {
  if (!plan?.steps?.length) return [];
  const ticked = new Set(done);
  const open = plan.steps.map((_, i) => i).filter(i => !ticked.has(i));
  const keep = open.slice(0, 2); // the current step and the next
  const headsMs = headsUpMs(settings);
  const list = [];
  for (const i of keep) {
    const step = plan.steps[i];
    if (step.at > now && headed[i] !== 'onit') {
      const wantsHeads = headsMs && (step.type === 'in' || step.type === 'preheat') && headed[i] === undefined;
      const headsUpAt = wantsHeads && step.at - headsMs > now ? step.at - headsMs : null;
      list.push({ id: `${i}:start`, at: step.at, title: step.say ?? step.text, body: step.type === 'ready' ? 'Dinner is ready' : step.text, headsUpAt });
    }
    if (step.type === 'in') {
      const end = step.at + step.minutes * MIN;
      if (end > now) list.push({ id: `${i}:end`, at: end, title: endText(step), body: step.text, headsUpAt: null });
    }
  }
  return list;
}

// What to tell the phone given what it already holds (id -> JSON of what was sent) and the new list.
export function diffSchedule(sent, list) {
  const wanted = new Map(list.map(a => [a.id, JSON.stringify(a)]));
  const cancel = [...sent.keys()].filter(id => !wanted.has(id));
  const schedule = list.filter(a => sent.get(a.id) !== wanted.get(a.id));
  return { cancel, schedule };
}
