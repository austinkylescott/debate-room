// The Room module: all Room logic, pure and dependency-free.
//
// The Durable Object (worker/room-server.ts) only adapts this module: it maps
// connections to actors, persists state and sends each connection its own
// `viewFor` result, and calls `tick` when a timer the Room scheduled is due.
// Tests drive `createRoom`, `apply`, `tick` and `viewFor` directly.

import {
  clearFloor,
  emptyFloor,
  type Floor,
  type FloorControlIntent,
  type FloorEvent,
  type FloorOutcome,
  type FloorRejectionCode,
  type FloorView,
  giveFloor,
  type HandIntent,
  isFloorControlIntent,
  isHandIntent,
  leaveFloor,
  moveHand,
  nextFloorTimeUp,
  setFloorTimer,
  takeFloor,
  tickFloor,
  upgradeFloor,
  viewFloor,
} from "./floor";
import {
  editLineup,
  emptyLineup,
  forgetPerson,
  isLineupIntent,
  type Lineup,
  type LineupIntent,
  type LineupRejectionCode,
  parseLineupIntent,
  previewLineup,
  type PreviewRound,
  type Round,
} from "./lineup";
import {
  abandonRound,
  advanceRound,
  controlSurrounded,
  type CurrentRound,
  formatSpeakers,
  leaveRound,
  stopSittingOut,
  moveSide,
  nextRound,
  playRound,
  revealPositions,
  type RoundEvent,
  type RoundIntent,
  type RoundOutcome,
  type RoundPeople,
  type RoundRejectionCode,
  stageView,
  startRound,
  type StageView,
  type SurroundedControl,
  nextRoundTimer,
  tickRound,
} from "./round";
import { isMood, startPromptMoods } from "./mood";

export type { StageView } from "./round";
export type { FloorView } from "./floor";

export type Phase = "planning" | "live" | "ended";

/** What a person joins the Room as. */
export type JoinRole = "participant" | "spectator";

/** Who sent an intent: identified by the per-device token kept in local storage. */
export interface Actor {
  token: string;
}

export type Intent =
  | { type: "claim-host"; hostSecret: string }
  | { type: "claim-host-pin"; pin: string }
  | { type: "open-room" }
  /** Ends the Room for good. The Recap stays viewable until the Room expires. */
  | { type: "end-room" }
  /** Discards a Room still in Planning, as if it had never been made. */
  | { type: "cancel-room" }
  | { type: "set-participant-limit"; limit: number }
  /** Joins as a Participant unless `as` says Spectator. */
  | { type: "join"; nickname: string; as?: JoinRole }
  /** A Spectator takes a Participant's place, between Rounds. */
  | { type: "become-participant" }
  | { type: "rename-person"; personId: string; nickname: string }
  | { type: "remove-person"; personId: string }
  /** Starts the next Round in the Lineup. */
  | { type: "start-round"; hostPlaying: boolean }
  /** Reveals the current Prompt's positions (Spectrum) or choices (Middle Ground). */
  | { type: "reveal-positions" }
  /** Middle Ground: the Host moves someone to a Side. */
  | { type: "move-to-side"; personId: string; side: 0 | 1 }
  /** Moves the Round on: to the Prompt's summary, the next Prompt or the Waiting Room. */
  | { type: "advance" }
  /** The Host makes these Participants Co-Hosts. */
  | { type: "grant-co-host"; personIds: string[] }
  | { type: "revoke-co-host"; personId: string }
  /** A Co-Host gives up the Co-Host controls. */
  | { type: "step-down" }
  /** A Co-Host chooses, between Rounds, whether they're Playing the next Round. */
  | { type: "set-playing"; playing: boolean }
  | RoundIntent
  | SurroundedControl
  | FloorControlIntent
  | HandIntent
  | LineupIntent;

export type RejectionCode =
  | "room-already-open"
  | "nickname-invalid"
  | "nickname-taken"
  | "pin-invalid"
  | "limit-invalid"
  | "room-full"
  | "spectators-full"
  | "room-not-open"
  | "room-ended"
  | "not-host"
  | "wrong-host-secret"
  | "wrong-pin"
  | "pin-locked"
  | "already-in-room"
  | "person-not-found"
  | "cant-remove-host"
  | "removed"
  | "no-round-to-start"
  | "round-in-progress"
  | "no-round"
  | "not-in-room"
  | "not-participant"
  | "spectators-watch"
  | "not-spectator"
  | "not-co-host"
  | RoundRejectionCode
  | FloorRejectionCode
  | LineupRejectionCode;

export interface Rejection {
  code: RejectionCode;
  message: string;
}

/**
 * One entry in the Recap: an append-only, timestamped log of what happened.
 * Everyone who can see the Recap sees every event, so an event never carries
 * hidden information (such as positions before a reveal). Derived views, such as
 * Floor time, are computed from the events (./recap.ts), never stored.
 */
export type RecapEvent =
  /** `hostNickname` is missing from events stored before it was added. */
  | { at: number; type: "room-opened"; hostNickname?: string }
  | { at: number; type: "room-ended" }
  | { at: number; type: "person-joined"; personId: string; nickname: string; as: JoinRole }
  | { at: number; type: "spectator-became-participant"; personId: string }
  | { at: number; type: "person-renamed"; personId: string; from: string; to: string }
  | { at: number; type: "person-removed"; personId: string; nickname: string }
  | {
      at: number;
      type: "co-host-granted" | "co-host-revoked" | "co-host-stepped-down";
      personId: string;
    }
  | ({ at: number } & RoundEvent)
  | ({ at: number } & FloorEvent);

/** A Participant or a Spectator: someone who joined the Room with a nickname. */
interface Person {
  id: string;
  nickname: string;
  token: string;
}

type Participant = Person;
type Spectator = Person;

/** A Participant the Host has given the controls for running Rounds. */
interface CoHost {
  personId: string;
  /** Whether they're Playing the next Round. They choose between Rounds. */
  playing: boolean;
}

