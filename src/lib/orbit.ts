// The Spectrum after the reveal, drawn as an orbit (docs/design/components/AtomicStage.md,
// HANDOFF.md "Spectrum Stage spec (revealed)"). Pure geometry for SpectrumOrbit.vue, in
// the 358×284 box the design draws it in: five notches on an arc, and each notch's
// people as electrons on a small orbit around it.
import { SPECTRUM_NOTCHES } from "../room/spectrum";

export const VIEW = { width: 358, height: 284 } as const;
export const CENTER = { x: 179, y: 230 } as const;
export const ARC_RADIUS = 136;
export const ELECTRON_RADIUS = 14;
/** Where the hairline atom sits, just above the arc's centre. */
export const NUCLEUS = { x: 179, y: 208, size: 46 } as const;

const NOTCH_DEGREES = [180, 135, 90, 45, 0];
/** How far apart two rings of the same orbit sit: two electrons and their ink outlines, and a hair. */
const RING_GAP = 32;
/** Electrons per ring: the spec adds a second ring past six people. */
const FIRST_RING = 6;
const SECOND_RING = 8;
/** The second ring fans over the outward side only, clear of the notch's label inside the arc. */
const SECOND_SPREAD = (240 * Math.PI) / 180;
/** Your open orbit fans out over this arc when its people fit on it. */
const OPEN_SPREAD = (170 * Math.PI) / 180;
/** Electrons are drawn with a 2px ink outline, half of it outside their radius. */
export const ELECTRON_REACH = ELECTRON_RADIUS + 1;
const MIN_GAP = ELECTRON_REACH * 2 + 2;
/** Name pills sit this far outside their electron's orbit. */
const PILL_OFFSET = 27;
const PILL_HEIGHT = 20;
/** The widest a pill gets before its name is cut with an ellipsis. */
export const PILL_MAX_WIDTH = 96;

const characters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => [...characters.segment(text)].map((part) => part.segment);

export interface Point {
  x: number;
  y: number;
}

/** The notch on the arc, from 0 (Strongly Disagree, on the left) to 4 (Strongly Agree). */
export function notchPoint(index: number, radius = ARC_RADIUS): Point {
  const angle = (NOTCH_DEGREES[index] * Math.PI) / 180;
  return { x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y - Math.sin(angle) * radius };
}

/** The direction pointing away from the arc's centre at a notch, in SVG angles (y down). */
function outward(index: number): number {
  const p = notchPoint(index);
  return Math.atan2(p.y - CENTER.y, p.x - CENTER.x);
}

/** The first ring's radius: 22px for one person, 26px for two or three, 34px for four or more. */
export function ringRadius(count: number): number {
  return count > 3 ? 34 : count > 1 ? 26 : 22;
}

export interface Seat extends Point {
  angle: number;
  ring: 0 | 1;
}

export interface OrbitLayout {
  center: Point;
  /** The dashed rings to draw, innermost first. */
  rings: number[];
  /** One seat per person shown, in the order given. */
  seats: Seat[];
  /** People the second ring has no seat for, shown as one "+N" electron. */
  overflow: number;
  /** Where the "+N" electron sits, when there is one. */
  extra: Seat | null;
  /** Whether the people fan out on one side (your open orbit), rather than all the way round. */
  fanned: boolean;
}

/**
 * Where each of a notch's `count` people sits. Your open orbit fans them over 170°
 * facing outward, when they fit without touching; otherwise, and on every other
 * orbit, they go evenly all the way round, starting outward. Past six people a
 * second ring fans out over the outward side (keeping clear of the label), and when
 * that's full its last seat is a "+N" electron standing in for everyone else.
 */
