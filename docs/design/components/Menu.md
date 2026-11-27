# Menu

Selects, action menus and the orbit menu.

- **Select:** `.dr-select` (a button with `aria-haspopup` and `aria-expanded`) opens a `.dr-menu` listbox. The selected option shows a small ink sparkle.
- **Action menu:** `.dr-menu` with `role="menu"`. Items are 44px. It supports `--danger`, `aria-disabled` items (with the reason in the label) and separators.
- **Orbit menu:** a Host shortcut on the Stage. The person's actions orbit their electron. The same actions are always available in the list menu, for keyboard and screen-reader users.
- **Placement:** menus never clip. They flip to stay in the viewport and become a bottom sheet under 420px (fixes current bug 3).