/** Internal state. Never sent to clients as-is: clients only see `viewFor`. */
export interface RoomState {
  phase: Phase;
  hostSecret: string;
  /** The Host's recovery PIN, used from the public invite link. */
  hostPin: string;
  /** Wrong PINs since the last correct one or the last lockout, across all devices. */
  pinFailures: number;
  /** While `now` is before this time, PIN entry is locked. */
  pinLockedUntil: number;
  hostNickname: string;
  /** Device tokens recognised as the Host (one per device the Host has used). */
  hostTokens: string[];
  participants: Participant[];
  /** People watching the Stage who never take part in Rounds. */
  spectators: Spectator[];
  /** Participants who run Rounds alongside the Host, in the order they were made Co-Hosts. */
  coHosts: CoHost[];
  /** Device tokens the Host removed from the Room. They can't join again. */
  removedTokens: string[];
  /** The most Participants the Room allows, set by the Host. */
  participantLimit: number;
  /** Numbers the ids of Participants and Spectators alike, so a switch keeps the id. */
  nextParticipantNumber: number;
  lineup: Lineup;
  /** The Round being played, or null while the Room is in the Waiting Room. */
  round: CurrentRound | null;
  /** Rounds of the Lineup already started, so "the next Round" skips them. */
  playedRoundIds: string[];
  /** Who is speaking on the call. */
  floor: Floor;
  /** When an intent last changed the Room. The Room expires {@link ROOM_EXPIRY_MS} later. */
  lastActivityAt: number;
}

export interface ApplyResult {
  state: RoomState;
  recapEvents: RecapEvent[];
  rejection?: Rejection;
  /**
   * When `tick` next needs to run: the soonest of the running timers and the
   * Room's expiry. Left out only once the Room is gone.
   */
  scheduled?: number;
  /**
   * The Room is gone, Recap and all: it expired after {@link ROOM_EXPIRY_MS}
   * without activity, or the Host cancelled it while it was in Planning.
   */
  gone?: "expired" | "cancelled";
}

export const HOST_PERSON_ID = "host";
export const NICKNAME_MAX_LENGTH = 20;
/** Wrong PINs allowed before PIN entry locks for the whole Room. */
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCKOUT_MS = 10 * 60_000;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const DEFAULT_PARTICIPANT_LIMIT = 15;
export const MAX_PARTICIPANT_LIMIT = 50;
/** A Room with no activity for this long expires, Recap and all. */
export const ROOM_EXPIRY_MS = 7 * 24 * 60 * 60_000;
/** The most Spectators any Room allows. Fixed, and separate from the Participant limit. */
export const SPECTATOR_LIMIT = 25;

export interface WaitingRoomPerson {
  id: string;
  nickname: string;
  isHost: boolean;
  isCoHost: boolean;
}

export interface View {
  phase: Phase;
  you:
    | { role: "host"; personId: string; nickname: string }
    | { role: "participant"; personId: string; nickname: string }
    | { role: "spectator"; personId: string; nickname: string }
    | { role: "visitor" }
    /** The Host removed this device from the Room. */
    | { role: "removed" };
  /**
   * Whether this viewer has the controls for running Rounds: the Host and
   * Co-Hosts. Room-level controls stay with the Host.
   */
  runsRoom: boolean;
  /** For a Co-Host, whether they've chosen to be Playing the next Round. Null for everyone else. */
  coHost: { playingNextRound: boolean } | null;
  /** How full the Room is. Shown to everyone, so visitors can see it's full. */
  capacity: { joined: number; limit: number };
  /** How full the Room is for Spectators, who have their own fixed limit. Shown to everyone. */
  spectatorCapacity: { joined: number; limit: number };
  /**
   * Everyone in the Room, for people who are in it: the Host and Participants
   * in `people`, Spectators apart. Null for visitors.
   */
  waitingRoom: { people: WaitingRoomPerson[]; spectators: WaitingRoomPerson[] } | null;
  /** The whole Lineup, for the Host and Co-Hosts. Null for everyone else. */
  lineup: Round[] | null;
  /** The Preview of the Lineup, for visitors while the Room is in Planning. Null for everyone else. */
  preview: PreviewRound[] | null;
  /** The current Round, for people in the Room while one is being played. Null otherwise. */
  stage: StageView | null;
  /** The Round that "Start Round" would start, for the Host and Co-Hosts. Null for everyone else. */
  nextRoundId: string | null;
  /** Who has the Floor, for people in the Room while it's Live. Null otherwise. */
  floor: FloorView | null;
  /**
   * Whether this viewer may see the Recap: everyone in the Room while it's Live,
   * and anyone with the invite link once it has Ended. The Recap itself travels
   * as its own stream (see ../room/protocol.ts).
   */
  seesRecap: boolean;
  /** When the Room expires unless there's more activity. */
  expiresAt: number;
}

/** What the Worker knows when a Host creates a Room. */
export interface CreateRoomInput {
  hostSecret: string;
  hostNickname: string;
  /** The Host's recovery PIN: 4 to 6 digits. */
  pin: string;
  /** Defaults to {@link DEFAULT_PARTICIPANT_LIMIT}. */
  participantLimit?: number;
}

/** `now` starts the Room's expiry clock; `scheduled` is when `tick` first needs to run. */
export function createRoom(
  input: CreateRoomInput,
  now: number,
): { state: RoomState; scheduled: number } | { rejection: Rejection } {
  const nickname = normalizeNickname(input.hostNickname);
  if (nickname === null) return { rejection: INVALID_NICKNAME };
  if (!isValidPin(input.pin)) {
    return {
      rejection: {
        code: "pin-invalid",
        message: `The Host PIN needs ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`,
      },
    };
  }
  const participantLimit = input.participantLimit ?? DEFAULT_PARTICIPANT_LIMIT;
  if (!isValidLimit(participantLimit)) return { rejection: INVALID_LIMIT };
  return {
    state: {
      phase: "planning",
      hostSecret: input.hostSecret,
      hostPin: input.pin,
      pinFailures: 0,
      pinLockedUntil: 0,
      hostNickname: nickname,
      hostTokens: [],
      participants: [],
      spectators: [],
      coHosts: [],
      removedTokens: [],
      participantLimit,
      nextParticipantNumber: 1,
      lineup: emptyLineup(),
      round: null,
      playedRoundIds: [],
      floor: emptyFloor(),
      lastActivityAt: now,
    },
    scheduled: now + ROOM_EXPIRY_MS,
  };
}

