// The Spectrum track as the Stage draws it. Pure helpers for SpectrumStage.vue.
import { SPECTRUM_MAX, SPECTRUM_MIN, SPECTRUM_NOTCHES } from "../room/spectrum";

const NOTCH_VALUES: number[] = SPECTRUM_NOTCHES.map((notch) => notch.value);

/** The next notch past `value` in `direction`: where Page Up (1) and Page Down (-1) jump to. */
export function nextNotch(value: number, direction: 1 | -1): number {
  const next =
    direction === 1
      ? NOTCH_VALUES.find((v) => v > value)
      : NOTCH_VALUES.filter((v) => v < value).at(-1);
  return next ?? value;
}

/** What a screen reader announces for a position: the notch on it, or the notches either side. */
export function describePosition(value: number): string {
  const on = SPECTRUM_NOTCHES.find((notch) => notch.value === value);
  if (on) return on.label;
  const below = SPECTRUM_NOTCHES.filter((notch) => notch.value < value).at(-1)!;
  const above = SPECTRUM_NOTCHES.find((notch) => notch.value > value)!;
  return `${value}, between ${below.label} and ${above.label}`;
}

export interface TrackLabel {
  id: string;
  /** Where the person stands, from SPECTRUM_MIN to SPECTRUM_MAX. */
  position: number;
  /** The label's width, in percent of the track. */
  width: number;
}

/**
 * Which row each name label goes on (0 is nearest the track), so no two labels
 * overlap. A label at position p sits p% of its own width left of p, which keeps
 * labels at the ends inside the track; `.marker` in style.css places it that way.
 */
export function stackLabels(labels: TrackLabel[]): Record<string, number> {
  const rowEnds: number[] = [];
  const rows: Record<string, number> = {};
  for (const label of [...labels].sort((a, b) => a.position - b.position)) {
    const share = (label.position - SPECTRUM_MIN) / (SPECTRUM_MAX - SPECTRUM_MIN);
    const start = label.position - share * label.width;
    let row = rowEnds.findIndex((end) => end <= start);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = start + label.width;
    rows[label.id] = row;
  }
  return rows;
}
