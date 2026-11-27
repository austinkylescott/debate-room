# Debate Room

The visual language for Debate Room: the shared "set" a friend group stages on their phones while they talk on their own call. A **Host** runs **Rounds** in three **Formats** (Spectrum, Middle Ground, Surrounded); everyone sees the same **Stage**.

> **Status: building the system (phase 1 of 3 done).** The direction is set: Atomic shapes, breathing amoeba containers and the orbit language. The tokens now have their final names. The core components are built with every state, as cards under **Core**, styled by `components/bundle.css`.
>
> | Phase | What | State |
> |---|---|---|
> | 1 | Final tokens; core components: Button, Tag, Electron, Mood, Timer, Field, Menu, Toast, Card | Done |
> | 2 | Debate Room pieces: each Format's Stage before and after the reveal, the Floor, the summary card | Next |
> | 3 | Key screens at 390px and 1280px: Home, Planning, Waiting Room, three Stages, Mood Check-in, Recap | Then |
> | 4 | The design gauntlet (below) | After 3 |

Toggle the page between Dark and Light to see everything in both themes. Dark is night-sky teal; light is cream paper.

## The look

A mid-century living room, staged by friends. The furniture is the shapes from atomic-age prints and textiles: boomerangs, kidney and amoeba shapes, leaves with a spine, surfboard ovals, teardrop pendants on strings, ball-tipped starbursts, compass stars and thin crossing hairlines. They are drawn as flat fills from a warm palette (burnt orange, mustard, teal, avocado, with a little pink and sky blue), with ink-coloured spines and balls.

**Type:** Righteous, a streamlined display face with a sign-painted feel, for Prompts, titles and countdowns. Jost, a geometric sans in Futura's lineage, for names, labels, body text and Spicy Prompts.

## Shape rules

1. **Every shape has a job.** The shape vocabulary card assigns each one: the amoeba holds the Prompt, the kidney holds the Floor, leaves are the poles, a compass star is your notch, a surfboard is a countdown, a bowl is Middle Ground's middle, a ring and dot is Surrounded's Center and chair. Don't use a shape for something else. That way people learn the set.
2. **Shapes hold text only in their calm centre.** Text sits in the inner area, never across an edge, a spine or a hairline. Text on a shape uses its `on-` token (`on-primary` on orange, `on-teal` on teal).
3. **Hairlines and starbursts are ink.** Crosshairs tie a shape to the grid. They never cross text.
4. **Two big shapes per screen, at most**, plus small accents (sparkles, starbursts). A third big shape means something is decoration and should go.
5. **Shapes are flat.** No gradients and no blur. Depth comes from overlapping shapes and the flat offset shadow `lift`.
6. **On a Spicy Prompt** the shapes stay but stop moving. The Prompt is set in Jost 700 instead of Righteous.

## Brand colour: a spark, not a fire alarm

**Burnt orange (`primary`) is the spark.** It marks only "your move" moments: the **Raise hand** button and the screen's one primary action, whoever has **the Floor**, **your own notch**, and the **Live** status. Wherever it appears, it says "it's your turn". Selection, success and locked-in states use mustard or ink instead. It is warm and eager rather than alarm-red. Teal is its cool partner and holds the calmer surfaces (the Floor kidney, the countdown board).

- **Poles:** Disagree is a deep teal-blue (`disagree`) and Agree is mustard (`agree`). Disagreeing is shown in a cool colour, never red: disagreement is part of the fun, not an alarm. The two fills differ strongly in lightness, so they hold up for colour-blind viewers, and every marker is outlined in ink.
- **Never orange for errors.** Destructive actions use `spicy`, as an outline only.

## Rules that carry over

These come from the brief and the "before" screenshots.

**Readable at a glance.** The Prompt is the largest thing on the Stage. Countdowns use tabular figures in a fixed-width box so digits don't jitter. Names, notch labels and tags never go below 12px.

**Names never break letter by letter.** Names on markers are a single line with `white-space: nowrap` and an ellipsis. The full name is in the title, the accessible name and the Waiting Room list. On the Stage, the orbit you're in shows first names; other orbits show initials until tapped. Notch labels wrap only at spaces (`overflow-wrap: normal; hyphens: none`).

**Electrons never overlap.** Each notch's people sit evenly around its orbit, and the orbit widens as it fills (22px for one person, 26px for two or three, 34px for four or more). With 15 people a crowded orbit adds a second ring rather than squeezing.

**Seven Moods on one row.** Seven 44px Mood buttons fit across 358px.

**Hidden until the reveal.** Before a reveal, someone Playing sees only their own marker and a count ("7 of 11 locked in"). A Host who isn't Playing sees everyone's position, dimmed and labelled "Only you can see this".

**Chill and Spicy.** Packs carry a Chill (avocado ●) or Spicy (pink ▲) tag. The word is always written out, and a shape tells the two apart as well as colour.

**Accessibility floor.** Text meets WCAG AA (4.5:1) on every surface it's used on, in both themes. Fill-only colours never carry text. Touch targets are at least 44px. Focus is a 3px `focus` ring, offset 2px. Every animation has a reduced-motion alternative.

