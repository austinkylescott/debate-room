# Timer

Shared, server-timed countdowns. The client only draws.

- **Atom dial (`.dr-timer`, 86px):** an orange arc with an ink electron at its tip, around tabular digits.
  - `is-low`: the last 10 seconds. The arc turns ink and thickens, the digits grow, and the dial pulses once a second.
  - `is-paused`: dashed muted arc.
  - `is-done`: "Time".
- **Surfboard bar (`.dr-timer-bar`):** a compact version for headers and the Mood Check-in. The orange stripe drains toward the tail.
- **Accessibility:** `role="timer"` with an `aria-label` such as "42 seconds remaining". Announce only at 30 s, 10 s and 0, never every second.
- **Low time is not an error,** so it never turns red. The pulse stops under reduced motion.
