// Spectrum: the rules for one Prompt of a Spectrum Round. Playing people place
// themselves on a slider and lock in; positions stay hidden until the reveal,
// then moves are live; the Prompt ends with a summary card. Pure and
// dependency-free like the rest of the Room module.

/** Positions run from 0 (Strongly Disagree) to 100 (Strongly Agree). */
export const SPECTRUM_MIN = 0;
export const SPECTRUM_MAX = 100;

export const SPECTRUM_NOTCHES = [
  { value: 0, label: "Strongly Disagree" },
  { value: 25, label: "Disagree" },
  { value: 50, label: "Neutral" },
  { value: 75, label: "Agree" },
  { value: 100, label: "Strongly Agree" },
] as const;

export type SpectrumStep =
  /** People are placing themselves; positions are hidden from those Playing. */
  | "positioning"
  /** Positions are out and moves are live. */
  | "revealed"
  /** The Prompt is over: its summary card is on the Stage. */
  | "summary";

export interface SpectrumPrompt {
  step: SpectrumStep;
  /** Person ids Playing this Prompt, in Waiting Room order. */
  playing: string[];
  positions: Record<string, SpectrumPosition>;
}

interface SpectrumPosition {
  /** Where the person's slider is now: hovering before lock-in, moved after the reveal. */
  current: number | null;
  /** Where they locked in before the reveal. */
  locked: number | null;
}

export type SpectrumRejectionCode =
  | "not-playing"
  | "position-invalid"
  | "already-locked-in"
  | "positions-frozen";

export interface SpectrumRejection {
  code: SpectrumRejectionCode;
  message: string;
}

type Outcome = { prompt: SpectrumPrompt } | { rejection: SpectrumRejection };

/** How many people are nearest each notch, in {@link SPECTRUM_NOTCHES} order. */
export type Distribution = number[];

export interface SpectrumPersonView {
  personId: string;
  nickname: string;
  lockedIn: boolean;
  /** Null while positions are hidden from this viewer. */
  position: number | null;
  /** Null while positions are hidden from this viewer. */
  lockedPosition: number | null;
}

export interface SpectrumView {
  step: SpectrumStep;
  /** Whether this viewer sees positions. False for anyone Playing before the reveal. */
  positionsVisible: boolean;
  people: SpectrumPersonView[];
  /** The viewer's own slider, if they're Playing. */
  yours: { position: number | null; lockedPosition: number | null } | null;
  /** The summary card: where people locked in, and where they ended up. Only once the Prompt ends. */
  summary: { before: Distribution; after: Distribution } | null;
  /** Who the Host might call on. Only for the Host, and only while positions are out and moving. */
  callingAids: SpectrumCallingAids | null;
}

/** Who the Host might call on once positions are out. */
export interface SpectrumCallingAids {
  /** Person ids now nearest a different notch from the one they locked in nearest, in Waiting Room order. */
  changedMind: string[];
  /**
   * Whoever is lowest and highest now. On a tie, whoever comes first in Waiting
   * Room order. Null with fewer than two positions, or everyone in one spot.
   */
  furthestApart: { low: string; high: string } | null;
}

export function startSpectrumPrompt(playing: string[]): SpectrumPrompt {
  return {
    step: "positioning",
    playing,
    positions: Object.fromEntries(playing.map((id) => [id, { current: null, locked: null }])),
  };
}

/** Moves a Playing person's slider: a hover before they lock in, a live move after the reveal. */
export function movePosition(prompt: SpectrumPrompt, personId: string, position: number): Outcome {
  const refusal = checkMove(prompt, personId, position);
  if (refusal) return { rejection: refusal };
  const current = positionOf(prompt, personId);
  if (prompt.step === "positioning" && current.locked !== null) return ALREADY_LOCKED;
  return { prompt: setPosition(prompt, personId, { ...current, current: position }) };
}

/**
 * The notch values a move from `from` to `to` passes or lands on, in the order
 * it reaches them. Leaving a notch doesn't count as crossing it.
 */
export function notchesCrossed(from: number, to: number): number[] {
  const values = SPECTRUM_NOTCHES.map((notch) => notch.value as number);
  return to > from
    ? values.filter((v) => from < v && v <= to)
    : values.filter((v) => to <= v && v < from).reverse();
}

export function lockIn(prompt: SpectrumPrompt, personId: string, position: number): Outcome {
  const refusal = checkMove(prompt, personId, position);
  if (refusal) return { rejection: refusal };
  if (prompt.step !== "positioning") {
    return {
      rejection: { code: "positions-frozen", message: "The positions are already out." },
    };
  }
  if (positionOf(prompt, personId).locked !== null) return ALREADY_LOCKED;
  return { prompt: setPosition(prompt, personId, { current: position, locked: position }) };
}

/** Whether everyone Playing has locked in, which reveals the positions. */
export function everyoneLockedIn(prompt: SpectrumPrompt): boolean {
  return (
    prompt.playing.length > 0 &&
    prompt.playing.every((id) => positionOf(prompt, id).locked !== null)
  );
}

/**
 * Shows every position at once. Someone who hadn't locked in shows no position
 * (where they were hovering stays private) until they move.
 */
export function reveal(prompt: SpectrumPrompt): SpectrumPrompt {
  return {
    ...prompt,
    step: "revealed",
    positions: mapPositions(prompt, (p) => ({ current: p.locked, locked: p.locked })),
  };
}

/** Ends a revealed Prompt: positions freeze and the summary card shows. */
export function endPrompt(prompt: SpectrumPrompt): SpectrumPrompt {
  return { ...prompt, step: "summary" };
}

