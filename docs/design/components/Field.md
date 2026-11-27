# Field

Text inputs and choice rows.

- **Text field:** `.dr-field` > `__label`, `__input`, then `__help` (with an optional counter) or `__error`.
  - States: rest, hover, focus (3px `focus` ring), error (`aria-invalid`, spicy border and a message that says what to do next), disabled (dashed, with the reason in the help text).
  - Inputs are 48px tall.
- **Choice:** `.dr-choice` wraps a radio or checkbox. The whole row is the target, and the control sits right beside its label (fixes current bug 2). The checked row gets the raised fill.
