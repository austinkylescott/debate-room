# Mood

The seven Moods (😀 ❤️ 😂 😮 🤔 😢 😠) as 44px toggle buttons. All seven fit on one row at 358px.

- **Classes:** `.dr-moods` (the row) > `.dr-mood` buttons with `aria-pressed`. `.dr-mood-inline` shows a Mood next to a name in text.
- **States:** rest, hover (scale 1.08), selected (mustard with an ink ring), focus, and disabled (Check-in closed).
- **Check-in:** a card with the question, a 15-second countdown, the picker, and a secondary "Keep [current Mood]" button.
- **Consumer provides:** an `aria-label` per Mood ("Happy", …) and the group label "Your Mood".
