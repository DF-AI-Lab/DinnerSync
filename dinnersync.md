# DinnerSync

## Where we are
- Current step: 1. Idea (lite mode)
- Last session: 2026-10-16 — idea + icon received
- Next action: Darren says go → write tests, then build

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
| 3 | Skip a wayfinder map; small enough for one session | Little fog | 2026-10-16 |

## Parked (this version, not now)

## Research

## Prototypes / tests

## Risks
- Items needing different temps at the same time in one oven
- Phone alarms when screen is locked or app is closed (web apps are limited)

## Later / V2

## PRD

## Tickets

## Build / test progress

## Change log
- 2026-10-16: Project file created from brain dump; icon added
- 2026-10-16: Destination set to working app; web app chosen over widget
