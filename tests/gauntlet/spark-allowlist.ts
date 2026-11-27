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
];
