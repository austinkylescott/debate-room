// Shared set-up for Room-module tests: a few devices and a way to replay intents.
import { apply, createRoom, type Actor, type Intent, type RoomState, viewFor } from "./room";

export const HOST_SECRET = "host-secret-123";
export const hostDevice: Actor = { token: "host-device" };
export const alexDevice: Actor = { token: "alex-device" };
export const samDevice: Actor = { token: "sam-device" };

export function newRoom(hostNickname = "Jordan"): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname });
  if ("rejection" in created) throw new Error(created.rejection.message);
  return created.state;
}

/** Applies intents in order, failing loudly if any is rejected. */
export function run(state: RoomState, ...steps: [Intent, Actor][]): RoomState {
  return steps.reduce((current, [intent, actor], i) => {
    const result = apply(current, intent, actor, 2_000 + i);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

export const claimHost = (hostSecret = HOST_SECRET): Intent => ({
  type: "claim-host",
  hostSecret,
});
export const openRoom: Intent = { type: "open-room" };
export const join = (nickname: string): Intent => ({ type: "join", nickname });

/** A Room in Planning whose Host has claimed it from `hostDevice`. */
export function plannedRoom(): RoomState {
  return run(newRoom(), [claimHost(), hostDevice]);
}

export function liveRoom(): RoomState {
  return run(plannedRoom(), [openRoom, hostDevice]);
}

export function nicknamesSeenBy(state: RoomState, viewer: Actor): string[] {
  return viewFor(state, viewer).waitingRoom?.people.map((p) => p.nickname) ?? [];
}
