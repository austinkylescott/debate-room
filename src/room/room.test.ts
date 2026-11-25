import { describe, expect, it } from "vite-plus/test";
import { apply, createRoom, type Actor, type Intent, type RoomState, viewFor } from "./room";

const HOST_SECRET = "host-secret-123";
const hostDevice: Actor = { token: "host-device" };
const alexDevice: Actor = { token: "alex-device" };
const samDevice: Actor = { token: "sam-device" };

function newRoom(hostNickname = "Jordan"): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname });
  if ("rejection" in created) throw new Error(created.rejection.message);
  return created.state;
}

/** Applies intents in order, failing loudly if any is rejected. */
function run(state: RoomState, ...steps: [Intent, Actor][]): RoomState {
  return steps.reduce((current, [intent, actor], i) => {
    const result = apply(current, intent, actor, 2_000 + i);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

const claimHost = (hostSecret = HOST_SECRET): Intent => ({ type: "claim-host", hostSecret });
const openRoom: Intent = { type: "open-room" };
const join = (nickname: string): Intent => ({ type: "join", nickname });

function liveRoom(): RoomState {
  return run(newRoom(), [claimHost(), hostDevice], [openRoom, hostDevice]);
}

function nicknamesSeenBy(state: RoomState, viewer: Actor): string[] {
  return viewFor(state, viewer).waitingRoom?.people.map((p) => p.nickname) ?? [];
}

describe("creating a Room", () => {
  it("starts in Planning", () => {
    expect(viewFor(newRoom(), hostDevice).phase).toBe("planning");
  });

  it("needs a Host nickname", () => {
    const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "   " });
    expect("rejection" in created && created.rejection.code).toBe("nickname-invalid");
  });
});

describe("Host recognition", () => {
  it("treats a device as a visitor until it presents the Host secret", () => {
    expect(viewFor(newRoom(), hostDevice).you).toEqual({ role: "visitor" });
  });

  it("recognises the device that presented the Host secret as the Host on every later view", () => {
    const state = run(newRoom("Jordan"), [claimHost(), hostDevice]);
    expect(viewFor(state, hostDevice).you).toEqual({
      role: "host",
      personId: "host",
      nickname: "Jordan",
    });
  });

  it("rejects a wrong Host secret and leaves the device a visitor", () => {
    const result = apply(newRoom(), claimHost("guess"), hostDevice, 2_000);
    expect(result.rejection?.code).toBe("wrong-host-secret");
    expect(viewFor(result.state, hostDevice).you.role).toBe("visitor");
  });

  it("lets the Host link work on a second device", () => {
    const laptop: Actor = { token: "host-laptop" };
    const state = run(newRoom(), [claimHost(), hostDevice], [claimHost(), laptop]);
    expect(viewFor(state, laptop).you.role).toBe("host");
    expect(viewFor(state, hostDevice).you.role).toBe("host");
  });

  it("never shows the Host secret in anyone's view", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    for (const viewer of [hostDevice, alexDevice, samDevice]) {
      expect(JSON.stringify(viewFor(state, viewer))).not.toContain(HOST_SECRET);
    }
  });
});

describe("opening the Room", () => {
  it("moves the Room from Planning to Live for everyone", () => {
    const state = liveRoom();
    expect(viewFor(state, hostDevice).phase).toBe("live");
    expect(viewFor(state, samDevice).phase).toBe("live");
  });

  it("is refused for anyone but the Host", () => {
    const result = apply(newRoom(), openRoom, alexDevice, 2_000);
    expect(result.rejection?.code).toBe("not-host");
    expect(viewFor(result.state, alexDevice).phase).toBe("planning");
  });

  it("records the opening in the Recap", () => {
    const state = run(newRoom(), [claimHost(), hostDevice]);
    const result = apply(state, openRoom, hostDevice, 5_000);
    expect(result.recapEvents).toEqual([{ at: 5_000, type: "room-opened" }]);
  });
});

