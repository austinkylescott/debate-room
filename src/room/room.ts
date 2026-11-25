// The Room module: all Room logic, pure and dependency-free.
//
// The Durable Object (worker/room-server.ts) only adapts this module: it maps
// connections to actors, persists state and sends each connection its own
// `viewFor` result. Tests drive `createRoom`, `apply` and `viewFor` directly.

import {
  editLineup,
  emptyLineup,
  forgetPerson,
  isLineupIntent,
  type Lineup,
  type LineupIntent,
  type LineupRejectionCode,
  parseLineupIntent,
  type Round,
} from "./lineup";

export type Phase = "planning" | "live" | "ended";

/** Who sent an intent: identified by the per-device token kept in local storage. */
export interface Actor {
  token: string;
}

export type Intent =
  | { type: "claim-host"; hostSecret: string }
  | { type: "claim-host-pin"; pin: string }
  | { type: "open-room" }
  | { type: "set-participant-limit"; limit: number }
  | { type: "join"; nickname: string }
  | { type: "rename-person"; personId: string; nickname: string }
  | { type: "remove-person"; personId: string }
  | LineupIntent;

export type RejectionCode =
  | "nickname-invalid"
  | "nickname-taken"
  | "pin-invalid"
  | "limit-invalid"
  | "room-full"
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
  | LineupRejectionCode;

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type RecapEvent =
  | { at: number; type: "room-opened" }
  | { at: number; type: "person-joined"; personId: string; nickname: string }
  | { at: number; type: "person-renamed"; personId: string; from: string; to: string }
  | { at: number; type: "person-removed"; personId: string; nickname: string };

interface Participant {
  id: string;
  nickname: string;
  token: string;
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
  /** Device tokens the Host removed from the Room. They can't join again. */
  removedTokens: string[];
  /** The most Participants the Room allows, set by the Host. */
  participantLimit: number;
  nextParticipantNumber: number;
  lineup: Lineup;
}

export interface ApplyResult {
  state: RoomState;
  recapEvents: RecapEvent[];
  rejection?: Rejection;
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

export interface WaitingRoomPerson {
  id: string;
  nickname: string;
  isHost: boolean;
}

export interface View {
  phase: Phase;
  you:
    | { role: "host"; personId: string; nickname: string }
    | { role: "participant"; personId: string; nickname: string }
    | { role: "visitor" }
    /** The Host removed this device from the Room. */
    | { role: "removed" };
  /** How full the Room is. Shown to everyone, so visitors can see it's full. */
  capacity: { joined: number; limit: number };
  /** Everyone in the Room, for people who are in it. Null for visitors. */
  waitingRoom: { people: WaitingRoomPerson[] } | null;
  /** The whole Lineup, for the Host. Null for everyone else. */
  lineup: Round[] | null;
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

export function createRoom(
  input: CreateRoomInput,
): { state: RoomState } | { rejection: Rejection } {
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
      removedTokens: [],
      participantLimit,
      nextParticipantNumber: 1,
      lineup: emptyLineup(),
    },
  };
}

export function apply(state: RoomState, intent: Intent, actor: Actor, now: number): ApplyResult {
  // A removed device can do nothing in the Room (not even guess the PIN),
  // except present the Host link, which always grants the Host role.
  if (isRemoved(state, actor) && intent.type !== "claim-host") return rejected(state, REMOVED);
  if (isLineupIntent(intent)) return changeLineup(state, intent, actor);
  switch (intent.type) {
    case "claim-host":
      return claimHost(state, intent.hostSecret, actor);
    case "claim-host-pin":
      return claimHostWithPin(state, intent.pin, actor, now);
    case "open-room":
      return openRoom(state, actor, now);
    case "set-participant-limit":
      return setParticipantLimit(state, intent.limit, actor);
    case "join":
      return join(state, intent.nickname, actor, now);
    case "rename-person":
      return renamePerson(state, intent.personId, intent.nickname, actor, now);
    case "remove-person":
      return removePerson(state, intent.personId, actor, now);
  }
}

export function viewFor(state: RoomState, viewer: Actor): View {
  const you = identify(state, viewer);
  const inRoom = you.role === "host" || you.role === "participant";
  return {
    phase: state.phase,
    you,
    capacity: { joined: state.participants.length, limit: state.participantLimit },
    waitingRoom: inRoom ? { people: waitingRoomPeople(state) } : null,
    lineup: you.role === "host" ? state.lineup.rounds : null,
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
      return { type: "open-room" };
    case "set-participant-limit":
      return typeof value.limit === "number"
        ? { type: "set-participant-limit", limit: value.limit }
        : null;
    case "join":
      return typeof value.nickname === "string" ? { type: "join", nickname: value.nickname } : null;
    case "rename-person":
      return typeof value.personId === "string" && typeof value.nickname === "string"
        ? { type: "rename-person", personId: value.personId, nickname: value.nickname }
        : null;
    case "remove-person":
      return typeof value.personId === "string"
        ? { type: "remove-person", personId: value.personId }
        : null;
    default:
      return parseLineupIntent(value);
  }
}

