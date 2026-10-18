# DinnerSync

## Where we are
- Current step: Build & Test. v1.3.4 = mockup 6 built, + Slow cook, + one-oven auto temp (decision 6 applied) (not yet tried on the phone).
- Last session: 2026-10-18 (Sonnet): built the whole mockup 6 list, tests first. 102 unit tests + browser check pass. Screenshot at 400px matches the mock.
- Next action: Darren tries v1.3.4 on the phone (build a meal, save it, run the timers). Then fix what feels wrong.
- Avoid: deleting the Simple timer / When's dinner code. It is hidden by `SHOW_LEGACY_TOOLS = false` in js/app.js.
- Open questions (defaults used, tell me to change): Prep label stays "Prep" (not "Hands-on"). Prep-first is ON by default. In a built dish the parts all finish exactly when the finish starts (not kept hot).
- Known gaps: Old saved items from before v1.3.0 are not shown (new Saved items list). No delete button for saved items/meals yet. Old CSS for the removed add-item form is still in style.css.
- Then: locked-phone alarm trick A (pre-schedule beeps in Web Audio), else real Android app.

## Next build (mockup 6): DONE in v1.3.0
(list kept below for reference)
Target: docs/mock-v6-meals.html. Its script holds the working scheduling logic (`schedule()`), reuse the ideas.
1. **Hide** the Simple timer and the When's dinner toggle (keep the code, behind a flag). App opens straight on "What are you cooking?" under the existing header (logo, DinnerSync v1.x, tagline, Reset, time).
2. **Meal card:** meal name box + "Saved meals ▾" dropdown (right third). Under it the switch "Cook some together first".
3. **Built dish card** (shown when the switch is on): dish name; "1 · Cook these first" = items side by side, all done together; "↓ when they're all done"; "2 · Then finish" = steps one after another. "+ Another built dish" allowed.
4. **Everything else card** ("Items" when the switch is off): type an item + Enter, or "Saved items ▾". Everything here is timed to be ready at dinner, same time as the built dish.
5. **Item = named steps.** Each step: type tag (Prep / Hob / Oven / Rest), editable name ("Peel potatoes"), − time + (5 min), oven − temp + (10°), ✕ remove, optional reminder ("↻ Turn potatoes after 30 min" = its own alarm). "+ Prep / + Hob / + Oven / + Rest" add a step and put the cursor in its name. Item row shows total time + a coloured bar of its steps; tap to open.
6. **Auto-save:** any change to an item's steps saves it to Saved items straight away (no Save button). "Save as a meal" saves the meal, its built dishes and items.
7. **Shared first step, automatic:** if two items in the meal start with the same prep step name (e.g. "Peel potatoes"), do it once: times add, label "all of it, keep in cold water". No question asked. Later steps (the boils) stay separate, each at its own time.
8. **Timer sequence:** "Do all the prep first" switch at the top (default on). On = the prep steps at the START of each item go into a "🥄 Prep block" one after another, then "🔥 Now cook"; prep after cooking (mash, build pie) stays put. Show how much time it adds.
9. **When's it ready** card at the bottom: Start now / Ready later (15 min a tap), total time, "Start timers".
10. Oven clash: if two oven steps at different temps overlap, show a warning on the timer sequence (decision 6 scaling still to reconcile).
11. Starter saved data: Roast potatoes (peel 15, boil 25, rest 30, oven 55 @200 with turn at 30), Roast chicken, Gammon joint, Carrots, Peas, Gravy, Yorkshire puddings, Mince, Mash. Meals: Shepherd's pie & roasties, Shepherd's pie, Chicken dinner, Gammon dinner.