export function apply(state: RoomState, intent: Intent, actor: Actor, now: number): ApplyResult {
  if (isExpired(state, now)) return gone(state, "expired");
  const result = applyIntent(state, intent, actor, now);
  // Only an accepted intent that changed the Room counts as activity.
  const active = !result.rejection && result.state !== state;
  return withSchedule(
    active ? { ...result, state: { ...result.state, lastActivityAt: now } } : result,
  );
}

/**
 * Handles the timers that are due by `now`, and expires the Room after
 * {@link ROOM_EXPIRY_MS} without activity. The Durable Object calls it from an
 * alarm. A timer running out isn't activity.
 */
export function tick(state: RoomState, now: number): ApplyResult {
  if (isExpired(state, now)) return gone(state, "expired");
  const floor = tickFloor(state.floor, now);
  const afterFloor = floor.floor === state.floor ? unchanged(state) : withFloor(state, floor, now);
  return withSchedule(tickCurrentRound(afterFloor, now));
}

/** Runs the current Round's timers (the Mood Check-in closing) on top of an earlier change. */
function tickCurrentRound(result: ApplyResult, now: number): ApplyResult {
  const round = result.state.round;
  if (!round) return result;
  const outcome = tickRound(round, now);
  // Nothing due: keep the same state, so the adapter has nothing to save or send.
  if ("round" in outcome && outcome.round === round) return result;
  const ticked = withRound(result.state, outcome, now);
  return { state: ticked.state, recapEvents: [...result.recapEvents, ...ticked.recapEvents] };
}

/**
 * Points `scheduled` at the Room's next due time, worked out from the state
 * after the change: the earliest of the Floor timers, the Mood Check-in's close
 * and the Room's expiry. A Durable Object has one alarm, so this is the only
 * time it needs.
 */
function withSchedule(result: ApplyResult): ApplyResult {
  if (result.gone) return result;
  const round = result.state.round;
  const due = [
    expiresAt(result.state),
    nextFloorTimeUp(result.state.floor),
    round ? nextRoundTimer(round) : null,
  ].filter((at): at is number => at !== null);
  return { ...result, scheduled: Math.min(...due) };
}

function expiresAt(state: RoomState): number {
  return state.lastActivityAt + ROOM_EXPIRY_MS;
}

function isExpired(state: RoomState, now: number): boolean {
  return now >= expiresAt(state);
}

function gone(state: RoomState, why: "expired" | "cancelled"): ApplyResult {
  return { state, recapEvents: [], gone: why };
}

function applyIntent(state: RoomState, intent: Intent, actor: Actor, now: number): ApplyResult {
  // A removed device can do nothing in the Room (not even guess the PIN),
  // except present the Host link, which always grants the Host role.
  if (isRemoved(state, actor) && intent.type !== "claim-host") return rejected(state, REMOVED);
  // An Ended Room is read-only: only the Host can still get back in.
  if (state.phase === "ended" && intent.type !== "claim-host" && intent.type !== "claim-host-pin") {
    return rejected(state, ROOM_ENDED);
  }
  if (isLineupIntent(intent)) return changeLineup(state, intent, actor);
  if (isFloorControlIntent(intent)) return controlFloor(state, intent, actor, now);
  if (isHandIntent(intent)) return moveOwnHand(state, intent, actor, now);
  switch (intent.type) {
    case "claim-host":
      return claimHost(state, intent.hostSecret, actor);
    case "claim-host-pin":
      return claimHostWithPin(state, intent.pin, actor, now);
    case "open-room":
      return openRoom(state, actor, now);
    case "end-room":
      return endRoom(state, actor, now);
    case "cancel-room":
      return cancelRoom(state, actor);
    case "set-participant-limit":
      return setParticipantLimit(state, intent.limit, actor);
    case "join":
      return join(state, intent.nickname, intent.as ?? "participant", actor, now);
    case "become-participant":
      return becomeParticipant(state, actor, now);
    case "rename-person":
      return renamePerson(state, intent.personId, intent.nickname, actor, now);
    case "remove-person":
      return removePerson(state, intent.personId, actor, now);
    case "start-round":
      return beginRound(state, intent.hostPlaying, actor, now);
    case "move-position":
    case "lock-in":
    case "set-mood":
    case "pick-side":
    case "choose-middle":
    case "volunteer-center":
    case "take-chair":
    case "vote-remove":
    case "yield-chair":
      return playCurrentRound(state, intent, actor, now);
    case "choose-center":
    case "seat-challenger":
      // Spectators watch: they're never the Center or in the chair.
      if (canRunRoom(state, actor) && state.spectators.some((s) => s.id === intent.personId)) {
        return rejected(state, SPECTATORS_WATCH);
      }
      return runCurrentRound(state, actor, "run the chair", now, (round) =>
        controlSurrounded(round, intent, now),
      );
    case "end-exchange":
      return runCurrentRound(state, actor, "end an exchange", now, (round) =>
        controlSurrounded(round, intent, now),
      );
    case "move-to-side":
      // Spectators never have a Side, so there's nothing to move them to.
      if (canRunRoom(state, actor) && state.spectators.some((s) => s.id === intent.personId)) {
        return rejected(state, SPECTATORS_WATCH);
      }
      return runCurrentRound(state, actor, "move people between Sides", now, (round) =>
        moveSide(round, intent.personId, intent.side),
      );
    case "reveal-positions":
      return runCurrentRound(state, actor, "reveal", now, revealPositions);
    case "advance":
      return runCurrentRound(state, actor, "move the Round on", now, (round) =>
        advanceRound(round, roundPeople(state), now),
      );
    case "grant-co-host":
      return grantCoHost(state, intent.personIds, actor, now);
    case "revoke-co-host":
      return revokeCoHost(state, intent.personId, actor, now);
    case "step-down":
      return stepDown(state, actor, now);
    case "set-playing":
      return setCoHostPlaying(state, intent.playing, actor);
  }
}