/** Drops someone who left the Room. Once the Prompt is over, its summary stays as it was. */
export function dropPerson(prompt: SpectrumPrompt, personId: string): SpectrumPrompt {
  if (prompt.step === "summary" || !prompt.playing.includes(personId)) return prompt;
  const { [personId]: _dropped, ...positions } = prompt.positions;
  return { ...prompt, playing: prompt.playing.filter((id) => id !== personId), positions };
}

/** Each Playing person's locked-in position. */
export function lockedPositions(prompt: SpectrumPrompt): Record<string, number | null> {
  return Object.fromEntries(prompt.playing.map((id) => [id, positionOf(prompt, id).locked]));
}

/** Each Playing person's position now. */
export function currentPositions(prompt: SpectrumPrompt): Record<string, number | null> {
  return Object.fromEntries(prompt.playing.map((id) => [id, positionOf(prompt, id).current]));
}

export function viewSpectrum(
  prompt: SpectrumPrompt,
  viewer: { personId: string | null; seesHidden: boolean; seesCallingAids: boolean },
  nicknames: Map<string, string>,
): SpectrumView {
  const positionsVisible = prompt.step !== "positioning" || viewer.seesHidden;
  const own = viewer.personId === null ? undefined : prompt.positions[viewer.personId];
  return {
    step: prompt.step,
    positionsVisible,
    people: prompt.playing.map((personId) => {
      const { current, locked } = positionOf(prompt, personId);
      return {
        personId,
        nickname: nicknames.get(personId) ?? "",
        lockedIn: locked !== null,
        position: positionsVisible ? current : null,
        lockedPosition: positionsVisible ? locked : null,
      };
    }),
    yours: own ? { position: own.current, lockedPosition: own.locked } : null,
    summary:
      prompt.step === "summary"
        ? {
            before: distribution(Object.values(lockedPositions(prompt))),
            after: distribution(Object.values(currentPositions(prompt))),
          }
        : null,
    callingAids:
      viewer.seesCallingAids && prompt.step === "revealed" ? callingAidsFor(prompt) : null,
  };
}

function callingAidsFor(prompt: SpectrumPrompt): SpectrumCallingAids {
  return {
    changedMind: prompt.playing.filter((id) => changedMind(positionOf(prompt, id))),
    furthestApart: furthestApart(prompt),
  };
}

/** Whether someone is now nearest a different notch from the one they locked in nearest. */
function changedMind({ current, locked }: SpectrumPosition): boolean {
  return current !== null && locked !== null && nearestNotch(current) !== nearestNotch(locked);
}

function furthestApart(prompt: SpectrumPrompt): SpectrumCallingAids["furthestApart"] {
  let low: { id: string; at: number } | null = null;
  let high: { id: string; at: number } | null = null;
  for (const id of prompt.playing) {
    const at = positionOf(prompt, id).current;
    if (at === null) continue;
    if (!low || at < low.at) low = { id, at };
    if (!high || at > high.at) high = { id, at };
  }
  return low && high && low.at < high.at ? { low: low.id, high: high.id } : null;
}

/** Counts positions by nearest notch. A position halfway between two counts toward agreeing. */
export function distribution(positions: (number | null)[]): Distribution {
  const counts = SPECTRUM_NOTCHES.map(() => 0);
  for (const position of positions) {
    if (position !== null) counts[nearestNotch(position)]! += 1;
  }
  return counts;
}

/**
 * The index in {@link SPECTRUM_NOTCHES} of the notch nearest a position. The
 * boundaries between notches sit halfway; a position on one counts toward agreeing.
 */
export function nearestNotch(position: number): number {
  const step = (SPECTRUM_MAX - SPECTRUM_MIN) / (SPECTRUM_NOTCHES.length - 1);
  return Math.round((position - SPECTRUM_MIN) / step);
}

/** The label of the notch nearest a position, such as "Disagree". */
export function notchLabel(position: number): string {
  return SPECTRUM_NOTCHES[nearestNotch(position)]!.label;
}

function checkMove(
  prompt: SpectrumPrompt,
  personId: string,
  position: number,
): SpectrumRejection | null {
  if (!prompt.playing.includes(personId)) {
    return {
      code: "not-playing",
      message: "You're not Playing this Prompt. You'll be in from the next one.",
    };
  }
  if (prompt.step === "summary") {
    return { code: "positions-frozen", message: "This Prompt is over." };
  }
  if (!Number.isFinite(position) || position < SPECTRUM_MIN || position > SPECTRUM_MAX) {
    return { code: "position-invalid", message: "That position isn't on the Spectrum." };
  }
  return null;
}

function positionOf(prompt: SpectrumPrompt, personId: string): SpectrumPosition {
  return prompt.positions[personId] ?? { current: null, locked: null };
}

function setPosition(
  prompt: SpectrumPrompt,
  personId: string,
  position: SpectrumPosition,
): SpectrumPrompt {
  return { ...prompt, positions: { ...prompt.positions, [personId]: position } };
}

function mapPositions(
  prompt: SpectrumPrompt,
  update: (position: SpectrumPosition) => SpectrumPosition,
): Record<string, SpectrumPosition> {
  return Object.fromEntries(
    Object.entries(prompt.positions).map(([id, position]) => [id, update(position)]),
  );
}

const ALREADY_LOCKED: Outcome = {
  rejection: { code: "already-locked-in", message: "You've already locked in for this Prompt." },
};