## Ideas for next chat (Darren, 2026-10-17)
1. ~~Check the phone test~~ done 2026-10-17: v1.1.8 beep is perfect unlocked, silent when locked.
2. **Choose the alarm tone**: a few built-in tones (beeps, chimes, kitchen bell) with ▶ preview; beep-beep-beep stays the default.
3. **Use your own sound**: pick a sound file from the phone (MP3 etc.), saved in the app, used for the alarm.
4. ~~Phone setting tip~~ dropped: v1.1.8 uses no notifications.
5. **Real Android app (option 3)**, once all the above works well: uses the phone's own alarm system and ringtone list; alarms work even when the app is swiped closed. **Job #1: alarms that ring reliably when the phone is locked** (the installed web app can't; Darren hit this 2026-10-18).
   - **PARKED 2026-10-18** (Darren: "put the mobile app to one side but keep the plan"). Do not build until he says.
   - Plan: (1) tests + short spec written in the web chat; (2) a new chat builds the app against them; (3) back here to review; (4) GitHub builds the APK, Darren downloads it on his phone (allow "install unknown apps" once, tap Install). New APK installs over the old one, data kept.
   - Tests cover timing logic only; the locked-phone ring must be tested on the real phone.
   - **Build brief written 2026-10-18: docs/android-brief.md** (Capacitor + native alarm plugin, tests first, APK from GitHub Actions). Defaults: phone alarm tone, sits alongside web app.
   - Still to decide: alarm sound (phone's alarm tone vs our beep; leaning phone's tone), replace the web app or sit alongside it (leaning alongside while testing).
   - **Release to /live: set `PREFIX` in `store.js` back to `'dinnersync.'`** (demo uses `'dinnersync.demo.'` so demo and live don't share data).
   - Settings now has hobType, hobMax, ovenType (store.js). Hob/oven type are labels only for now (no gas-mark conversion).
- Known gap: "X min spare" is lost on reload mid-cook.

## Principles / constraints
- Tagline: "everything finishes together"
- Icon: assets/icon.png (paper-cut clock over roast on a tray)

## 1. Idea
- Who: Darren (home cook)
- Problem: juggling items with different cook times/temps so they all finish together
- Destination: a fully working phone app (web app on home screen), not just a plan
- In scope (brain dump):
  - Set when dinner should be ready (e.g. in 1h30)
  - Add items with cook time + temp (chicken, roast potatoes, veg)
  - App tells me when each item goes in
  - App tells me oven temp, and when to change it
  - Phone makes a noise: "put X in, set oven to Y"
  - Checks if there's enough time before the ready time
- Out of scope:
- Missing info:

## 2. Steps

## 3. Choose & Prove

## 4. Fine Detail

## Decisions
| # | Decision | Why | Date |
|---|----------|-----|------|
| 1 | Destination = working app, not just a plan | Darren wants to use it | 2026-10-16 |
| 2 | Web app added to home screen, not a native widget | Widgets need native iOS/Android code; much harder | 2026-10-16 |
| 4 | Android first; install as web app | Darren's phone | 2026-10-16 |
| 5 | Screen stays on while cooking (wake lock) + sound, vibrate and notification | Web apps can't reliably alarm when phone is locked; no server needed | 2026-10-16 |
| 6 | Oven set to main item's temp (longest cook = main). Others' times scaled: new time = time × their temp ÷ oven temp | Darren: "if it's cooked it's cooked" | 2026-10-16 |
| 7 | Preheat 15 min (editable) counted in the time check | Oven must be hot before first item | 2026-10-16 |
| 8 | Not enough time → say so and show earliest ready time | Darren's 'enough time' need | 2026-10-16 |
| 9 | Save on the phone (local storage, no account): saved items + last dinner | Darren wants a local db | 2026-10-16 |
| 10 | Cooking screen shows live countdowns: preheat, main meal (to dinner), next item | Darren | 2026-10-16 |
| 11 | Look: "Dark kitchen" for now; revisit after it works | Darren: operations first | 2026-10-16 |
| 12 | Silent sound loops while cooking so alarms still fire when the phone is locked (not if the app is swiped closed) | Cheapest fix for locked-phone alarms | 2026-10-16 |
| 13 | Phone back button on the cook screen goes to the plan; cooking, timers and alarms carry on; orange bar to return | Darren | 2026-10-16 |
| 14 | Logo (home button) left of title, version right of title; version = offline cache name, bump both together | See which version the phone runs | 2026-10-16 |
| 15 | Service worker network-first (online = newest files; offline = saved copy) | Phone showed new page with old styles | 2026-10-16 |
| 16 | Alarm = phone-style ring through the already-playing keep-alive audio; kitchen timer rings too | A new sound can't start on a locked phone | 2026-10-16 |
| 17 | Alarm notification repeats every 10s until Done, with a Done ✓ button | Darren | 2026-10-17 |
| 18 | Keep-alive loop is a faint 30 Hz hum (~-60 dBFS), not perfect silence | Chrome may still pause a tab whose sound is pure silence | 2026-10-17 |
| 19 | Alarm = the app's own beep-beep-beep looped until Done; no notifications, no phone ring (replaces 16, 17) | Ring felt like ringing himself; Android spaced notification sounds ~8 s apart | 2026-10-17 |
| 20 | Finish v1 (web) first, then build the real Android app | Locked-phone alarms aren't reliable in a web app | 2026-10-17 |
| 21 | Cook now button (dinner = earliest ready from now) in the dinner panel; current time under Reset on every screen | Darren | 2026-10-17 |
| 22 | Add-item card: − / + buttons for time (5 min a tap, 30 for slow cook) and temp (10°); no number keyboard. ✓ beside text boxes closes the keyboard; Saved small on the heading line | Darren: keyboard took half the screen | 2026-10-17 |
| 23 | Slow cook method: Low/High, starts at 4 hr, not part of the oven temp | Darren | 2026-10-17 |
| 24 | "+ Same time": stages in one group run side by side (tracks), stacked as cards in a dashed box; all tracks finish together, then the next group. New 🥄 Prep type (no heat) | Darren: mince pie (fry mince ‖ boil+mash, then build, then oven) | 2026-10-17 |
| 25 | Dish form = 3 fixed sections (Get ready, Cook lines side by side, Finish); Start now / Ready later (15 min a tap); cooking screen = one timer per job on the go + next alarm, big current card removed (replaces 24's form) | Darren's mockup 5 | 2026-10-17 |
| 26 | Simple timer and When's dinner toggle hidden for now (code kept); app starts at "What are you cooking?" | Darren: focus while we build | 2026-10-18 |
| 27 | Saved meals + saved items on the phone; an item is a list of named steps; edits auto-save | Darren: must be quick, or most won't use it | 2026-10-18 |
| 28 | "Cook some together first" switch under the meal name; built dish = parts side by side, then finish steps; everything else ready at the same time (replaces 25's 3 sections) | Shepherd's pie with roasties | 2026-10-18 |
| 29 | Same first prep step in two items = done once, times added, automatic (no question) | One peel for mash + roasties; Darren: the question didn't make sense | 2026-10-18 |
| 30 | Shared boils stay separate (roasties boil early, mash late) | Different times in the plan and different boil lengths | 2026-10-18 |
| 31 | "Do all the prep first" lives on the timer sequence only, default on, shows the extra time | Simpler; one pair of hands | 2026-10-18 |
| 3 | Skip a wayfinder map; small enough for one session | Little fog | 2026-10-16 |

## Parked (this version, not now)

## Research

## Prototypes / tests
- Mockup v1: https://claude.ai/artifact/Gi6sBQpME7pXr7LztSDcMc (look rejected, flow OK)

## Risks
- Items needing different temps at the same time in one oven
- Phone alarms when screen is locked or app is closed (web apps are limited)

## Later / V2
- Once everything works well: make it a real Android app (APK) using the phone's own alarm system, so alarms work even when the app is closed (Darren, 2026-10-16)

## Next build (from mock v2: docs/mock-v2.html, also https://claude.ai/artifact/1tJQUZWz9QuZA2HyFtKTkv)
1. Plan screen top: two equal tiles "🍽 When's dinner" (shows 7:44pm) and "⏳ Timer" (shows remaining). Tap opens a panel with slide animation; one open at a time; tap again closes.
2. When's dinner panel: one line "Ready in [h] hr [m] min or at [time]" + "Dinner at 7:44pm" below.
3. Timer panel: countdown only (no stopwatch). Big digits in a glowing ring that empties, label "Remaining", +1/+5/+10 min buttons, Start/Pause, Reset back to 0:00. Beep + vibrate at 0. Hide the Add-an-item card (and rest of plan) while Timer is open.
4. Reset (top right) smaller with margin, not touching the title.
5. Cooking screen: only "Dinner in" countdown at top. Remove big countdown, preheat card and the big Done button.
6. Current step card grows ("snake swallowing an egg"): holds the countdown to the next step + progress bar that SHRINKS as time runs out + "until: next step". Small NOW (due) / NEXT (not due yet) badge top right, small, 6px corners.
7. Small green "Done ✓" button right next to the countdown in the current card (6px corners). Done early = step ticked, next card shows "✓ Done early, X min spare before this" and counts down to its start. Times never shift — everything still finishes together.

## PRD

## Tickets

## Build / test progress
- 2026-10-18: v1.3.0 — mockup 6 built by Sonnet (tests first). New js/meal.js (scheduling, shared peel, prep block, oven clash), js/builder.js (meal screen), saved items/meals in store. Reminders get their own alarm. 102 tests + browser check pass.
- 2026-10-17: v1.2.0 — mockup 5 built by Haiku (tests first); one test timing fix + draft/soonest fix by me. 78 tests + browser check pass.
- 2026-10-17: v1.1.5 — notification repeats every 10s, Done ✓ button on it. 55 tests + browser check pass.
- 2026-10-16: v1.1.1–v1.1.4 — Done at bottom + bar beside it; phone back keeps cooking; silent keep-alive loop; logo/version header (fits Z Fold cover); network-first SW; phone ring alarm through keep-alive; timer rings. All by Haiku first try, tests written first.
- 2026-10-16: Done moved to bottom of card; tap ✓ to undo a step; done steps no longer beep. 49 tests + browser check pass.
- 2026-10-16: Mock v2 built by Haiku first try (tests written first). 46 unit tests + browser check pass. Small CSS polish after (spacing, ring glow, wrap on narrow phones). Known gaps: "X min spare" is lost on reload mid-cook; timer beeps once at 0, not on repeat.
- 2026-10-16: Added stages (hob/oven/rest + labels), hr/min inputs, saved dropdown with ×, step progress list, Reset with confirm. 32 tests pass. Live on GitHub Pages.
- 2026-10-16: V1 built by Haiku first try. 15/15 unit tests + browser check pass. Test build: https://claude.ai/artifact/VG2ApJkyFmTfVxKC2ut3qg
- Not yet tested on a real phone: sound, vibrate, notifications, screen-on

## Change log
- 2026-10-18: Android app built (Sonnet): Capacitor wrapper of /live + Kotlin alarm plugin (AlarmManager.setAlarmClock, alarm tone, full-screen Stop/Done, heads-up On it/Ignore). Tests first: tests/alarmlist.test.js + androidsync.test.js (123 pass). GitHub Action `Android APK` builds it; newest APK on the `android-beta` release. Package com.dfailab.dinnersync.beta (sits alongside the web app). Native Done ticks the step; web app untouched (the app's copy is patched by scripts/sync-web.mjs). Not yet tried on the phone.
- 2026-10-18: Android build brief saved to docs/android-brief.md, ready for a new Sonnet chat (app still parked until Darren says go).
- 2026-10-18: Released v1.3.19 to /live: current step shown once, edit pencil on running jobs, upcoming steps and older plans.
- 2026-10-18: Released v1.3.16 to /live: Done/Undo in line, edit a step's name (saves to the saved item), next alarm inside the current card, only the current card rings.
- 2026-10-18: Demo v1.3.16: only the CURRENT card rings (first step not ticked Done); other steps stay silent until they become current. Darren chose this over keeping everything ringing. Watch: parallel jobs (e.g. veg starting while potatoes roast) won't ring until the earlier card is Done.
- 2026-10-18: Released v1.3.11 to /live (gear lined up with Reset).
- 2026-10-18: Released v1.3.27 to /live: heads-up (30 sec / 1 min) with On it / Ignore, looping phone notifications, Stop alarm, keyboard only opens on tap, rename keeps typed text. Live keeps storage prefix 'dinnersync.'.
- 2026-10-18: Demo v1.3.26: keyboard only opens when you tap a box (no auto-focus on new step, rename, edit or after adding an item). Carry into live with the next release.
- 2026-10-18: Demo v1.3.25: heads-up (30 sec / 1 min before a step, current step only) with On it / Ignore; phone notifications that repeat every 10 s until Stop alarm or Done (only while the app is out of sight); Stop alarm button; settings for both. Not in live yet. Limit: a long-locked phone can freeze the page, so repeats stop (Android app job).
- 2026-10-18: Released v1.3.24 to /live: hob water + heat dial, rename items, item in bold with description under it, minutes under the time, Settings (hob/oven), Slow label, one-line rows, backup load adds. Live keeps storage prefix 'dinnersync.'.
- 2026-10-18: Demo v1.3.23: hob steps have water (Cold/Luke/Hot, tap the pill) and a heat dial number; item names can be renamed with ✎ (saved items and meals follow); the cook card shows the item in bold plus chips (water, hob, oven type, minutes); Settings has hob type, dial max, oven type, preheat. Not in live yet.
- 2026-10-18: Released v1.3.10 to /live: settings gear, backup file save/load, edit/delete saved meals and items, clean-slate start (no starter items). Next: keep building in /demo and /live, then a bigger update to the Android app.
- 2026-10-18: Demo has a ⚙️ settings gear with Backup: save/load a JSON file of meals and items (load replaces exactly, with a confirm). Same file will carry data to the Android app. Android job #1 noted: locked-phone alarms.
- 2026-10-18: v1.3.0 built from the mockup 6 list
- 2026-10-18: Mockup 6 agreed (meals, items with named steps, built dishes, shared peel, prep first); saved to docs/mock-v6-meals.html; Next build rewritten
- 2026-10-17: Ideas for next chat saved (tone picker, own sound, real Android app)
- 2026-10-16: Mock v2 agreed (tiles, timer, egg-style cooking screen); saved to docs/mock-v2.html
- 2026-10-16: Project file created from brain dump; icon added
- 2026-10-16: Dark look chosen; V1 built and tests passing
- 2026-10-16: Destination set to working app; web app chosen over widget
- 2026-10-18: v1.3.3 — one oven: overlapping oven steps at different temps; the longest keeps its temp, the others move to it with time x their temp / oven temp (decision 6). Slow cook step type back (v1.3.2).
- 2026-10-18: /live = the stable app to install on the phone (https://df-ai-lab.github.io/DinnerSync/live/), a frozen copy in live/. The root (…/DinnerSync/) is the NEXT version we change. To release: copy index.html css js assets icons manifest.webmanifest sw.js from root into live/, then change CACHE in live/sw.js to 'dinnersync-live-vX' (keep the startsWith('dinnersync-live-') filter). Both share the phone's saved data (same site).
- 2026-10-18: /demo = the copy we change and try (https://df-ai-lab.github.io/DinnerSync/demo/). /live stays untouched until we release. Same saved data as /live (same site).
