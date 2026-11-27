# The design gauntlet

The automated half of the gauntlet in `docs/design/HANDOFF.md` ("Acceptance: the design gauntlet"). Run it before calling a component done:

```sh
vp run gauntlet                       # the whole suite, headless, no traces (~25 s)
vp run gauntlet --grep "Waiting"      # only the tests whose title matches
```

It starts `vp dev` itself, on a port between 5180 and 5279 picked from the checkout's path, so parallel worktrees never share a server; if a server already answers on that port it reuses it. Set `GAUNTLET_PORT` to run against a `vp dev --port <n>` you started, and `GAUNTLET_CHROMIUM` to point at a different Chromium; by default it uses Playwright's own at `/opt/pw-browsers/chromium`. `@playwright/test` is pinned to the installed Playwright's version, so the two always match.

The by-hand checks (glance, tone, side by side with Discord) stay by hand.

## What runs

| File                  | What it checks                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `screens.gauntlet.ts` | Every check below, on every screen in `harness/screens.ts`, in light and dark, at 390×844 and 1280×800, with reduced motion on                                      |
| `leak.gauntlet.ts`    | Gauntlet 2, the leak test, for the Spectrum and Middle Ground before the reveal, plus a control that proves the probes still see what a Host who isn't Playing sees |
| `checks.gauntlet.ts`  | The checks themselves: each must flag a planted violation and pass a good fixture                                                                                   |

The per-screen checks (`harness/checks.ts`, run by `harness/gauntlet.ts`):

| Check            | Rule                    | Passes when                                                                                                                                                      |
| ---------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contrast`       | Gauntlet 3, hard rule 5 | axe's WCAG AA `color-contrast` finds nothing, in each theme                                                                                                      |
| `spark`          | Gauntlet 6, hard rule 2 | Nothing resolves to `--primary` (colour, background, border, outline, shadow, fill, stroke, accent) unless it matches `spark-allowlist.ts`                       |
| `focus`          | Gauntlet 4, hard rule 5 | Tabbing from the top visits stops in DOM order, and each shows a 3px solid `--focus` ring offset 2px                                                             |
| `reduced motion` | Gauntlet 5, hard rule 6 | No `<animate>`, `<animateMotion>`, `<animateTransform>` or `<set>`, and no CSS animation running                                                                 |
| `flat`           | Hard rule 7             | No gradients, blur or backdrop filters                                                                                                                           |
| `choices`        | Hard rule 8             | Every radio and checkbox sits on the same line as its label, at most 16px before its first letter                                                                |
| `targets`        | Gauntlet 4, hard rule 5 | Every visible control is at least 44×44px (a wrapping `<label>` counts)                                                                                          |
| `names`          | Gauntlet 1, hard rule 3 | Every name label is one line, `white-space: nowrap`, cut only with an ellipsis, has the full name in `title` and its accessible name, and overlaps no other name |
| `tags`           | Tag.md, hard rule 5     | Every tag sits on `ground`, `surface` or `raised`, and its fill, border or outline differs from that ground, so it reads as a pill                               |

The crowd test (gauntlet 1) is two of the screens: `crowd()` gives a Waiting Room of 15 Participants with 20-character names, and `crowdOnOneNotch()` puts all of them on one Spectrum notch and reveals.

## Scoping: what isn't redesigned yet

Some checks fail on parts of the app the redesign hasn't reached (old 28px link buttons, names that wrap letter by letter, the Spectrum track's gradient). Those checks are never skipped. Instead, each screen lists in `redesignedOnly` the checks its old parts still fail, and on that screen those checks look only at the **redesigned elements**: anything matching a selector in `redesigned.ts`, or inside one, or carrying a `data-redesigned` attribute. Everything else runs on the whole page.

So on `main` today, contrast, spark, focus, reduced motion, flat and choices hold on every screen except flat on the two Spectrum screens. Targets hold on Home, Join, the visitor's Planning screen and taking back Host control; elsewhere (old `<summary>`s and checkboxes) targets and names run on the redesigned parts only, which include every button, tag, timer and field.

## Adding a component's checks

In the same PR as the component:

1. **Mark what you redesigned.** Add its selectors to `REDESIGNED` in `redesigned.ts`, with your issue number. For example, the Button issue would add `{ selector: "button", issue: "#55" }`, and the Tag issue `{ selector: ".tag", issue: "#56" }`. Or put `data-redesigned` on the component's root. From then on `targets`, `names` and anything else scoped run on it everywhere it appears.
2. **Widen the checks.** When a check passes on a whole screen, delete it from that screen's `redesignedOnly` in `harness/screens.ts`. Never add a check there to get a redesigned element through: fix the element.
3. **Add your screens.** If the component shows up on a screen or state the list doesn't cover yet (a revealed Spectrum, a Surrounded Exchange, an open menu), add a `Screen` to `SCREENS`. Set it up with the helpers below, return the names it shows, and start `redesignedOnly` with whatever its old parts fail.
4. **Allow the spark only for "your move".** If the component legitimately uses `--primary` (the one primary action, whoever has the Floor, your own notch, the Live and Revealed pills), add its selector to `spark-allowlist.ts` and name the job in `why`.
5. **Add checks of your own** for what the generic ones can't see (e.g. seven Moods on one row at 390px). Put the check in `harness/checks.ts` as a function that returns a list of violation strings, give it a fixture test in `checks.gauntlet.ts` that plants a violation and a pass, and either add it to `CHECKS` in `harness/gauntlet.ts` (every screen) or call it from a new `*.gauntlet.ts` file.

Never use `test.skip`, `test.fixme` or `test.fail` in this suite.

## Helpers

Rooms are set up from the test process, not by clicking: `harness/room.ts` connects WebSocket "bots" that speak the Room protocol, and `harness/browser.ts` opens a page as one of them.

| Helper                                                                                              | Does                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createRoom(baseURL, { hostNickname, participantLimit, open })`                                     | Creates a Room as its Host (Live unless `open: false`); returns a `TestRoom` with `host` as a bot                    |
| `join(room, names, as?)`                                                                            | Joins one Participant (or `"spectator"`) per name; returns their bots                                                |
| `planRound(room, setup, prompts)`                                                                   | Adds a Round to the Lineup                                                                                           |
| `startRound(room, { format: "spectrum" \| "middle-ground" \| "surrounded", ... }, { hostPlaying })` | Plans and starts a Round; waits until everyone sees it                                                               |
| `longNames(n)`, `crowd(baseURL)`, `crowdOnOneNotch(baseURL)`                                        | The crowd test's names and Rooms                                                                                     |
| `bot.act(intent, until)`, `bot.until(predicate)`                                                    | Sends any intent from `src/room/room.ts` as that person and waits for the view it leads to                           |
| `openHome(page)`, `openRoom(page, room, "host" \| "visitor" \| bot)`                                | Opens the page as that person (same device token, so the Room sees the same person)                                  |
| `setTheme(page, "light" \| "dark")`                                                                 | Sets `data-theme` on `<html>` and the OS preference                                                                  |
| `setReducedMotion(page, true)`                                                                      | Turns `prefers-reduced-motion: reduce` on                                                                            |
| `leak(page, secrets)`, `perceivable(page, roomId)` + `sameView(a, b)`                               | The leak test's two probes: hidden values anywhere in the DOM or accessibility tree, and two views that should match |

Close the Room (`room.close()`) at the end of the test, in a `finally`.
