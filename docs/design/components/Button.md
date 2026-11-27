# Button

Pill buttons in four variants: primary (the orange spark), secondary, destructive and quiet.

- **Classes:** `.dr-btn`, plus `--secondary`, `--destructive` or `--quiet`. Sizes: `--lg` (52px, full width) and `--icon` (44px square).
- **States:** hover lifts 1px. Pressed sinks 3px onto its shadow. Focus is a 3px `focus` ring. Disabled gets a dashed border and muted text. Loading (`.is-loading`, `aria-busy`) shows a spinning atom.
- **Rules:** one primary per screen. Primary means "your move" (Raise hand, Lock in, Start Round). Destructive actions are outlined, never filled, and confirm in a sheet.
- **Consumer provides:** the label, an optional leading icon, and an `aria-label` for icon-only buttons.