## The orbit language

The atom is the app's grammar.
- **A nucleus** is whatever people gather around: the Room code, a Spectrum notch, a Middle Ground Side, the Surrounded Center, whoever has the Floor.
- **Electrons** are people. The orbit you're in is the open one and shows names; the others show initials and Moods until tapped.
- **The bond** between two atoms is a shared space: Middle Ground's middle, the chair in Surrounded, the link between Rounds in the Lineup.
- **Moving orbits** is a quantum jump. It's the same gesture everywhere: crossing a notch, stepping into the middle, taking the chair.
- **The outer dashed shell** is for people waiting: Spectators, raised hands, Challengers.

So one picture explains every Format, and the Recap can draw the night as a molecule: one atom per Prompt, its electrons showing how the room split.

## Motion

**Ambient: light, always optional.**
- The amoeba and kidney edges breathe between three nudged versions of the same path over 10–12 seconds. Only the outline moves; the text area is fixed.
- Small shapes on the layer behind each container drift a few pixels over 12–20 seconds.
- The nucleus atom turns once every 40 seconds. Electrons in closed orbits bob 3px in place.
- Nothing ambient moves faster than a slow breath, and it all stops under `prefers-reduced-motion`.

**The reveal: electrons fly out.**
- Every electron starts at the nucleus, flies out along a curve to its notch's orbit (about 600ms, staggered 40ms per notch), and settles with a small overshoot.
- Each notch's starburst pops (scale 0.6 → 1.15 → 1). Your orbit opens last with its name pills, and the compass star lands.
- With reduced motion, a 150ms fade to the final state.

**Crossing a notch: a quantum jump.**
- Your electron leaves its orbit with a short dotted trail and snaps into the next one (about 220ms).
- The starburst you pass ticks 45° and flashes orange, with a haptic tick where supported. The two orbits' counts update.
- With reduced motion, the electron moves instantly and the counts update.

## The design gauntlet

Every component and screen gets checked against this list before the system is called done. The items marked *auto* can be scripted against the previews; the rest need people.

1. **Glance test.** At arm's length, in a dark room at 50% brightness, can you tell within 3 seconds what the Prompt is, who has the Floor, and where you stand?
2. **Crowd test.** 15 people, names up to 20 characters ("Marcus Okonkwo-Hale"), everyone at one notch: nothing overlaps, and no name breaks letter by letter. *(auto)*
3. **Leak test.** Before a reveal, can someone Playing infer anyone's position from counts, ordering, animation timing or accessible names? *(auto for names and order)*
4. **Contrast.** Text at 4.5:1 and meaningful graphics at 3:1, in both themes. *(auto)*
5. **Colour-blind check.** Under deuteranopia, protanopia and tritanopia simulation, the poles, Chill and Spicy, and "your turn" stay distinct. *(auto)*
6. **Targets and focus.** Every control is at least 44px. Keyboard order follows the screen, and focus is always visible. *(auto)*
7. **Reduced motion.** With motion reduced, nothing moves except state changes, and nothing is lost. *(auto)*
8. **Distraction test.** During a 5-minute live conversation, does any ambient motion pull eyes away from the call? Breathing and drifting should go unnoticed after 10 seconds.
9. **Tone test.** The same Stage with a Chill food Prompt and a Spicy political Prompt: the Spicy one feels serious, not mocked.
10. **Discord test.** The laptop layout at half width beside Discord, and the phone held beside a call, both stay usable.
11. **Edge states.** Reconnecting, Room full, Host leaves, an empty Lineup, one Participant, a Spectator-only view.
12. **"Your turn" audit.** Spark orange appears only for "your move" moments: the primary action, the Floor, your notch and Live. *(auto: scan the previews for the token)*

## Tokens

Token names are plain roles (`ground`, `surface`, `ink`, `primary`, …). Component classes are prefixed `dr-` and live in `components/bundle.css`. Spacing (`space-1` to `space-8`, on a 4px base) and `radius-pill` are shared.

- **Grounds:** `ground`, `surface` and `raised` are three layers. Text uses `ink` or `muted`.
- **Spark:** `primary`, with text on it in `on-primary`. `primary-text` is the version that's safe as text.
- **Shape fills:** `mustard`, `teal`, `avocado`, `pink` and `sky` are fill only.
- **Poles:** `disagree` and `agree`, with `on-disagree` and `on-agree` for initials on them.
- **Tags:** `chill` and `spicy`.
- **Radius:** `radius` (controls) and `radius-lg` (cards). Card corners alternate 28px and 8px for the boomerang lean.

## Content voice

The app speaks like a good host: short, warm, never sarcastic about a topic. It uses the glossary's words: Room, Round, Prompt, Stage, the Floor, Lineup, Waiting Room. Status lines tell people what they can do next ("11 of 11 locked in · you can move now").

## Iconography

Moods stay as the platform's emoji (😀 ❤️ 😂 😮 🤔 😢 😠). UI icons (raise hand, mic, crown for Host, timer) will be drawn from the shape vocabulary, with 2px ink strokes and ball terminals. The sketches use ✋ as a placeholder.
