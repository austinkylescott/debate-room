# Debate Room · design handoff for implementation

You are implementing the Debate Room visual design in the existing Vue 3 app (`austinkylescott/debate-room`), using the UI SDK already set up in this project for behaviour: headless primitives for dialogs, popovers, menus, listboxes, radio groups, toggles and toasts. The design is defined as **tokens + component specs + states**. The SDK supplies behaviour and accessibility wiring; this package supplies every visual decision.

The domain language is in the repo's `GLOSSARY.md` (Room, Round, Prompt, Stage, the Floor, Lineup, Waiting Room, Host, Co-Host, Participant, Spectator, Playing, Center, Challenger, Chair, Exchange, Side). Use those words in UI copy and code. Don't introduce lobby, game, player or moderator.

## What's in this package

| File | What it is | Treat as |
|---|---|---|
| `HANDOFF.md` | This brief: build order, rules, acceptance | Instructions |
| `design-system.md` | The brand book: look, shape rules, colour rules, orbit language, motion, gauntlet | Source of truth for intent |
| `tokens.json` / `tokens.css` | Every colour (dark + light), type style, spacing, radius, shadow | Source of truth for values. Never hard-code a colour. |
| `components.css` | Reference CSS for every core component and state (`dr-` classes) | Port into the components (scoped styles or a global layer) |
| `components/*.md` | Per-component spec: anatomy, states, a11y, what the consumer provides | Acceptance criteria per component |
| `shapes.ts` | The Atomic shape vocabulary as SVG path data, plus helpers | Import directly |
| `previews/*.html` | Standalone pages showing each component in every state (theme toggle top-right) | Visual reference: open in a browser |
| `reference/*.png` | Screenshots of each preview, light and dark | Visual reference |

## Status: what is designed and what isn't

- **Designed and approved:** the tokens, the nine core components (Button, Tag, Electron, Mood, Timer, Field, Menu, Toast, Card) and the **Spectrum Stage after the reveal** (`AtomicStage`).
- **Directional only:** `AtomicOrbitLanguage` sketches how the orbit metaphor applies to the Waiting Room, Middle Ground, Surrounded, the Floor, the Mood Check-in, the Lineup, menus and the Recap. If you build those, follow the sketch and mark them for design review. Don't invent a different visual language.
- **Not designed yet:** the full screens (Home, Planning, Waiting Room, Middle Ground and Surrounded Stages, the pre-reveal Spectrum, Recap) and the laptop (1280px) layout. Restyle those screens with the core components and tokens, keep their current structure, and leave layout redesign for later.

## Setup

1. **Fonts:** Righteous (display) and Jost 400–700 (body), from Google Fonts or self-hosted:
   `https://fonts.googleapis.com/css2?family=Righteous&family=Jost:wght@400;500;600;700&display=swap`
2. **Tokens:** load `tokens.css` globally, replacing the current variables in `src/style.css`. Dark is the default theme. `[data-theme="light"]` and `[data-theme="dark"]` on `<html>` override the OS preference; without either, `prefers-color-scheme` decides.
3. **Components:** port `components.css` rules into the matching components. Keep the token references. You may rename classes to fit the SDK's styling approach, but keep the state hooks: native attributes first (`[disabled]`, `[aria-pressed]`, `[aria-invalid]`, `[aria-selected]`, `[aria-expanded]`), then `is-*` classes for app state.

## Build order and mapping

