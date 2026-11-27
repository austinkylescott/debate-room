# Electron

The person marker used everywhere people appear: an outlined disc with initials, and the name on one line below it.

- **Markup:** `.dr-electron` > `.dr-electron__dot` (initials, plus optional `__mood`, `__hand`, `__role`) + `.dr-electron__name`.
- **Pole:** `data-pole="disagree|agree"`. Omit it for neutral (Unsure).
- **Sizes:** `--sm` 28px, default 38px, `--lg` 52px.
- **States:** `is-you`, `is-speaking` (orange ring), `is-hidden` (before the reveal: dashed, "?"), `is-locked` (✦ badge), `is-peek` (a non-Playing Host's dimmed preview), `is-away`, `is-spectator`.
- **Raised hand:** a sky diamond carrying the queue number.
- **Names never wrap.** They truncate with an ellipsis; the full name goes in `title` and the accessible name. When interactive, render it as a `<button>` (focus ring on the disc).
