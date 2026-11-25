// The Room module: all Room logic, pure and dependency-free.
//
// The Durable Object (worker/room-server.ts) only adapts this module: it maps
// connections to actors, persists state and sends each connection its own
// `viewFor` result. Tests drive `createRoom`, `apply` and `viewFor` directly.

export type Phase = "planning" | "live" | "ended";

/** Who sent an intent: identified by the per-device token kept in local storage. */
export interface Actor {
  token: string;
}

export type Intent =
  | { type: "claim-host"; hostSecret: string }
  | { type: "open-room" }
  | { type: "join"; nickname: string };

export type RejectionCode =
  | "nickname-invalid"
  | "nickname-taken"
  | "room-not-open"
  | "not-host"
  | "wrong-host-secret"
  | "already-in-room";

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type RecapEvent =
  | { at: number; type: "room-opened" }
  | { at: number; type: "person-joined"; personId: string; nickname: string };

interface Participant {
  id: string;
  nickname: string;
  token: string;
  joinedAt: number;
}

/** Internal state. Never sent to clients as-is: clients only see `viewFor`. */
export interface RoomState {
  phase: Phase;
  createdAt: number;
  hostSecret: string;
  hostNickname: string;
  /** Device tokens recognised as the Host (one per device the Host has used). */
  hostTokens: string[];
  participants: Participant[];
  nextParticipantNumber: number;
}

export interface ApplyResult {
  state: RoomState;
  recapEvents: RecapEvent[];
  rejection?: Rejection;
}

export const HOST_PERSON_ID = "host";
export const NICKNAME_MAX_LENGTH = 20;

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
    | { role: "visitor" };
  /** Everyone in the Room, for people who are in it. Null for visitors. */
  waitingRoom: { people: WaitingRoomPerson[] } | null;
}

export function createRoom(
  input: { hostSecret: string; hostNickname: string },
  now: number,
): { state: RoomState } | { rejection: Rejection } {
  const nickname = normalizeNickname(input.hostNickname);
  if (nickname === null) return { rejection: invalidNickname() };
  return {
    state: {
      phase: "planning",
      createdAt: now,
      hostSecret: input.hostSecret,
      hostNickname: nickname,
      hostTokens: [],
      participants: [],
      nextParticipantNumber: 1,
    },
  };
}

export function apply(state: RoomState, intent: Intent, actor: Actor, now: number): ApplyResult {
  switch (intent.type) {
    case "claim-host":
      return claimHost(state, intent.hostSecret, actor);
    case "open-room":
      return openRoom(state, actor, now);
    case "join":
      return join(state, intent.nickname, actor, now);
  }
}

export function viewFor(state: RoomState, viewer: Actor): View {
  const you = identify(state, viewer);
  const inRoom = you.role !== "visitor";
  return {
    phase: state.phase,
    you,
    waitingRoom: inRoom ? { people: waitingRoomPeople(state) } : null,
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
    case "open-room":
      return { type: "open-room" };
    case "join":
      return typeof value.nickname === "string" ? { type: "join", nickname: value.nickname } : null;
    default:
      return null;
  }
}

/** Trims and collapses whitespace. Returns null if the result is empty or too long. */
export function normalizeNickname(raw: string): string | null {
  const nickname = raw.trim().replace(/\s+/g, " ");
  if (nickname.length === 0 || nickname.length > NICKNAME_MAX_LENGTH) return null;
  return nickname;
}

function claimHost(state: RoomState, hostSecret: string, actor: Actor): ApplyResult {
  if (isHost(state, actor)) return unchanged(state);
  if (hostSecret !== state.hostSecret) {
    return rejected(state, "wrong-host-secret", "That Host link isn't valid for this Room.");
  }
  if (findParticipant(state, actor)) {
    return rejected(
      state,
      "already-in-room",
      "This device already joined the Room as a Participant, so it can't become the Host.",
    );
  }
  return {
    state: { ...state, hostTokens: [...state.hostTokens, actor.token] },
    recapEvents: [],
  };
}

function openRoom(state: RoomState, actor: Actor, now: number): ApplyResult {
  if (!isHost(state, actor)) return rejected(state, "not-host", "Only the Host can open the Room.");
  if (state.phase !== "planning") return unchanged(state);
  return {
    state: { ...state, phase: "live" },
    recapEvents: [{ at: now, type: "room-opened" }],
  };
}

function join(state: RoomState, rawNickname: string, actor: Actor, now: number): ApplyResult {
  if (isHost(state, actor)) {
    return rejected(state, "already-in-room", "You're already in this Room as the Host.");
  }
  // Rejoining from the same device restores the same Participant.
  if (findParticipant(state, actor)) return unchanged(state);
  if (state.phase !== "live") {
    return rejected(state, "room-not-open", "This Room isn't open yet. Check back soon.");
  }
  const nickname = normalizeNickname(rawNickname);
  if (nickname === null) return rejected(state, invalidNickname().code, invalidNickname().message);
  if (isNicknameTaken(state, nickname)) {
    return rejected(
      state,
      "nickname-taken",
      `Someone in this Room is already called "${nickname}". Pick another nickname.`,
    );
  }
  const participant: Participant = {
    id: `p${state.nextParticipantNumber}`,
    nickname,
    token: actor.token,
    joinedAt: now,
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

function identify(state: RoomState, viewer: Actor): View["you"] {
  if (isHost(state, viewer)) {
    return { role: "host", personId: HOST_PERSON_ID, nickname: state.hostNickname };
  }
  const participant = findParticipant(state, viewer);
  if (participant) {
    return { role: "participant", personId: participant.id, nickname: participant.nickname };
  }
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

function findParticipant(state: RoomState, actor: Actor): Participant | undefined {
  return state.participants.find((p) => p.token === actor.token);
}

function isNicknameTaken(state: RoomState, nickname: string): boolean {
  const key = nickname.toLocaleLowerCase();
  return [state.hostNickname, ...state.participants.map((p) => p.nickname)].some(
    (taken) => taken.toLocaleLowerCase() === key,
  );
}

function invalidNickname(): Rejection {
  return {
    code: "nickname-invalid",
    message: `Nicknames need 1 to ${NICKNAME_MAX_LENGTH} characters.`,
  };
}

function unchanged(state: RoomState): ApplyResult {
  return { state, recapEvents: [] };
}

function rejected(state: RoomState, code: RejectionCode, message: string): ApplyResult {
  return { state, recapEvents: [], rejection: { code, message } };
}
