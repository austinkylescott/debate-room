// The toasts a change in the Room shows (docs/design/components/Toast.md).
// They only ever read who is in the Room, your own role, the Lineup the Host and
// Co-Hosts already see, and the connection: never anything hidden before a reveal.
import type { View, WaitingRoomPerson } from "../room/room";
import type { ConnectionStatus } from "./useRoom";

export type RoomToastType = "info" | "success" | "warning" | "error";

export interface RoomToast {
  /** Reused so a newer toast of the same kind replaces the one showing. */
  id?: string;
  /** The icon: info a teardrop, success a sparkle, warning a diamond, error a triangle. */
  type: RoomToastType;
  /** The whole message, as screen readers hear it. */
  title: string;
  /** A person's name the title starts with, shown on one line. */
  name?: string;
  /** How long it shows, in ms; the toaster's 5 seconds when left out. */
  duration?: number;
  /** The one action: "retry" reconnects. Toasts without one get a close button. */
  action?: "retry";
  /** The close button's label. */
  close?: string;
}

export type ChangeSource = Pick<View, "you" | "waitingRoom">;
export type SavedSource = Pick<View, "lineup" | "capacity">;

/** Past this many at once, a toast counts people instead of naming them. */
const NAMED_AT_ONCE = 2;

function everyone(view: ChangeSource): WaitingRoomPerson[] {
  const room = view.waitingRoom;
  return room ? [...room.people, ...room.spectators] : [];
}

function arrivals(from: WaitingRoomPerson[], to: WaitingRoomPerson[], yourId: string | null) {
  const known = new Set(from.map((p) => p.id));
  return to.filter((p) => !known.has(p.id) && p.id !== yourId);
}

function announce(people: WaitingRoomPerson[], verb: "joined" | "left"): RoomToast[] {
  if (people.length > NAMED_AT_ONCE) {
    return [{ type: "info", title: `${people.length} people ${verb} the Room`, close: "Dismiss" }];
  }
  return people.map((p) => ({
    type: "info",
    title: `${p.nickname} ${verb} the Room`,
    name: p.nickname,
    close: "Dismiss",
  }));
}

/** People joining and leaving, and you being moved to Spectators. */
export function changeToasts(before: ChangeSource | null, after: ChangeSource): RoomToast[] {
  if (!before?.waitingRoom || !after.waitingRoom) return [];
  const yourId = "personId" in after.you ? after.you.personId : null;
  const was = everyone(before);
  const now = everyone(after);
  const toasts = [...announce(arrivals(was, now, yourId), "joined")];
  toasts.push(...announce(arrivals(now, was, yourId), "left"));
  if (before.you.role === "participant" && after.you.role === "spectator") {
    toasts.push({ type: "warning", title: "You were moved to Spectators", close: "OK" });
  }
  return toasts;
}

function roundsReady(count: number): string {
  if (count === 0) return "No Rounds yet.";
  return `${count} ${count === 1 ? "Round" : "Rounds"} ready.`;
}

/** Confirms a change you sent, once the Room shows it. */
export function savedToast(
  what: "lineup" | "settings",
  before: SavedSource,
  after: SavedSource,
): RoomToast | null {
  if (what === "lineup") {
    if (!after.lineup || JSON.stringify(before.lineup) === JSON.stringify(after.lineup))
      return null;
    return {
      id: "saved-lineup",
      type: "success",
      title: `Lineup saved. ${roundsReady(after.lineup.length)}`,
      close: "Dismiss",
    };
  }
  if (before.capacity.limit === after.capacity.limit) return null;
  return {
    id: "saved-settings",
    type: "success",
    title: `Participant limit saved: ${after.capacity.limit}.`,
    close: "Dismiss",
  };
}

/** The connection dropping, which stays until it's back, and coming back. */
export function connectionToast(
  before: ConnectionStatus,
  after: ConnectionStatus,
): RoomToast | null {
  if (before === "open" && after === "reconnecting") {
    return {
      id: "connection",
      type: "error",
      title: "Connection lost. Reconnecting…",
      duration: Infinity,
      action: "retry",
    };
  }
  if (before === "reconnecting" && after === "open") {
    return { id: "connection", type: "success", title: "Reconnected", close: "Dismiss" };
  }
  return null;
}
