// The Floor: who is currently speaking on the call. The Host gives the Floor to
// one or more people and takes it back; Participants raise a hand to ask for it.
// Pure and dependency-free like the rest of the Room module. The Room
// (./room.ts) decides who may act; this module decides what the Floor does.

export interface Floor {
  /** Who has the Floor, in the order they were given it. */
  holders: FloorTurn[];
  /** Person ids with a raised hand, in the order they raised it. */
  raisedHands: string[];
  /** The speaking timer for each new Floor turn, in seconds. Null when it's off. */
  timerSeconds: number | null;
}

interface FloorTurn {
  personId: string;
  /** When this turn's speaking timer runs out. Null with no timer. */
  endsAt: number | null;
  timeUp: boolean;
}

/** What the Host does with the Floor. */
export type FloorControlIntent =
  | { type: "give-floor"; personId: string }
  | { type: "take-floor"; personId: string }
  /** Takes the Floor back from everyone who has it. */
  | { type: "clear-floor" }
  /** Sets the speaking timer for new Floor turns. Null turns it off. */
  | { type: "set-floor-timer"; seconds: number | null };

/** What a Participant does to ask for the Floor. */
export type HandIntent = { type: "raise-hand" } | { type: "lower-hand" };

export type FloorRejectionCode = "has-floor" | "timer-invalid";

export const FLOOR_TIMER_MIN_SECONDS = 10;
export const FLOOR_TIMER_MAX_SECONDS = 600;

export interface FloorRejection {
  code: FloorRejectionCode;
  message: string;
}

/** What happened to the Floor, for the Recap. The Room adds the time. */
export type FloorEvent =
  | { type: "floor-given"; personId: string }
  | { type: "floor-taken"; personId: string }
  /** A speaking timer ran out. The person keeps the Floor until it's taken back. */
  | { type: "floor-time-up"; personId: string };

export type FloorChange = { floor: Floor; events: FloorEvent[] };

export type FloorOutcome = FloorChange | { rejection: FloorRejection };

export interface FloorHolderView {
  personId: string;
  nickname: string;
  /** When this turn's speaking timer runs out. Null with no timer. */
  endsAt: number | null;
  /** Whether the speaking timer has run out. The Floor stays theirs until it's taken back. */
  timeUp: boolean;
}

export interface FloorView {
  holders: FloorHolderView[];
  /** The speaking timer for each new Floor turn, in seconds. Null when it's off. */
  timerSeconds: number | null;
  /** In the order hands were raised. */
  raisedHands: { personId: string; nickname: string }[];
}

export function emptyFloor(): Floor {
  return { holders: [], raisedHands: [], timerSeconds: null };
}

export function isFloorControlIntent(intent: { type: string }): intent is FloorControlIntent {
  return FLOOR_CONTROL_TYPES.includes(intent.type);
}

export function isHandIntent(intent: { type: string }): intent is HandIntent {
  return intent.type === "raise-hand" || intent.type === "lower-hand";
}

const FLOOR_CONTROL_TYPES: string[] = [
  "give-floor",
  "take-floor",
  "clear-floor",
  "set-floor-timer",
];

/**
 * Gives someone the Floor, which lowers their hand. Their turn gets the
 * speaking timer, if one is set. Someone who already has the Floor keeps their turn.
 */
export function giveFloor(floor: Floor, personId: string, now: number): FloorOutcome {
  const raisedHands = floor.raisedHands.filter((id) => id !== personId);
  if (hasFloor(floor, personId)) return { floor: { ...floor, raisedHands }, events: [] };
  const endsAt = floor.timerSeconds === null ? null : now + floor.timerSeconds * 1000;
  return {
    floor: {
      ...floor,
      holders: [...floor.holders, { personId, endsAt, timeUp: false }],
      raisedHands,
    },
    events: [{ type: "floor-given", personId }],
  };
}