export function viewFor(state: RoomState, viewer: Actor): View {
  const you = identify(state, viewer);
  const inRoom = you.role === "host" || you.role === "participant" || you.role === "spectator";
  const runsRoom = canRunRoom(state, viewer);
  const coHost = coHostOf(state, viewer);
  return {
    phase: state.phase,
    you,
    runsRoom,
    coHost: coHost ? { playingNextRound: coHost.playing } : null,
    capacity: { joined: state.participants.length, limit: state.participantLimit },
    spectatorCapacity: { joined: state.spectators.length, limit: SPECTATOR_LIMIT },
    waitingRoom: inRoom
      ? {
          people: waitingRoomPeople(state),
          spectators: state.spectators.map((s) => asWaitingRoomPerson(s)),
        }
      : null,
    lineup: runsRoom ? state.lineup.rounds : null,
    preview:
      state.phase === "planning" && you.role === "visitor" ? previewLineup(state.lineup) : null,
    stage:
      inRoom && state.round
        ? stageView(
            state.round,
            {
              personId: you.personId,
              runsRoom,
              isSpectator: you.role === "spectator",
            },
            roundPeople(state),
          )
        : null,
    nextRoundId: runsRoom ? (nextRound(state.lineup, state.playedRoundIds)?.id ?? null) : null,
    floor:
      inRoom && state.phase === "live"
        ? viewFloor(state.floor, roundPeople(state).nicknames)
        : null,
    seesRecap: state.phase === "ended" || (state.phase === "live" && inRoom),
    expiresAt: expiresAt(state),
  };
}

/** Checks the shape of an intent received over the wire. Returns null if it isn't one. */
export function parseIntent(raw: unknown): Intent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  switch (value.type) {
    case "claim-host":
      return typeof value.hostSecret === "string"
        ? { type: "claim-host", hostSecret: value.hostSecret }
        : null;
    case "claim-host-pin":
      return typeof value.pin === "string" ? { type: "claim-host-pin", pin: value.pin } : null;
    case "open-room":
    case "end-room":
    case "cancel-room":
      return { type: value.type };
    case "set-participant-limit":
      return typeof value.limit === "number"
        ? { type: "set-participant-limit", limit: value.limit }
        : null;
    case "join":
      if (typeof value.nickname !== "string") return null;
      if (value.as === undefined) return { type: "join", nickname: value.nickname };
      return value.as === "participant" || value.as === "spectator"
        ? { type: "join", nickname: value.nickname, as: value.as }
        : null;
    case "become-participant":
      return { type: "become-participant" };
    case "rename-person":
      return typeof value.personId === "string" && typeof value.nickname === "string"
        ? { type: "rename-person", personId: value.personId, nickname: value.nickname }
        : null;
    case "remove-person":
      return typeof value.personId === "string"
        ? { type: "remove-person", personId: value.personId }
        : null;
    case "start-round":
      return typeof value.hostPlaying === "boolean"
        ? { type: "start-round", hostPlaying: value.hostPlaying }
        : null;
    case "reveal-positions":
    case "advance":
      return { type: value.type };
    case "move-position":
      if (typeof value.position !== "number") return null;
      return value.settled === true
        ? { type: "move-position", position: value.position, settled: true }
        : { type: "move-position", position: value.position };
    case "lock-in":
      return typeof value.position === "number"
        ? { type: "lock-in", position: value.position }
        : null;
    case "set-mood":
      return isMood(value.mood) ? { type: "set-mood", mood: value.mood } : null;
    case "pick-side":
      return value.side === 0 || value.side === 1 ? { type: "pick-side", side: value.side } : null;
    case "move-to-side":
      return typeof value.personId === "string" && (value.side === 0 || value.side === 1)
        ? { type: "move-to-side", personId: value.personId, side: value.side }
        : null;
    case "choose-middle":
      return typeof value.stepIn === "boolean"
        ? { type: "choose-middle", stepIn: value.stepIn }
        : null;
    case "volunteer-center":
    case "take-chair":
    case "yield-chair":
    case "end-exchange":
      return { type: value.type };
    case "vote-remove":
      return typeof value.remove === "boolean"
        ? { type: "vote-remove", remove: value.remove }
        : null;
    case "choose-center":
    case "seat-challenger":
      return typeof value.personId === "string"
        ? { type: value.type, personId: value.personId }
        : null;
    case "give-floor":
    case "take-floor":
      return typeof value.personId === "string"
        ? { type: value.type, personId: value.personId }
        : null;
    case "set-floor-timer":
      return value.seconds === null || typeof value.seconds === "number"
        ? { type: value.type, seconds: value.seconds }
        : null;
    case "clear-floor":
    case "raise-hand":
    case "lower-hand":
    case "step-down":
      return { type: value.type };
    case "grant-co-host":
      return Array.isArray(value.personIds) &&
        value.personIds.every((id): id is string => typeof id === "string")
        ? { type: "grant-co-host", personIds: value.personIds }
        : null;
    case "revoke-co-host":
      return typeof value.personId === "string"
        ? { type: "revoke-co-host", personId: value.personId }
        : null;
    case "set-playing":
      return typeof value.playing === "boolean"
        ? { type: "set-playing", playing: value.playing }
        : null;
    default:
      return parseLineupIntent(value);
  }
}

/**
 * Fills in what a Room stored by an earlier version of the app is missing. A
 * Room stored before expiry existed starts its expiry clock at `now`.
 */
export function upgradeState(stored: RoomState, now: number): RoomState {
  return {
    ...stored,
    spectators: stored.spectators ?? [],
    coHosts: stored.coHosts ?? [],
    lineup: stored.lineup ?? emptyLineup(),
    round: stored.round
      ? {
          ...stored.round,
          moods: stored.round.moods ?? startPromptMoods(),
          sittingOut: stored.round.sittingOut ?? [],
        }
      : null,
    playedRoundIds: stored.playedRoundIds ?? [],
    floor: upgradeFloor(stored.floor, now),
    lastActivityAt: stored.lastActivityAt ?? now,
  };
}

