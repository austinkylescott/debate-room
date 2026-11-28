// The spark audit's allowlist: the only elements that may resolve to `--primary`.
// Hard rule 2 (docs/design/HANDOFF.md): the spark means "your move" only — the
// screen's one primary action, whoever has the Floor, your own notch, and the
// Live and Revealed status pills. An element passes when it, or an ancestor,
// matches one of these selectors. Add an entry only for one of those jobs, and
// say which one in `why`.

export interface SparkAllowed {
  selector: string;
  why: string;
}

export const SPARK_ALLOWLIST: SparkAllowed[] = [
  { selector: "button.primary", why: "The screen's one primary action" },
  { selector: ".dr-tag--live", why: "The Live status pill" },
  { selector: ".spectrum [data-slot='slider-thumb']", why: "Your own notch on the Spectrum" },
  { selector: ".dr-electron.is-speaking .dr-electron__dot", why: "Whoever has the Floor" },
  // The revealed Spectrum Stage (#64).
  { selector: ".dr-tag--revealed", why: "The Revealed status pill" },
  { selector: ".dr-orbit__star", why: "Your own notch: the compass star on the orbit" },
  { selector: ".dr-orbit__speaking", why: "Whoever has the Floor: their ring on the orbit" },
  {
    selector: ".dr-orbit__notch.is-crossed .dr-orbit__burst",
    why: "Your own notch: the one your move just crossed flashes (HANDOFF.md motion spec)",
  },
  {
    selector: ".dr-zone--prompt .dr-zone__shape",
    why: "The Prompt's amoeba, which HANDOFF.md's Spectrum Stage spec (2b) fills with primary",
  },
  // Timer.md draws countdowns orange: the speaker's time, and your Check-in.
  { selector: ".dr-timer__arc", why: "Whoever has the Floor: their time draining (Timer.md)" },
  {
    selector: ".dr-timer-bar__stripe",
    why: "The Mood Check-in countdown: your move to pick a Mood (Timer.md)",
  },
];