/** Takes the Floor back from one person. */
export function takeFloor(floor: Floor, personId: string): FloorChange {
  if (!hasFloor(floor, personId)) return { floor, events: [] };
  return {
    floor: { ...floor, holders: floor.holders.filter((h) => h.personId !== personId) },
    events: [{ type: "floor-taken", personId }],
  };
}

/** Someone left the Room: they lose the Floor and their raised hand. */
export function leaveFloor(floor: Floor, personId: string): FloorChange {
  const taken = takeFloor(floor, personId);
  return {
    floor: { ...taken.floor, raisedHands: floor.raisedHands.filter((id) => id !== personId) },
    events: taken.events,
  };
}

/** Takes the Floor back from everyone who has it. */
export function clearFloor(floor: Floor): FloorChange {
  return {
    floor: { ...floor, holders: [] },
    events: floor.holders.map((h) => ({ type: "floor-taken", personId: h.personId })),
  };
}

/** Sets the speaking timer for new Floor turns. Turns already running keep theirs. */
export function setFloorTimer(floor: Floor, seconds: number | null): FloorOutcome {
  if (
    seconds !== null &&
    !(
      Number.isInteger(seconds) &&
      seconds >= FLOOR_TIMER_MIN_SECONDS &&
      seconds <= FLOOR_TIMER_MAX_SECONDS
    )
  ) {
    return {
      rejection: {
        code: "timer-invalid",
        message: `The speaking timer needs a whole number of seconds from ${FLOOR_TIMER_MIN_SECONDS} to ${FLOOR_TIMER_MAX_SECONDS}.`,
      },
    };
  }
  return { floor: { ...floor, timerSeconds: seconds }, events: [] };
}

/** Marks every speaking timer that has run out by `now`. Nobody loses the Floor. */
export function tickFloor(floor: Floor, now: number): FloorChange {
  const due = floor.holders.filter((turn) => isRunning(turn) && turn.endsAt! <= now);
  if (due.length === 0) return { floor, events: [] };
  return {
    floor: {
      ...floor,
      holders: floor.holders.map((turn) => (due.includes(turn) ? { ...turn, timeUp: true } : turn)),
    },
    events: due.map((turn) => ({ type: "floor-time-up", personId: turn.personId })),
  };
}

/** When the next speaking timer runs out, or null if none is running. */
export function nextFloorTimeUp(floor: Floor): number | null {
  const running = floor.holders.filter(isRunning).map((turn) => turn.endsAt!);
  return running.length > 0 ? Math.min(...running) : null;
}

/** Raises or lowers a hand. A hand raised again keeps its place. */
export function moveHand(floor: Floor, personId: string, intent: HandIntent): FloorOutcome {
  if (intent.type === "lower-hand") {
    return {
      floor: { ...floor, raisedHands: floor.raisedHands.filter((id) => id !== personId) },
      events: [],
    };
  }
  if (hasFloor(floor, personId)) {
    return { rejection: { code: "has-floor", message: "You already have the Floor." } };
  }
  if (floor.raisedHands.includes(personId)) return { floor, events: [] };
  return { floor: { ...floor, raisedHands: [...floor.raisedHands, personId] }, events: [] };
}

export function viewFloor(floor: Floor, nicknames: Map<string, string>): FloorView {
  return {
    holders: floor.holders.map((turn) => ({
      personId: turn.personId,
      nickname: nicknames.get(turn.personId) ?? "",
      endsAt: turn.endsAt,
      timeUp: turn.timeUp,
    })),
    timerSeconds: floor.timerSeconds,
    raisedHands: floor.raisedHands.map((personId) => ({
      personId,
      nickname: nicknames.get(personId) ?? "",
    })),
  };
}

function isRunning(turn: FloorTurn): boolean {
  return turn.endsAt !== null && !turn.timeUp;
}

function hasFloor(floor: Floor, personId: string): boolean {
  return floor.holders.some((h) => h.personId === personId);
}