/** Trims and collapses whitespace. Returns null if the result is empty or too long. */
function normalizeNickname(raw: string): string | null {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (nickname.length === 0 || nickname.length > NICKNAME_MAX_LENGTH) return null;
  return nickname;
}

function claimHost(state: RoomState, hostSecret: string, actor: Actor): ApplyResult {
  if (isHost(state, actor)) return unchanged(state);
  if (hostSecret !== state.hostSecret) {
    return rejected(state, {
      code: "wrong-host-secret",
      message: "That Host link isn't valid for this Room.",
    });
  }
  return grantHost(state, actor);
}

// PIN attempts are limited per Room, not per device: device tokens cost nothing
// to make, so a per-device limit wouldn't slow a guesser down. The Host link
// still works during a lockout, so the real Host is never stuck.
function claimHostWithPin(state: RoomState, pin: string, actor: Actor, now: number): ApplyResult {
  if (isHost(state, actor)) return unchanged(state);
  if (now < state.pinLockedUntil) return rejected(state, pinLocked(state.pinLockedUntil - now));
  if (pin === state.hostPin) {
    return grantHost({ ...state, pinFailures: 0 }, actor);
  }
  const pinFailures = state.pinFailures + 1;
  if (pinFailures >= PIN_MAX_FAILURES) {
    return rejected(
      { ...state, pinFailures: 0, pinLockedUntil: now + PIN_LOCKOUT_MS },
      pinLocked(PIN_LOCKOUT_MS),
    );
  }
  const triesLeft = PIN_MAX_FAILURES - pinFailures;
  return rejected(
    { ...state, pinFailures },
    {
      code: "wrong-pin",
      message: `That PIN isn't right. ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left before PIN entry is locked.`,
    },
  );
}

function pinLocked(remainingMs: number): Rejection {
  const minutes = Math.ceil(remainingMs / 60_000);
  return {
    code: "pin-locked",
    message: `Too many wrong PINs. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}, or use your Host link.`,
  };
}

/**
 * The Host secret or the right PIN always grants the Host role. If the Host had
 * already joined from this device as a Participant or Spectator, that entry
 * gives way: the Host is listed in the Waiting Room as the Host.
 */
function grantHost(state: RoomState, actor: Actor): ApplyResult {
  return {
    state: {
      ...state,
      hostTokens: [...state.hostTokens, actor.token],
      participants: state.participants.filter((p) => p.token !== actor.token),
      spectators: state.spectators.filter((s) => s.token !== actor.token),
      coHosts: withoutCoHost(state, findParticipant(state, actor)?.id),
    },
    recapEvents: [],
  };
}

function openRoom(state: RoomState, actor: Actor, now: number): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("open the Room"));
  if (state.phase !== "planning") return unchanged(state);
  return {
    state: { ...state, phase: "live" },
    recapEvents: [{ at: now, type: "room-opened", hostNickname: state.hostNickname }],
  };
}

/** Nothing has happened in a Room still in Planning, so cancelling it leaves no Recap. */
function cancelRoom(state: RoomState, actor: Actor): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("cancel the Room"));
  if (state.phase !== "planning") {
    return rejected(state, {
      code: "room-already-open",
      message: "This Room is already open, so it can't be cancelled. End it instead.",
    });
  }
  return gone(state, "cancelled");
}

/** Ends the Room: the Floor is taken back from everyone and the Round in progress ends. */
function endRoom(state: RoomState, actor: Actor, now: number): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("end the Room"));
  if (state.phase === "planning") {
    return rejected(state, {
      code: "room-not-open",
      message: "This Room hasn't opened yet. Cancel it instead.",
    });
  }
  const cleared = withFloor(state, clearFloor(state.floor), now);
  const ended = state.round
    ? withRound(cleared.state, abandonRound(state.round), now)
    : unchanged(cleared.state);
  return {
    state: { ...ended.state, phase: "ended" },
    recapEvents: [...cleared.recapEvents, ...ended.recapEvents, { at: now, type: "room-ended" }],
  };
}

function setParticipantLimit(state: RoomState, limit: number, actor: Actor): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("change the Participant limit"));
  if (!isValidLimit(limit)) return rejected(state, INVALID_LIMIT);
  const joined = state.participants.length;
  if (limit < joined) {
    return rejected(state, {
      code: "limit-invalid",
      message: `${joined} Participants have already joined, so the limit can't go below ${joined}.`,
    });
  }
  return { state: { ...state, participantLimit: limit }, recapEvents: [] };
}

function join(
  state: RoomState,
  rawNickname: string,
  role: JoinRole,
  actor: Actor,
  now: number,
): ApplyResult {
  if (isHost(state, actor)) {
    return rejected(state, {
      code: "already-in-room",
      message: "You're already in this Room as the Host.",
    });
  }
  // Rejoining from the same device restores the same Participant or Spectator.
  if (findParticipant(state, actor) || findSpectator(state, actor)) return unchanged(state);
  if (state.phase === "planning") {
    return rejected(state, {
      code: "room-not-open",
      message: "This Room isn't open yet. Check back soon.",
    });
  }
  // Only Participants count for now. Once the Host can be Playing in a Round,
  // a Playing Host takes one of these places too.
  // A full Participant limit offers Spectator instead, if there's room to watch.
  if (role === "participant" && isParticipantLimitFull(state)) {
    const full = roomFull(state);
    return rejected(
      state,
      state.spectators.length < SPECTATOR_LIMIT
        ? { ...full, message: `${full.message} You can join as a Spectator instead.` }
        : full,
    );
  }
  if (role === "spectator" && state.spectators.length >= SPECTATOR_LIMIT) {
    return rejected(state, {
      code: "spectators-full",
      message: `This Room has no room for more Spectators: it allows ${SPECTATOR_LIMIT}.`,
    });
  }
  const nickname = normalizeNickname(rawNickname);
  if (nickname === null) return rejected(state, INVALID_NICKNAME);
  if (isNicknameTaken(state, nickname)) return rejected(state, nicknameTaken(nickname));
  const person: Person = { id: `p${state.nextParticipantNumber}`, nickname, token: actor.token };
  return {
    state: {
      ...state,
      ...(role === "participant"
        ? { participants: [...state.participants, person] }
        : { spectators: [...state.spectators, person] }),
      nextParticipantNumber: state.nextParticipantNumber + 1,
    },
    recapEvents: [{ at: now, type: "person-joined", personId: person.id, nickname, as: role }],
  };
}