export function layoutOrbit(index: number, count: number, open: boolean): OrbitLayout {
  const center = notchPoint(index);
  const out = outward(index);
  const first = ringRadius(count);
  const fits = count > 1 && (OPEN_SPREAD * first) / (count - 1) >= MIN_GAP;
  const fanned = open && count > 1 && count <= FIRST_RING && fits;

  const inner = Math.min(count, FIRST_RING);
  const rest = Math.max(count - FIRST_RING, 0);
  const outerCount = rest > SECOND_RING ? SECOND_RING - 1 : rest;
  const overflow = rest - outerCount;
  const outerSlots = outerCount + (overflow > 0 ? 1 : 0);
  const rings = outerSlots > 0 ? [first, first + RING_GAP] : [first];

  const seats: Seat[] = [];
  const place = (n: number, radius: number, ring: 0 | 1, start: number, step: number) => {
    for (let j = 0; j < n; j++) {
      const angle = start + j * step;
      seats.push({
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
        angle,
        ring,
      });
    }
  };
  if (fanned) {
    place(inner, first, 0, out - OPEN_SPREAD / 2, OPEN_SPREAD / (inner - 1));
  } else {
    // An even ring would put one electron straight inward, onto the notch's label: turn it half a step.
    const step = (2 * Math.PI) / Math.max(inner, 1);
    place(inner, first, 0, inner % 2 === 0 ? out + step / 2 : out, step);
  }
  if (outerSlots === 1) {
    place(1, first + RING_GAP, 1, out, 0);
  } else if (outerSlots > 1) {
    place(
      outerSlots,
      first + RING_GAP,
      1,
      out - SECOND_SPREAD / 2,
      SECOND_SPREAD / (outerSlots - 1),
    );
  }
  const extra = overflow > 0 ? seats.pop()! : null;
  return { center, rings, seats, overflow, extra, fanned };
}

/** The name on a pill in your open orbit: "You", or a first name and last initial. */
export function pillName(name: string, you: boolean): string {
  if (you) return "You";
  const [first, second] = name.trim().split(/\s+/);
  return second ? `${first} ${graphemes(second)[0]}.` : first;
}

export interface Pill extends Point {
  width: number;
}

/** A generous guess at a pill's width: Jost 600 at 12px, plus its padding and border. */
function pillWidth(text: string): number {
  return Math.min(graphemes(text).length * 7.5 + 22, PILL_MAX_WIDTH);
}

/**
 * Name pills for a fanned (open) orbit, placed radially outside each electron and
 * kept inside the box. Null when they'd overlap each other: the names go in a list instead.
 */
export function placePills(layout: OrbitLayout, names: string[]): Pill[] | null {
  if (!layout.fanned && layout.seats.length > 1) return null;
  const radius = layout.rings[0] + PILL_OFFSET;
  const pills = layout.seats.map((seat, i) => {
    const width = pillWidth(names[i]);
    const x = layout.center.x + Math.cos(seat.angle) * radius;
    const y = layout.center.y + Math.sin(seat.angle) * radius;
    return {
      width,
      x: clamp(x, width / 2, VIEW.width - width / 2),
      y: clamp(y, PILL_HEIGHT / 2, VIEW.height - PILL_HEIGHT / 2),
    };
  });
  for (let i = 0; i < pills.length; i++) {
    for (let j = i + 1; j < pills.length; j++) {
      const a = pills[i];
      const b = pills[j];
      const apartX = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 2;
      const apartY = Math.abs(a.y - b.y) >= PILL_HEIGHT + 2;
      if (!apartX && !apartY) return null;
    }
  }
  return pills;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Where a notch's label sits, inside the arc, as the design places it. */
export function labelPoint(index: number): Point {
  const ends = index === 0 || index === 4;
  const inset = index === 2 ? 64 : ends ? 78 : 58;
  const p = notchPoint(index, ARC_RADIUS - inset);
  return { x: p.x, y: p.y + (ends ? -8 : 0) };
}

/** "4 people", "1 person", "nobody". */
function people(count: number): string {
  return count === 0 ? "nobody" : count === 1 ? "1 person" : `${count} people`;
}

/** The orbit's accessible name: every count, and which notch is yours. */
export function orbitSummary(counts: number[], yours: number | null): string {
  const parts = SPECTRUM_NOTCHES.map(
    (notch, i) => `${counts[i]} ${notch.label}${i === yours ? " including you" : ""}`,
  );
  return `Spectrum: ${parts.join(", ")}`;
}

/** One orbit's button: "Agree, 4 people: Priya, You, Kiki, Marcus Okonkwo-Hale". */
export function orbitLabel(index: number, names: string[]): string {
  const head = `${SPECTRUM_NOTCHES[index].label}, ${people(names.length)}`;
  return names.length ? `${head}: ${names.join(", ")}` : head;
}
