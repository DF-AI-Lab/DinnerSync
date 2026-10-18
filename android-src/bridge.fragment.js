
// ---------- Android bridge (added only to the app's copy of this file; see scripts/sync-web.mjs) ----------
// Sends the alarms to the native plugin whenever the plan changes, and turns taps on the native alarm
// (Stop alarm, Done, On it, Ignore) into the same actions the buttons on the page do.

const nativeAlarms = (() => {
  try {
    const cap = window.Capacitor;
    if (!cap?.isNativePlatform?.()) return null;
    return cap.registerPlugin('DinnerAlarms');
  } catch {
    return null;
  }
})();

if (nativeAlarms) {
  // The page API from docs/android-brief.md
  window.DinnerAlarms = {
    schedule: alarms => nativeAlarms.schedule({ alarms }),
    cancel: ids => nativeAlarms.cancel({ ids }),
    cancelAll: () => nativeAlarms.cancelAll(),
  };

  const sentAlarms = new Map(); // id -> JSON of what the phone holds
  let askedSetup = false;

  const syncAlarms = () => {
    const list = cook ? buildAlarmList(cook.plan, { done: cook.done, headed: cook.headed }, store.getSettings(), Date.now()) : [];
    if (cook && !askedSetup) {
      askedSetup = true;
      nativeAlarms.setup().catch(() => {});
    }
    const { cancel, schedule } = diffSchedule(sentAlarms, list);
    if (!cancel.length && !schedule.length) return;
    for (const id of cancel) sentAlarms.delete(id);
    for (const a of schedule) sentAlarms.set(a.id, JSON.stringify(a));
    if (!sentAlarms.size) window.DinnerAlarms.cancelAll().catch(() => {});
    else {
      if (cancel.length) window.DinnerAlarms.cancel(cancel).catch(() => {});
      if (schedule.length) window.DinnerAlarms.schedule(schedule).catch(() => {});
    }
  };

  const stepOf = id => Number(String(id).split(':')[0]);

  // Same effect as the Done button on a card; the dinner alarm ends cooking.
  const nativeDone = id => {
    const index = stepOf(id);
    if (!cook || !(index >= 0)) return;
    stopAlarm();
    if (cook.plan.steps[index]?.type === 'ready') { stopCooking(); return; }
    cook.done = [...new Set([...cook.done, index])];
    cook.rang = cook.rang.filter(i => i !== index);
    persistCooking();
    renderCook(Date.now());
  };

  const applyNativeEvent = ev => {
    if (ev.type === 'alarm-done') nativeDone(ev.id);
    else if (ev.type === 'alarm-stop') stopAlarm();
    else if (ev.type === 'heads-onit') setHeads(stepOf(ev.id), 'onit');
    else if (ev.type === 'heads-ignore') setHeads(stepOf(ev.id), 'ignored');
  };

  // Taps made while the page was closed wait in a queue on the phone.
  const takeNativeEvents = () => nativeAlarms.takePending().then(r => (r.events ?? []).forEach(applyNativeEvent)).catch(() => {});

  nativeAlarms.addListener('alarmEvent', takeNativeEvents);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') takeNativeEvents(); });
  takeNativeEvents();
  setInterval(syncAlarms, 1000);
}