/** Between Rounds, a Spectator can take a free Participant place. They keep their id. */
function becomeParticipant(state: RoomState, actor: Actor, now: number): ApplyResult {
  const spectator = findSpectator(state, actor);
  if (!spectator) {
    return rejected(state, {
      code: "not-spectator",
      message: "Only Spectators can switch to Participant.",
    });
  }
  if (state.round) {
    return rejected(state, {
      code: "round-in-progress",
      message: "You can switch to Participant once this Round is over.",
    });
  }
  if (isParticipantLimitFull(state)) return rejected(state, roomFull(state));
  return {
    state: {
      ...state,
      spectators: state.spectators.filter((s) => s.id !== spectator.id),
      participants: [...state.participants, spectator],
    },
    recapEvents: [{ at: now, type: "spectator-became-participant", personId: spectator.id }],
  };
}

function isParticipantLimitFull(state: RoomState): boolean {
  return state.participants.length >= state.participantLimit;
}

function roomFull(state: RoomState): Rejection {
  return {
    code: "room-full",
    message: `This Room is full: it allows ${state.participantLimit} Participants.`,
  };
}

function renamePerson(
  state: RoomState,
  personId: string,
  rawNickname: string,
  actor: Actor,
  now: number,
): ApplyResult {
  if (!canRunRoom(state, actor)) return rejected(state, notRunner("rename people"));
  const from = nicknameOf(state, personId);
  if (from === undefined) return rejected(state, PERSON_NOT_FOUND);
  const nickname = normalizeNickname(rawNickname);
  if (nickname === null) return rejected(state, INVALID_NICKNAME);
  if (isNicknameTaken(state, nickname, personId)) return rejected(state, nicknameTaken(nickname));
  if (nickname === from) return unchanged(state);
  const rename = (p: Person): Person => (p.id === personId ? { ...p, nickname } : p);
  const renamed: RoomState =
    personId === HOST_PERSON_ID
      ? { ...state, hostNickname: nickname }
      : {
          ...state,
          participants: state.participants.map(rename),
          spectators: state.spectators.map(rename),
        };
  return {
    state: renamed,
    recapEvents: [{ at: now, type: "person-renamed", personId, from, to: nickname }],
  };
}

function removePerson(state: RoomState, personId: string, actor: Actor, now: number): ApplyResult {
  if (!canRunRoom(state, actor)) return rejected(state, notRunner("remove people"));
  if (personId === HOST_PERSON_ID) {
    return rejected(state, {
      code: "cant-remove-host",
      message: "The Host can't be removed from their own Room.",
    });
  }
  // Removing a Co-Host takes their controls away too, which is the Host's call.
  if (isCoHost(state, personId) && !isHost(state, actor)) {
    return rejected(state, notHost("remove a Co-Host"));
  }
  const person = [...state.participants, ...state.spectators].find((p) => p.id === personId);
  if (!person) return rejected(state, PERSON_NOT_FOUND);
  const floor = leaveFloor(state.floor, personId);
  const removed: ApplyResult = {
    state: {
      ...state,
      participants: state.participants.filter((p) => p.id !== personId),
      spectators: state.spectators.filter((s) => s.id !== personId),
      coHosts: withoutCoHost(state, personId),
      removedTokens: [...state.removedTokens, person.token],
      lineup: forgetPerson(state.lineup, personId),
      floor: floor.floor,
    },
    recapEvents: [
      { at: now, type: "person-removed", personId, nickname: person.nickname },
      ...floor.events.map((event) => ({ at: now, ...event })),
    ],
  };
  if (!state.round) return removed;
  const left = withRound(removed.state, leaveRound(state.round, personId), now);
  return { state: left.state, recapEvents: [...removed.recapEvents, ...left.recapEvents] };
}

/**
 * The Host makes Participants Co-Hosts, several at once. All or nobody: if one
 * of them can't be a Co-Host, nobody is made one. Anyone already a Co-Host
 * stays as they are.
 */
function grantCoHost(
  state: RoomState,
  personIds: string[],
  actor: Actor,
  now: number,
): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("make people Co-Hosts"));
  for (const personId of personIds) {
    if (state.spectators.some((s) => s.id === personId)) {
      return rejected(state, {
        code: "spectators-watch",
        message: "Spectators watch the Stage, so they can't be Co-Hosts.",
      });
    }
    if (!state.participants.some((p) => p.id === personId)) {
      return rejected(state, PERSON_NOT_FOUND);
    }
  }
  const granted = [...new Set(personIds)].filter((id) => !isCoHost(state, id));
  if (granted.length === 0) return unchanged(state);
  return {
    // A new Co-Host keeps Playing, as they were as a Participant, until they choose otherwise.
    state: {
      ...state,
      coHosts: [...state.coHosts, ...granted.map((personId) => ({ personId, playing: true }))],
    },
    recapEvents: granted.map((personId) => ({ at: now, type: "co-host-granted", personId })),
  };
}

function revokeCoHost(state: RoomState, personId: string, actor: Actor, now: number): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("revoke Co-Hosts"));
  if (!isCoHost(state, personId)) {
    return rejected(state, { code: "not-co-host", message: "That person isn't a Co-Host." });
  }
  return endCoHost(state, personId, "co-host-revoked", now);
}

function stepDown(state: RoomState, actor: Actor, now: number): ApplyResult {
  const personId = coHostOf(state, actor)?.personId;
  if (personId === undefined) return rejected(state, NOT_CO_HOST);
  return endCoHost(state, personId, "co-host-stepped-down", now);
}

/**
 * Someone stops being a Co-Host. If they were sitting out the Round in
 * progress, they're Playing from its next Prompt, like anyone who joins mid-Round.
 */
