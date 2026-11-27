// What an Electron (the person marker, docs/design/components/Electron.md) shows.
// Pure helpers for Electron.vue and the screens that place it.
import type { FloorView } from "../room/floor";
import { SPECTRUM_NOTCHES } from "../room/spectrum";

export type Pole = "disagree" | "agree";

const NEUTRAL = SPECTRUM_NOTCHES.find((notch) => notch.label === "Neutral")!.value;

/** The fill for someone at `position` on the Spectrum. None on Neutral (Unsure) or while hidden. */
export function poleOf(position: number | null): Pole | null {
  if (position === null || position === NEUTRAL) return null;
  return position < NEUTRAL ? "disagree" : "agree";
}

const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** The first character as a person sees it: a whole emoji, never half of one. */
function firstCharacter(word: string): string {
  return characters.segment(word)[Symbol.iterator]().next().value?.segment ?? "";
}

/** The initials on someone's disc. */
export function initials(name: string): string {
  let words = name.trim().split(/\s+/);
  if (words.length === 1) words = words[0].split("-");
  return words
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => firstCharacter(word).toUpperCase())
    .join("");
}

export interface FloorMarks {
  /** Has the Floor: the 3px spark ring. */
  speaking: boolean;
  /** Their place in the raised-hand queue, from 1, or null with no hand up. */
  hand: number | null;
}

/** Looks up each person's Floor marks. With no Floor, no one has any. */
export function floorMarks(floor: FloorView | null): (personId: string) => FloorMarks {
  const speaking = new Set(floor?.holders.map((holder) => holder.personId));
  const hands = new Map(floor?.raisedHands.map((hand, i) => [hand.personId, i + 1]));
  return (personId) => ({ speaking: speaking.has(personId), hand: hands.get(personId) ?? null });
}
