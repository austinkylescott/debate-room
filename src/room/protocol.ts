// Messages between a client and its Room's Durable Object. Clients send
// intents (see `Intent` in ./room); the server answers with these.
import type { Rejection, View } from "./room";

export type ServerMessage =
  /** The connection's own view, sent on connect and after every change. */
  | { type: "view"; view: View }
  /** Sent only to the connection whose intent was refused. */
  | { type: "rejected"; rejection: Rejection }
  /** There is no Room with this id. */
  | { type: "missing" };

export interface CreateRoomRequest {
  hostNickname: string;
  /** The Host's recovery PIN: 4 to 6 digits. */
  pin: string;
  /** Optional; the Room module's default applies when left out. */
  participantLimit?: number;
}

export type CreateRoomResponse =
  | { ok: true; roomId: string; hostSecret: string }
  | { ok: false; message: string };

/** Path prefix for Room WebSockets, under /api so the Worker handles them first. */
export const PARTY_PREFIX = "api/parties";
export const PARTY_NAME = "room";