function endCoHost(
  state: RoomState,
  personId: string,
  type: "co-host-revoked" | "co-host-stepped-down",
  now: number,
): ApplyResult {
  return {
    state: {
      ...state,
      coHosts: withoutCoHost(state, personId),
      round: state.round ? stopSittingOut(state.round, personId) : null,
    },
    recapEvents: [{ at: now, type, personId }],
  };
}

/** Between Rounds, a Co-Host chooses whether they're Playing the next Round. */
function setCoHostPlaying(state: RoomState, playing: boolean, actor: Actor): ApplyResult {
  const coHost = coHostOf(state, actor);
  if (!coHost) return rejected(state, NOT_CO_HOST);
  if (state.round) {
    return rejected(state, {
      code: "round-in-progress",
      message: "You can choose whether you're Playing once this Round is over.",
    });
  }
  if (coHost.playing === playing) return unchanged(state);
  return {
    state: {
      ...state,
      coHosts: state.coHosts.map((c) => (c.personId === coHost.personId ? { ...c, playing } : c)),
    },
    recapEvents: [],
  };
}

function changeLineup(state: RoomState, intent: LineupIntent, actor: Actor): ApplyResult {
  if (!canRunRoom(state, actor)) return rejected(state, notRunner("edit the Lineup"));
  const personIds = waitingRoomPeople(state).map((p) => p.id);
  const result = editLineup(state.lineup, intent, { personIds });
  if ("rejection" in result) return rejected(state, result.rejection);
  return { state: { ...state, lineup: result.lineup }, recapEvents: [] };
}

function beginRound(
  state: RoomState,
  hostPlaying: boolean,
  actor: Actor,
  now: number,
): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("start a Round"));
  if (state.phase !== "live") return rejected(state, ROOM_NOT_LIVE);
  if (state.round) {
    return rejected(state, {
      code: "round-in-progress",
      message: "A Round is already being played.",
    });
  }
  const round = nextRound(state.lineup, state.playedRoundIds);
  if (!round) {
    return rejected(state, {
      code: "no-round-to-start",
      message: "Every Round in the Lineup has been played. Add a Round to play another.",
    });
  }
  const sittingOut = state.coHosts.filter((c) => !c.playing).map((c) => c.personId);
  const started = startRound(round, hostPlaying, sittingOut, roundPeople(state));
  if ("rejection" in started) return rejected(state, started.rejection);
  return withRound({ ...state, playedRoundIds: [...state.playedRoundIds, round.id] }, started, now);
}

function playCurrentRound(
  state: RoomState,
  intent: RoundIntent,
  actor: Actor,
  now: number,
): ApplyResult {
  const you = identify(state, actor);
  if (!("personId" in you)) return rejected(state, NOT_IN_ROOM);
  // Spectators watch: they never place themselves, take the chair, vote or set a Mood.
  if (you.role === "spectator") return rejected(state, SPECTATORS_WATCH);
  if (!state.round) return rejected(state, NO_ROUND);
  return withRound(
    state,
    playRound(state.round, intent, you.personId, roundPeople(state), now),
    now,
  );
}

/** A control for running the current Round, for the Host and Co-Hosts. */
function runCurrentRound(
  state: RoomState,
  actor: Actor,
  action: string,
  now: number,
  control: (round: CurrentRound) => RoundOutcome,
): ApplyResult {
  if (!canRunRoom(state, actor)) return rejected(state, notRunner(action));
  if (!state.round) return rejected(state, NO_ROUND);
  return withRound(state, control(state.round), now);
}

function controlFloor(
  state: RoomState,
  intent: FloorControlIntent,
  actor: Actor,
  now: number,
): ApplyResult {
  if (!canRunRoom(state, actor)) return rejected(state, notRunner("give and take the Floor"));
  if (state.phase !== "live") return rejected(state, ROOM_NOT_LIVE);
  switch (intent.type) {
    case "give-floor":
      // The Floor is for the Host and Participants: Spectators only watch.
      if (!waitingRoomPeople(state).some((p) => p.id === intent.personId)) {
        return rejected(state, PERSON_NOT_FOUND);
      }
      return withFloor(state, giveFloor(state.floor, intent.personId, now), now);
    case "take-floor":
      return withFloor(state, takeFloor(state.floor, intent.personId), now);
    case "clear-floor":
      return withFloor(state, clearFloor(state.floor), now);
    case "set-floor-timer":
      return withFloor(state, setFloorTimer(state.floor, intent.seconds), now);
  }
}

/** Only Participants raise a hand: the Host gives the Floor, so can simply take it. */
function moveOwnHand(state: RoomState, intent: HandIntent, actor: Actor, now: number): ApplyResult {
  const you = identify(state, actor);
  if (you.role === "host") {
    return rejected(state, {
      code: "not-participant",
      message: "Only Participants raise a hand. As the Host, give yourself the Floor.",
    });
  }
  if (you.role === "spectator") return rejected(state, SPECTATORS_WATCH);
  if (you.role !== "participant") return rejected(state, NOT_IN_ROOM);
  if (state.phase !== "live") return rejected(state, ROOM_NOT_LIVE);
  return withFloor(state, moveHand(state.floor, you.personId, intent), now);
}

function withFloor(state: RoomState, outcome: FloorOutcome, now: number): ApplyResult {
  if ("rejection" in outcome) return rejected(state, outcome.rejection);
  return {
    state: { ...state, floor: outcome.floor },
    recapEvents: outcome.events.map((event) => ({ at: now, ...event })),
  };
}

/**
 * Applies a change to the Round. The Floor follows the Format: whoever the
 * Format's rules stop giving the Floor to loses it, and whoever they start
 * giving it to gets it. Anything the Host gave or took by hand in between stays.
 */
function withRound(state: RoomState, outcome: RoundOutcome, now: number): ApplyResult {
  if ("rejection" in outcome) return rejected(state, outcome.rejection);
  const before = state.round ? formatSpeakers(state.round) : [];
  const after = outcome.round ? formatSpeakers(outcome.round) : [];
  let floor = state.floor;
  const floorEvents: FloorEvent[] = [];
  for (const personId of before.filter((id) => !after.includes(id))) {
    const taken = takeFloor(floor, personId);
    floor = taken.floor;
    floorEvents.push(...taken.events);
  }
  for (const personId of after.filter((id) => !before.includes(id))) {
    const given = giveFloor(floor, personId, now);
    if ("rejection" in given) continue;
    floor = given.floor;
    floorEvents.push(...given.events);
  }
  return {
    state: { ...state, round: outcome.round, floor },
    recapEvents: [...outcome.events, ...floorEvents].map((event) => ({ at: now, ...event })),
  };
}

