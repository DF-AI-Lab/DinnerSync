# DinnerSync Android app: build brief

For the Sonnet build chat. Read this, then `dinnersync.md` (decisions) and `js/` (the logic to reuse).

## Goal
Same app as the web version, but **alarms ring reliably with the phone locked or the app closed**. That is job #1. Everything else is a copy of the web app.

## Approach (decided)
- **Wrap the existing web app with Capacitor** (WebView). Do not rewrite the UI.
- Web files = a copy of `live/` (or `demo/` when told). No build step needed for the web part.
- One small **native Kotlin plugin** schedules alarms with Android `AlarmManager.setAlarmClock()` (exact, survives Doze and app close).
- On ring: play the phone's alarm tone (`RingtoneManager.TYPE_ALARM`) on the alarm audio stream, vibrate, show a full-screen notification with **Stop alarm** and **Done** buttons. Loops until Stop or Done.
- Heads-up (30 sec / 1 min before): a normal notification with **On it** / **Ignore**.
- Package id: `com.dfailab.dinnersync.beta` so it installs **alongside** the web app (nothing is replaced while testing).
- Data: the same localStorage (`dinnersync.` keys) inside the WebView. Backup file (Settings > Backup) moves data from the web app to the app.

## How the web code talks to the plugin
The page already knows the plan. When Start cooking runs, and whenever the plan changes (Done, Undo, edit), call:

```js
DinnerAlarms.schedule([{ id, at /* ms epoch */, title, body, headsUpAt /* ms or null */ }])
DinnerAlarms.cancelAll()
```

- Only the **current step** rings (existing rule), but schedule the current one plus the next so a Done tap on the lock screen can promote it.
- Native "Done" / "On it" taps send an event back to the page (`alarm-done`, `alarm-stop`, `heads-onit`, `heads-ignore`). These are the same message names the service worker already uses. Reuse the handlers in `js/app.js`.
- If the plugin is missing (running in a normal browser), do nothing: the web version keeps working.

## Permissions to ask (once, with a plain explanation)
- Notifications (Android 13+)
- Exact alarms (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`)
- Full-screen intent
- Ignore battery optimisation (offer, do not force)

## Tests first (written before code)
Pure logic, runs with `npm test` (node:test), no phone needed:
1. `buildAlarmList(plan, cookState, settings, now)` returns the right ring times: current step only, plus next; skips steps marked "On it"; honours headsUp off/30/60.
2. Done on the current step moves the list on to the next step.
3. Undo brings the previous step back.
4. Changing the plan cancels old ids and schedules new ones (no duplicates).
5. Existing 104 tests still pass.

**Not testable here, check on the real phone:** locked-phone ring, swipe-closed ring, Stop/Done from the lock screen, tone loop, battery saver behaviour.

## Build and delivery
- GitHub Actions workflow builds a debug **APK** on every merge to the build branch and uploads it as an artifact / release asset.
- Darren downloads the APK on his phone, allows "install unknown apps" once, taps Install. A newer APK installs over the old one and keeps data (same signing key: use one fixed debug keystore stored in the repo's Actions secrets, never in the code).
- Version in the app header must match the APK version.

## Out of scope for now
Play Store, iPhone, tone picker, gas-mark conversion, user accounts.

## Workflow rules (same as the web app)
- Build and try first; Darren tests on his phone.
- Short, well-spaced replies (Darren has ADHD, keep text light).
- Make a PR and merge it each time so he can see it.
- Keep `dinnersync.md` change log up to date.

## Open choices (defaults chosen, Darren can change)
- Alarm sound: **phone's alarm tone** (default). Our beep stays in the web version.
- App sits **alongside** the web app while testing.