| # | Component | Spec | Headless primitive | Existing files to restyle |
|---|---|---|---|---|
| 1 | Tokens and theme | `tokens.css` | none | `src/style.css`, `App.vue` |
| 2 | Button | `components/Button.md` | Button | everywhere |
| 3 | Tag | `components/Tag.md` | none | `RoundCard`, `LineupPreview`, `PromptPicker`, `WaitingRoomList` |
| 4 | Field and Choice | `components/Field.md` | Text field, RadioGroup | `NicknameField`, `PinField`, `HostPinForm`, `ParticipantLimitField`, `CopyField`, the join form |
| 5 | Card | `components/Card.md` | none (button or link when interactive) | `RoundCard`, `InviteCard`, `PromptPicker`, `LineupEditor` |
| 6 | Menu and Select | `components/Menu.md` | Select/Listbox, DropdownMenu; bottom sheet (Dialog) under 420px | `FloorPanel` speaking-timer select, `WaitingRoomList` person actions |
| 7 | Toast and Notice | `components/Toast.md` | Toast (live region) | new: join/leave, saved, moved to Spectators, reconnecting |
| 8 | Electron | `components/Electron.md` | none (button when actionable) | `WaitingRoomList`, all three Stages |
| 9 | Mood | `components/Mood.md` | ToggleGroup (single) | `MoodPanel`, `RecapMoods` |
| 10 | Timer | `components/Timer.md` | none (`role="timer"`) | `FloorPanel`, Surrounded Exchange timer, Mood Check-in |
| 11 | Spectrum Stage (revealed) | `components/AtomicStage.md` + the spec below | none | `SpectrumStage.vue`, `FloorPanel.vue` |
| 12 | Other Formats | `components/AtomicOrbitLanguage.md` | none | `MiddleGroundStage`, `SurroundedStage`. Mark for review. |

## Hard rules: don't break these

