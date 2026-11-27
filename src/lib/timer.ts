// What a Timer shows and says. The server owns every countdown (see serverClock);
// these only turn whole seconds left into words and digits.

/** The seconds left at which a Timer speaks up, besides 0. Never every second. */
const MARKS = [10, 30];

/**
 * What a Timer says aloud when its countdown moves from `previous` to `current`
 * seconds left: only on reaching 30 s, 10 s and 0. Null to stay quiet, including
 * on the first reading (`previous` null), so joining mid-countdown isn't news.
 */
export function timerAnnouncement(previous: number | null, current: number): string | null {
  if (previous === null) return null;
  if (previous > 0 && current <= 0) return "Time's up";
  // The lowest mark passed, if ticks were missed and more than one was.
  const mark = MARKS.find((m) => previous > m && current <= m);
  return mark === undefined ? null : `${mark} seconds left`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** A Timer's accessible name: "1 minute 5 seconds remaining", or "Time's up". */
export function timeRemaining(seconds: number): string {
  if (seconds <= 0) return "Time's up";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts = [minutes ? plural(minutes, "minute") : "", rest ? plural(rest, "second") : ""];
  return `${parts.filter(Boolean).join(" ")} remaining`;
}

/** A Timer's digits: "0:42". */
export function clockDigits(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