describe("joining the Waiting Room", () => {
  it("is refused while the Room is in Planning", () => {
    const state = run(newRoom(), [claimHost(), hostDevice]);
    const result = apply(state, join("Alex"), alexDevice, 2_000);
    expect(result.rejection?.code).toBe("room-not-open");
    expect(viewFor(result.state, alexDevice).you.role).toBe("visitor");
  });

  it("adds a Participant that everyone in the Room sees", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice], [join("Sam"), samDevice]);
    expect(viewFor(state, alexDevice).you).toMatchObject({
      role: "participant",
      nickname: "Alex",
    });
    for (const viewer of [hostDevice, alexDevice, samDevice]) {
      expect(nicknamesSeenBy(state, viewer)).toEqual(["Jordan", "Alex", "Sam"]);
    }
  });

  it("marks the Host in the Waiting Room list", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    const people = viewFor(state, alexDevice).waitingRoom?.people ?? [];
    expect(people.filter((p) => p.isHost).map((p) => p.nickname)).toEqual(["Jordan"]);
  });

  it("doesn't show the Waiting Room list to someone who hasn't joined", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    expect(viewFor(state, samDevice).waitingRoom).toBeNull();
  });

  it("tidies whitespace in nicknames", () => {
    const state = run(liveRoom(), [join("  Alex   B  "), alexDevice]);
    expect(nicknamesSeenBy(state, alexDevice)).toContain("Alex B");
  });

  it("rejects an empty or overly long nickname", () => {
    expect(apply(liveRoom(), join(""), alexDevice, 2_000).rejection?.code).toBe("nickname-invalid");
    expect(apply(liveRoom(), join("x".repeat(21)), alexDevice, 2_000).rejection?.code).toBe(
      "nickname-invalid",
    );
  });

  it("records the join in the Recap", () => {
    const result = apply(liveRoom(), join("Alex"), alexDevice, 7_000);
    expect(result.recapEvents).toEqual([
      { at: 7_000, type: "person-joined", personId: expect.any(String), nickname: "Alex" },
    ]);
  });

  it("doesn't add the Host's device a second time as a Participant", () => {
    const result = apply(liveRoom(), join("Jordan 2"), hostDevice, 2_000);
    expect(result.rejection?.code).toBe("already-in-room");
    expect(nicknamesSeenBy(result.state, hostDevice)).toEqual(["Jordan"]);
  });
});

describe("nickname uniqueness", () => {
  it("rejects a nickname another Participant already has, with a clear message", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    const result = apply(state, join("Alex"), samDevice, 3_000);
    expect(result.rejection?.code).toBe("nickname-taken");
    expect(result.rejection?.message).toContain("Alex");
    expect(viewFor(result.state, samDevice).you.role).toBe("visitor");
  });

  it("ignores case and extra spaces when comparing nicknames", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    expect(apply(state, join(" ALEX "), samDevice, 3_000).rejection?.code).toBe("nickname-taken");
  });

  it("counts the Host's nickname as taken", () => {
    expect(apply(liveRoom(), join("jordan"), alexDevice, 2_000).rejection?.code).toBe(
      "nickname-taken",
    );
  });
});

describe("reconnecting by token", () => {
  it("restores the same Participant when the device comes back", () => {
    const joined = apply(liveRoom(), join("Alex"), alexDevice, 3_000);
    const [event] = joined.recapEvents;
    const joinedAs = event?.type === "person-joined" ? event.personId : undefined;
    // A refresh is a fresh connection that presents the same device token.
    expect(viewFor(joined.state, { token: "alex-device" }).you).toEqual({
      role: "participant",
      personId: joinedAs,
      nickname: "Alex",
    });
  });

  it("treats a different device as someone new", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    expect(viewFor(state, { token: "alex-other-phone" }).you).toEqual({ role: "visitor" });
  });

  it("doesn't add a duplicate entry when the same device joins again", () => {
    const first = run(liveRoom(), [join("Alex"), alexDevice]);
    const again = apply(first, join("Alex"), alexDevice, 3_000);
    expect(again.rejection).toBeUndefined();
    expect(again.recapEvents).toEqual([]);
    expect(nicknamesSeenBy(again.state, hostDevice)).toEqual(["Jordan", "Alex"]);
  });

  it("lets the Host link take over a device that had joined as a Participant", () => {
    // The Host joined through the invite link on their phone before using the Host link there.
    const hostPhone: Actor = { token: "host-phone" };
    const state = run(liveRoom(), [join("Jordan's phone"), hostPhone], [claimHost(), hostPhone]);
    expect(viewFor(state, hostPhone).you.role).toBe("host");
    expect(nicknamesSeenBy(state, hostDevice)).toEqual(["Jordan"]);
  });
});