1. **Tokens only.** No raw hex, rgb or named colours in components. Text on a coloured shape uses that shape's `on-` token (`on-primary`, `on-teal`, `on-agree`, `on-disagree`). Fill-only tokens (`mustard`, `teal`, `avocado`, `pink`, `sky`) never colour text.
2. **Spark orange (`primary`) means "your move" only:** the screen's one primary action (Raise hand, Lock in, Start Round), whoever has the Floor, your own notch, and the Live and Revealed status pills. Selection, success and locked-in states use `mustard` or `ink`. Errors and destructive actions use `spicy`, outlined. Disagree is shown in cool `disagree`, never red.
3. **Names never break letter by letter.** Use one line, `white-space: nowrap`, and an ellipsis. Put the full name in `title` and the accessible name. Notch labels wrap only at spaces (`overflow-wrap: normal; hyphens: none`). This fixes current bugs.
4. **Hidden information.** Before a reveal, someone Playing must not be able to infer others' positions from the DOM, accessible names, ordering, counts per notch or animation timing. Show only "N of M locked in" and their own electron. A Host or Co-Host who isn't Playing sees positions with `is-peek` styling and the notice "Only you can see this". (The server already withholds this data; don't add client-side leaks.)
5. **Accessibility.** WCAG AA contrast (the tokens are checked: keep text on its documented grounds). Touch targets are at least 44px. Focus is a visible 3px `focus` ring, offset 2px. Each Stage SVG has an accessible name that summarises the counts. Timers announce only at 30 s, 10 s and 0.
6. **Motion.** Ambient motion is slow (10–20 s cycles) and decorative. Text never sits on a moving edge. Under `prefers-reduced-motion: reduce`, ambient motion stops entirely (don't add the SMIL `<animate>` elements) and transitions become instant or a 150 ms fade.
7. **Shapes.** At most two big shapes per screen (on the Stage: the amoeba and the kidney). Small shapes sit behind containers or in margins and never cross text. Shapes are flat: no gradients, no blur. Each shape keeps the job listed in `components/AtomicShapes.md`.
8. **Layout fixes from the current app:** the seven Moods fit on one row at 390px; menus never clip and become a bottom sheet under 420px; choice rows put the control next to its label; the laptop layout must not be the phone column centred. If you can't redesign the laptop layout yet, at least cap the content width and centre it.

## Spectrum Stage spec (revealed)

Phone width is 390px, with a 16px gutter, so content is 358px. Top to bottom:

1. **Header row:** a small compass star + "Round 2 · Spectrum" (`t-title`); "Prompt 3 of 5" in `muted`. Below it, the tags: Chill/Spicy + the Pack name.
2. **Prompt container** (about 214px tall), in three stacked layers:
   - (a) Back layer: small drifting shapes (boomerang, kidney, starburst, sparkle, leaf, dots) positioned around the edges, each in a wrapper animated with a slow translate and rotate (12–20 s, alternate, ease-in-out).
   - (b) The amoeba (`SHAPES.amoeba`, fill `primary`), scaled to about 355×215. Its `d` breathes via `<animate attributeName="d" values={breatheValues(d)} dur="11s" repeatCount="indefinite">`.
   - (c) The Prompt text (`t-prompt`, colour `on-primary`), centred in a fixed inner box inset about 60px horizontally and 50px vertically. On a Spicy Prompt, use Jost 700 instead of Righteous and stop the drift.
3. **Status row:** "✦ Revealed" pill (`primary` fill, `on-primary` text) + "11 of 11 locked in · you can move now".
4. **Orbit** (SVG, viewBox 358×284):
   - The arc centre is at (179, 230), radius 136, as a semicircle stroked in `ink` at 2px.
   - Notches sit at 180°, 135°, 90°, 45° and 0°.
   - A hairline atom (46px) at (179, 208) turns once every 40 s.
   - **Each notch** is a ball starburst (`ink`). Your notch is a 34px compass star in `primary`.
   - **Each notch's people** sit evenly on a dashed orbit around it. The orbit radius is 22px for 1 person, 26px for 2–3 and 34px for 4 or more; with more than 6 people, add a second ring. Electrons are 14px-radius discs with pole fill and a 2px `ink` outline. Each shows initials, the Mood emoji at bottom-right, and a numbered `sky` diamond if their hand is up. The speaker has a 3px `primary` ring.
   - **Your orbit is open:** a `raised` fill behind it, electrons spread over 170° facing outward, and name pills (first name + last initial, or "You") placed radially about 27px outside each electron.
   - **The other orbits** show initials only and bob 3px. Tapping an orbit opens it and closes the previous one. Keyboard: each orbit is a focusable button whose label is "Agree, 4 people: Priya, You, Kiki, Marcus O."
   - **Notch labels** sit inside the arc, with the count in `t-count` style beside the last word.
   - **No separate key below the orbit.**
5. **Hint line:** "Tap any orbit to see who's in it · yours is open" (12px, `muted`).
6. **Floor container** (about 132px tall): the same three layers around a `teal` kidney.
   - Content (`on-teal`): an 86px atom timer, then "On the Floor" / speaker name + Mood / "Next: Dev, then Kiki", then a Raise button (`primary`).
   - The raised-hand queue rides the timer's outer orbit as small electrons with initials.
7. **Mood row:** seven `dr-mood` toggles.

The live reference is `previews/AtomicStage.html`; the geometry code is in its `<script>`.

## Motion spec

- **Reveal ("electrons fly out"):** electrons start at the nucleus and travel along a curve to their orbit (about 600 ms, `cubic-bezier(.2,.8,.2,1.1)`, 40 ms stagger per notch). Notch starbursts pop (scale 0.6 → 1.15 → 1). Your orbit opens last and the compass star lands. Reduced motion: a 150 ms fade to the final state.
- **Crossing a notch ("quantum jump"):** your electron leaves with a short dotted trail and snaps into the next orbit (about 220 ms). The starburst you pass ticks 45° and flashes `primary` for 200 ms, with `navigator.vibrate(10)` where supported. Counts update. Reduced motion: instant move, counts update.
- **Ambient:** the container `d` morph runs 10–12 s; back-layer drift 12–20 s; the nucleus turns every 40 s; closed-orbit electrons bob 3px. None of it runs under reduced motion.

## Acceptance: the design gauntlet

Run these before calling a component done. The checks marked *auto* should be automated (Playwright or Vitest plus axe):

1. **Crowd test** *(auto):* 15 people, 20-character names, everyone on one notch. Nothing overlaps and nothing breaks letter by letter.
2. **Leak test** *(auto):* in the pre-reveal state for someone Playing, the DOM and accessible tree contain no other person's position.
3. **Contrast** *(auto):* in both themes.
4. **Targets** *(auto):* every control is at least 44×44px. **Focus** is visible and in DOM order.
5. **Reduced motion** *(auto):* with `reducedMotion: 'reduce'`, there are zero `<animate>` elements and no running CSS animations.
6. **Spark audit** *(auto):* `var(--primary)` is used only by the allowed elements (rule 2).
7. **By hand:** the glance test (dark room, 50% brightness, 3 seconds), the tone test (Chill and Spicy Prompts), and side-by-side with Discord.

## Open questions: flag them, don't decide

- The laptop (1280px) layout for every screen.
- The pre-reveal Spectrum Stage (a lock-in interaction on the orbit).
- Middle Ground, Surrounded, Waiting Room and Recap at full fidelity (only directional sketches exist).
- An icon set drawn from the shape vocabulary (use ✋ and emoji placeholders until then).
