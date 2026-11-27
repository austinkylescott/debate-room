# Toast

Transient toasts and persistent notices.

- **Toast (`.dr-toast`):** hangs from the top bar on a short string. It has an icon from the shape vocabulary (teardrop for info, sparkle for success, diamond for a heads-up, outlined triangle for errors), a message and one action.
  - At most two at once. They dismiss after 5 seconds; errors stay until resolved.
  - Use `role="status"`, or `role="alert"` for errors.
  - Never uses spark orange.
- **Notice (`.dr-notice`):** a dashed inline box that explains state, especially hidden information.
  - "Only you can see this" for a non-Playing Host: `--host`.
  - "7 of 11 locked in" for players.