/** Fills in what a Room stored by an earlier version of the app is missing. */
export function upgradeState(stored: RoomState): RoomState {
  return stored.lineup ? stored : { ...stored, lineup: emptyLineup() };
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
 * already joined from this device as a Participant, that entry gives way: the
 * Host is listed in the Waiting Room as the Host.
 */
function grantHost(state: RoomState, actor: Actor): ApplyResult {
  return {
    state: {
      ...state,
      hostTokens: [...state.hostTokens, actor.token],
      participants: state.participants.filter((p) => p.token !== actor.token),
    },
    recapEvents: [],
  };
}

function openRoom(state: RoomState, actor: Actor, now: number): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("open the Room"));
  if (state.phase !== "planning") return unchanged(state);
  return {
    state: { ...state, phase: "live" },
    recapEvents: [{ at: now, type: "room-opened" }],
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

function join(state: RoomState, rawNickname: string, actor: Actor, now: number): ApplyResult {
  if (isHost(state, actor)) {
    return rejected(state, {
      code: "already-in-room",
      message: "You're already in this Room as the Host.",
    });
  }
  // Rejoining from the same device restores the same Participant.
  if (findParticipant(state, actor)) return unchanged(state);
  if (state.phase === "planning") {
    return rejected(state, {
      code: "room-not-open",
      message: "This Room isn't open yet. Check back soon.",
    });
  }
  if (state.phase === "ended") {
    return rejected(state, ROOM_ENDED);
  }
  // Only Participants count for now. Once the Host can be Playing in a Round,
  // a Playing Host takes one of these places too.
  if (state.participants.length >= state.participantLimit) {
    return rejected(state, {
      code: "room-full",
      message: `This Room is full: it allows ${state.participantLimit} Participants.`,
    });
  }
  const nickname = normalizeNickname(rawNickname);
  if (nickname === null) return rejected(state, INVALID_NICKNAME);
  if (isNicknameTaken(state, nickname)) return rejected(state, nicknameTaken(nickname));
  const participant: Participant = {
    id: `p${state.nextParticipantNumber}`,
    nickname,
    token: actor.token,
  };
  return {
    state: {
      ...state,
      participants: [...state.participants, participant],
      nextParticipantNumber: state.nextParticipantNumber + 1,
    },
    recapEvents: [{ at: now, type: "person-joined", personId: participant.id, nickname }],
  };
}

function renamePerson(
  state: RoomState,
  personId: string,
  rawNickname: string,
  actor: Actor,
  now: number,
): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("rename people"));
  const from = nicknameOf(state, personId);
  if (from === undefined) return rejected(state, PERSON_NOT_FOUND);
  const nickname = normalizeNickname(rawNickname);
  if (nickname === null) return rejected(state, INVALID_NICKNAME);
  if (isNicknameTaken(state, nickname, personId)) return rejected(state, nicknameTaken(nickname));
  if (nickname === from) return unchanged(state);
  const renamed: RoomState =
    personId === HOST_PERSON_ID
      ? { ...state, hostNickname: nickname }
      : {
          ...state,
          participants: state.participants.map((p) => (p.id === personId ? { ...p, nickname } : p)),
        };
  return {
    state: renamed,
    recapEvents: [{ at: now, type: "person-renamed", personId, from, to: nickname }],
  };
}

function removePerson(state: RoomState, personId: string, actor: Actor, now: number): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("remove people"));
  if (personId === HOST_PERSON_ID) {
    return rejected(state, {
      code: "cant-remove-host",
      message: "The Host can't be removed from their own Room.",
    });
  }
  const participant = state.participants.find((p) => p.id === personId);
  if (!participant) return rejected(state, PERSON_NOT_FOUND);
  return {
    state: {
      ...state,
      participants: state.participants.filter((p) => p.id !== personId),
      removedTokens: [...state.removedTokens, participant.token],
      lineup: forgetPerson(state.lineup, personId),
    },
    recapEvents: [{ at: now, type: "person-removed", personId, nickname: participant.nickname }],
  };
}

function changeLineup(state: RoomState, intent: LineupIntent, actor: Actor): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, notHost("edit the Lineup"));
  if (state.phase === "ended") return rejected(state, ROOM_ENDED);
  const personIds = waitingRoomPeople(state).map((p) => p.id);
  const result = editLineup(state.lineup, intent, { personIds });
  if ("rejection" in result) return rejected(state, result.rejection);
  return { state: { ...state, lineup: result.lineup }, recapEvents: [] };
}

function identify(state: RoomState, viewer: Actor): View["you"] {
  if (isHost(state, viewer)) {
    return { role: "host", personId: HOST_PERSON_ID, nickname: state.hostNickname };
  }
  const participant = findParticipant(state, viewer);
  if (participant) {
    return { role: "participant", personId: participant.id, nickname: participant.nickname };
  }
  if (isRemoved(state, viewer)) return { role: "removed" };
  return { role: "visitor" };
}

function waitingRoomPeople(state: RoomState): WaitingRoomPerson[] {
  return [
    { id: HOST_PERSON_ID, nickname: state.hostNickname, isHost: true },
    ...state.participants.map((p) => ({ id: p.id, nickname: p.nickname, isHost: false })),
  ];
}

function isHost(state: RoomState, actor: Actor): boolean {
  return state.hostTokens.includes(actor.token);
}

function notHost(action: string): Rejection {
  return { code: "not-host", message: `Only the Host can ${action}.` };
}

function isRemoved(state: RoomState, actor: Actor): boolean {
  return state.removedTokens.includes(actor.token);
}

function findParticipant(state: RoomState, actor: Actor): Participant | undefined {
  return state.participants.find((p) => p.token === actor.token);
}

function nicknameOf(state: RoomState, personId: string): string | undefined {
  return waitingRoomPeople(state).find((p) => p.id === personId)?.nickname;
}

/** Whether anyone (other than `exceptPersonId`) has this nickname, ignoring case. */
function isNicknameTaken(state: RoomState, nickname: string, exceptPersonId?: string): boolean {
  const key = nickname.toLocaleLowerCase();
  return waitingRoomPeople(state).some(
    (p) => p.id !== exceptPersonId && p.nickname.toLocaleLowerCase() === key,
  );
}

function nicknameTaken(nickname: string): Rejection {
  return {
    code: "nickname-taken",
    message: `Someone in this Room is already called "${nickname}". Pick another nickname.`,
  };
}

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
