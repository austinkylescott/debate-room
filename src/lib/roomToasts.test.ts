// Which toasts a change in the Room shows. Each view the server sends is built
// afresh, so these tests hand over new objects every time.
import { describe, expect, it } from "vite-plus/test";
import type { Round } from "../room/lineup";
import type { View, WaitingRoomPerson } from "../room/room";
import {
  changeToasts,
  connectionToast,
  savedToast,
  type ChangeSource,
  type SavedSource,
} from "./roomToasts";

const person = (id: string, nickname: string): WaitingRoomPerson => ({
  id,
  nickname,
  isHost: false,
  isCoHost: false,
});
const ROBIN = { ...person("h", "Robin"), isHost: true };
const ADA = person("p1", "Ada");
const LINUS = person("p2", "Linus");
const GRACE = person("p3", "Grace Hopper");
const MARGARET = person("p4", "Margaret");

function room(
  people: WaitingRoomPerson[],
  spectators: WaitingRoomPerson[] = [],
  you: View["you"] = { role: "host", personId: "h", nickname: "Robin" },
): ChangeSource {
  return { you, waitingRoom: { people: [ROBIN, ...people], spectators } };
}

describe("people joining and leaving", () => {
  it("shows nothing for the first view: everyone already there was there before you", () => {
    expect(changeToasts(null, room([ADA, LINUS]))).toEqual([]);
  });

  it("names someone who joined, as a Participant or a Spectator", () => {
    const toasts = changeToasts(room([ADA]), room([ADA, GRACE], [MARGARET]));
    expect(toasts.map((t) => t.title)).toEqual([
      "Grace Hopper joined the Room",
      "Margaret joined the Room",
    ]);
    expect(toasts[0]).toMatchObject({ type: "info", name: "Grace Hopper" });
  });

  it("names someone who left", () => {
    const toasts = changeToasts(room([ADA, LINUS]), room([ADA]));
    expect(toasts).toEqual([
      expect.objectContaining({ type: "info", title: "Linus left the Room", name: "Linus" }),
    ]);
  });

  it("counts a crowd instead of naming everyone, so it never floods the screen", () => {
    const toasts = changeToasts(room([]), room([ADA, LINUS, GRACE]));
    expect(toasts).toEqual([expect.objectContaining({ title: "3 people joined the Room" })]);
    expect(toasts[0].name).toBeUndefined();
  });

  it("stays quiet when someone is renamed or switches to Participant", () => {
    const before = room([ADA], [MARGARET]);
    const after = room([{ ...ADA, nickname: "Ada L." }, MARGARET], []);
    expect(changeToasts(before, after)).toEqual([]);
  });

  it("never announces you", () => {
    const you: View["you"] = { role: "participant", personId: "p3", nickname: "Grace Hopper" };
    expect(changeToasts(room([ADA], [], you), room([ADA, GRACE], [], you))).toEqual([]);
  });

  it("shows nothing to a visitor, who doesn't see the Waiting Room", () => {
    const visitor: ChangeSource = { you: { role: "visitor" }, waitingRoom: null };
    expect(changeToasts(visitor, visitor)).toEqual([]);
    expect(changeToasts(visitor, room([ADA]))).toEqual([]);
  });
});

describe("being moved to Spectators", () => {
  it("tells you when you go from Participant to Spectator", () => {
    const before = room([ADA], [], { role: "participant", personId: "p1", nickname: "Ada" });
    const after = room([], [ADA], { role: "spectator", personId: "p1", nickname: "Ada" });
    expect(changeToasts(before, after)).toEqual([
      expect.objectContaining({
        type: "warning",
        title: "You were moved to Spectators",
        close: "OK",
      }),
    ]);
  });

  it("stays quiet when you switch to Participant yourself", () => {
    const before = room([], [ADA], { role: "spectator", personId: "p1", nickname: "Ada" });
    const after = room([ADA], [], { role: "participant", personId: "p1", nickname: "Ada" });
    expect(changeToasts(before, after)).toEqual([]);
  });
});

describe("saving", () => {
  const round = (id: string): Round =>
    ({ id, setup: { format: "spectrum" }, prompts: [] }) as unknown as Round;
  const saved = (rounds: Round[] | null, limit = 15): SavedSource => ({
    lineup: rounds,
    capacity: { joined: 1, limit },
  });

  it("confirms the Lineup once your change arrives, with how many Rounds it holds", () => {
    expect(savedToast("lineup", saved([round("r1")]), saved([round("r1"), round("r2")]))).toEqual(
      expect.objectContaining({
        id: "saved-lineup",
        type: "success",
        title: "Lineup saved. 2 Rounds ready.",
      }),
    );
    expect(
      savedToast("lineup", saved([round("r1"), round("r2")]), saved([round("r2")]))?.title,
    ).toBe("Lineup saved. 1 Round ready.");
    expect(savedToast("lineup", saved([round("r1")]), saved([]))?.title).toBe(
      "Lineup saved. No Rounds yet.",
    );
  });

  it("waits while the Lineup hasn't changed yet", () => {
    expect(savedToast("lineup", saved([round("r1")]), saved([round("r1")]))).toBeNull();
  });

  it("confirms the Participant limit once it changes", () => {
    expect(savedToast("settings", saved(null, 15), saved(null, 12))).toEqual(
      expect.objectContaining({
        id: "saved-settings",
        type: "success",
        title: "Participant limit saved: 12.",
      }),
    );
    expect(savedToast("settings", saved(null, 15), saved(null, 15))).toBeNull();
  });
});

describe("the connection", () => {
  it("says so when the connection drops, and keeps saying it until it's back", () => {
    expect(connectionToast("open", "reconnecting")).toEqual(
      expect.objectContaining({
        id: "connection",
        type: "error",
        title: "Connection lost. Reconnecting…",
        duration: Infinity,
        action: "retry",
      }),
    );
  });

  it("says when it's back", () => {
    expect(connectionToast("reconnecting", "open")).toEqual(
      expect.objectContaining({ id: "connection", type: "success", title: "Reconnected" }),
    );
  });

  it("stays quiet on the first connection and when the Room goes away", () => {
    expect(connectionToast("connecting", "open")).toBeNull();
    expect(connectionToast("open", "missing")).toBeNull();
    expect(connectionToast("open", "removed")).toBeNull();
  });
});