function roundPeople(state: RoomState): RoundPeople {
  const people = waitingRoomPeople(state);
  return {
    hostId: HOST_PERSON_ID,
    participantIds: state.participants.map((p) => p.id),
    nicknames: new Map(people.map((p) => [p.id, p.nickname])),
  };
}

function identify(state: RoomState, viewer: Actor): View["you"] {
  if (isHost(state, viewer)) {
    return { role: "host", personId: HOST_PERSON_ID, nickname: state.hostNickname };
  }
  const participant = findParticipant(state, viewer);
  if (participant) {
    return { role: "participant", personId: participant.id, nickname: participant.nickname };
  }
  const spectator = findSpectator(state, viewer);
  if (spectator) {
    return { role: "spectator", personId: spectator.id, nickname: spectator.nickname };
  }
  if (isRemoved(state, viewer)) return { role: "removed" };
  return { role: "visitor" };
}

function waitingRoomPeople(state: RoomState): WaitingRoomPerson[] {
  return [
    { id: HOST_PERSON_ID, nickname: state.hostNickname, isHost: true, isCoHost: false },
    ...state.participants.map((p) => asWaitingRoomPerson(p, isCoHost(state, p.id))),
  ];
}

function asWaitingRoomPerson(person: Person, coHost = false): WaitingRoomPerson {
  return { id: person.id, nickname: person.nickname, isHost: false, isCoHost: coHost };
}

function isHost(state: RoomState, actor: Actor): boolean {
  return state.hostTokens.includes(actor.token);
}

function notHost(action: string): Rejection {
  return { code: "not-host", message: `Only the Host can ${action}.` };
}

/**
 * The permission check for every control that runs Rounds (the Floor, reveals,
 * moving the Round on, Lineup edits, renaming and removing people, moving
 * people between Sides, calling aids): the Host and Co-Hosts have it.
 * Room-level controls (the PIN, opening, ending and cancelling the Room, the
 * Participant limit, granting and revoking Co-Host) check {@link isHost} instead.
 */
function canRunRoom(state: RoomState, actor: Actor): boolean {
  return isHost(state, actor) || coHostOf(state, actor) !== undefined;
}

/** The refusal for someone without {@link canRunRoom}. */
function notRunner(action: string): Rejection {
  return { code: "not-host", message: `Only the Host or a Co-Host can ${action}.` };
}

function coHostOf(state: RoomState, actor: Actor): CoHost | undefined {
  const participant = findParticipant(state, actor);
  return participant && state.coHosts.find((c) => c.personId === participant.id);
}

function isCoHost(state: RoomState, personId: string): boolean {
  return state.coHosts.some((c) => c.personId === personId);
}

function withoutCoHost(state: RoomState, personId: string | undefined): CoHost[] {
  return state.coHosts.filter((c) => c.personId !== personId);
}

const NOT_CO_HOST: Rejection = { code: "not-co-host", message: "You're not a Co-Host." };

function isRemoved(state: RoomState, actor: Actor): boolean {
  return state.removedTokens.includes(actor.token);
}

function findParticipant(state: RoomState, actor: Actor): Participant | undefined {
  return state.participants.find((p) => p.token === actor.token);
}

function findSpectator(state: RoomState, actor: Actor): Spectator | undefined {
  return state.spectators.find((s) => s.token === actor.token);
}

function nicknameOf(state: RoomState, personId: string): string | undefined {
  return everyone(state).find((p) => p.id === personId)?.nickname;
}

/** The Host, Participants and Spectators. */
function everyone(state: RoomState): WaitingRoomPerson[] {
  return [...waitingRoomPeople(state), ...state.spectators.map((s) => asWaitingRoomPerson(s))];
}

/** Whether anyone (other than `exceptPersonId`) has this nickname, ignoring case. */
function isNicknameTaken(state: RoomState, nickname: string, exceptPersonId?: string): boolean {
  const key = nickname.toLocaleLowerCase();
  return everyone(state).some(
    (p) => p.id !== exceptPersonId && p.nickname.toLocaleLowerCase() === key,
  );
}

function nicknameTaken(nickname: string): Rejection {
  return {
    code: "nickname-taken",
    message: `Someone in this Room is already called "${nickname}". Pick another nickname.`,
  };
}

const NO_ROUND: Rejection = { code: "no-round", message: "No Round is being played right now." };

const NOT_IN_ROOM: Rejection = { code: "not-in-room", message: "Join the Room to take part." };

const SPECTATORS_WATCH: Rejection = {
  code: "spectators-watch",
  message: "Spectators watch the Stage but don't take part in Rounds.",
};

const ROOM_NOT_LIVE: Rejection = { code: "room-not-open", message: "The Room isn't open." };

const ROOM_ENDED: Rejection = { code: "room-ended", message: "This Room has ended." };

const REMOVED: Rejection = { code: "removed", message: "The Host removed you from this Room." };

const PERSON_NOT_FOUND: Rejection = {
  code: "person-not-found",
  message: "That person isn't in the Room any more.",
};

const INVALID_NICKNAME: Rejection = {
  code: "nickname-invalid",
  message: `Nicknames need 1 to ${NICKNAME_MAX_LENGTH} characters.`,
};

function isValidPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;
}

function isValidLimit(limit: number): boolean {
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_PARTICIPANT_LIMIT;
}

const INVALID_LIMIT: Rejection = {
  code: "limit-invalid",
  message: `The Participant limit needs to be a whole number from 1 to ${MAX_PARTICIPANT_LIMIT}.`,
};

function unchanged(state: RoomState): ApplyResult {
  return { state, recapEvents: [] };
}

function rejected(state: RoomState, rejection: Rejection): ApplyResult {
  return { state, recapEvents: [], rejection };
}
