# DinnerSync

## Where we are
- Current step: Build & Test — v1.1.8 live, all merged to the default branch
- Last session: 2026-10-16/17 — cooking card polish, phone back keeps cooking, locked-phone alarms (silent loop + ring), logo/version header, timer rings, repeating notifications
- Next action: finish v1. Locked-phone alarm still fails in v1.1.8 (beep fine unlocked). Try trick A (pre-schedule the beeps in Web Audio at cooking start), else v1 says "keep screen on" and the Android app fixes it.

## Ideas for next chat (Darren, 2026-10-17)
1. ~~Check the phone test~~ done 2026-10-17: v1.1.8 beep is perfect unlocked, silent when locked.
2. **Choose the alarm tone**: a few built-in tones (beeps, chimes, kitchen bell) with ▶ preview; beep-beep-beep stays the default.
3. **Use your own sound**: pick a sound file from the phone (MP3 etc.), saved in the app, used for the alarm.
4. ~~Phone setting tip~~ dropped: v1.1.8 uses no notifications.
5. **Real Android app (option 3)**, once all the above works well: uses the phone's own alarm system and ringtone list; alarms work even when the app is swiped closed.
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
- 2026-10-17: v1.1.5 — notification repeats every 10s, Done ✓ button on it. 55 tests + browser check pass.
- 2026-10-16: v1.1.1–v1.1.4 — Done at bottom + bar beside it; phone back keeps cooking; silent keep-alive loop; logo/version header (fits Z Fold cover); network-first SW; phone ring alarm through keep-alive; timer rings. All by Haiku first try, tests written first.
- 2026-10-16: Done moved to bottom of card; tap ✓ to undo a step; done steps no longer beep. 49 tests + browser check pass.
- 2026-10-16: Mock v2 built by Haiku first try (tests written first). 46 unit tests + browser check pass. Small CSS polish after (spacing, ring glow, wrap on narrow phones). Known gaps: "X min spare" is lost on reload mid-cook; timer beeps once at 0, not on repeat.
- 2026-10-16: Added stages (hob/oven/rest + labels), hr/min inputs, saved dropdown with ×, step progress list, Reset with confirm. 32 tests pass. Live on GitHub Pages.
- 2026-10-16: V1 built by Haiku first try. 15/15 unit tests + browser check pass. Test build: https://claude.ai/artifact/VG2ApJkyFmTfVxKC2ut3qg
- Not yet tested on a real phone: sound, vibrate, notifications, screen-on

## Change log
- 2026-10-17: Ideas for next chat saved (tone picker, own sound, real Android app)
- 2026-10-16: Mock v2 agreed (tiles, timer, egg-style cooking screen); saved to docs/mock-v2.html
- 2026-10-16: Project file created from brain dump; icon added
- 2026-10-16: Dark look chosen; V1 built and tests passing
- 2026-10-16: Destination set to working app; web app chosen over widget
