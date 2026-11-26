import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  type Actor,
  type CreateRoomInput,
  type Intent,
  type RoomState,
  viewFor,
} from "./room";

const HOST_SECRET = "host-secret-123";
const HOST_PIN = "4821";
const hostDevice: Actor = { token: "host-device" };
const alexDevice: Actor = { token: "alex-device" };
const samDevice: Actor = { token: "sam-device" };

function newRoom(hostNickname = "Jordan", options: Partial<CreateRoomInput> = {}): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname, pin: HOST_PIN, ...options });
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
const claimHostWithPin = (pin: string): Intent => ({ type: "claim-host-pin", pin });
const openRoom: Intent = { type: "open-room" };
const join = (nickname: string): Intent => ({ type: "join", nickname });
const rename = (personId: string, nickname: string): Intent => ({
  type: "rename-person",
  personId,
  nickname,
});
const remove = (personId: string): Intent => ({ type: "remove-person", personId });
const setLimit = (limit: number): Intent => ({ type: "set-participant-limit", limit });

/** Joins `count` Participants named P1, P2, … from devices d1, d2, … */
function withParticipants(state: RoomState, count: number): RoomState {
  return run(
    state,
    ...Array.from({ length: count }, (_, i): [Intent, Actor] => [
      join(`P${i + 1}`),
      { token: `d${i + 1}` },
    ]),
  );
}

function liveRoom(): RoomState {
  return run(newRoom(), [claimHost(), hostDevice], [openRoom, hostDevice]);
}

function personIdOf(state: RoomState, viewer: Actor): string {
  const you = viewFor(state, viewer).you;
  if (!("personId" in you)) throw new Error("not in the Room");
  return you.personId;
}

function nicknamesSeenBy(state: RoomState, viewer: Actor): string[] {
  return viewFor(state, viewer).waitingRoom?.people.map((p) => p.nickname) ?? [];
}

describe("creating a Room", () => {
  it("starts in Planning", () => {
    expect(viewFor(newRoom(), hostDevice).phase).toBe("planning");
  });

  it("needs a Host nickname", () => {
    const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "   ", pin: HOST_PIN });
    expect("rejection" in created && created.rejection.code).toBe("nickname-invalid");
  });

  it.each(["", "123", "1234567", "12a4", " 1234"])(
    "refuses a PIN that isn't 4 to 6 digits (%j)",
    (pin) => {
      const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin });
      expect("rejection" in created && created.rejection.code).toBe("pin-invalid");
    },
  );

  it.each(["1234", "123456"])("accepts a %s-digit PIN", (pin) => {
    expect("state" in createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin })).toBe(
      true,
    );
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

describe("Host PIN recovery", () => {
  const newPhone: Actor = { token: "host-new-phone" };

  it("grants Host control on a new device that enters the right PIN", () => {
    const state = run(liveRoom(), [claimHostWithPin(HOST_PIN), newPhone]);
    expect(viewFor(state, newPhone).you).toMatchObject({ role: "host", nickname: "Jordan" });
    expect(viewFor(state, hostDevice).you.role).toBe("host");
  });

  /** Five wrong PINs from different devices, at time 10_000. */
  function lockedOutRoom(): RoomState {
    return Array.from({ length: 5 }).reduce<RoomState>(
      (state, _, i) =>
        apply(state, claimHostWithPin("0000"), { token: `guesser-${i}` }, 10_000).state,
      liveRoom(),
    );
  }

  it("rejects a wrong PIN, says how many tries are left, and leaves the device a visitor", () => {
    const result = apply(liveRoom(), claimHostWithPin("0000"), newPhone, 10_000);
    expect(result.rejection?.code).toBe("wrong-pin");
    expect(result.rejection?.message).toContain("4 tries left");
    expect(viewFor(result.state, newPhone).you.role).toBe("visitor");
  });

  it("locks PIN entry for the Room after 5 wrong PINs, even from different devices", () => {
    const result = apply(lockedOutRoom(), claimHostWithPin(HOST_PIN), newPhone, 10_001);
    expect(result.rejection?.code).toBe("pin-locked");
    expect(result.rejection?.message).toContain("10 minutes");
    expect(viewFor(result.state, newPhone).you.role).toBe("visitor");
  });

  it("reports the lockout on the attempt that triggers it", () => {
    const state = Array.from({ length: 4 }).reduce<RoomState>(
      (current) => apply(current, claimHostWithPin("0000"), newPhone, 10_000).state,
      liveRoom(),
    );
    expect(apply(state, claimHostWithPin("0000"), newPhone, 10_000).rejection?.code).toBe(
      "pin-locked",
    );
  });

  it("accepts the right PIN again once the 10-minute lockout is over", () => {
    const tenMinutesLater = 10_000 + 10 * 60_000;
    const result = apply(lockedOutRoom(), claimHostWithPin(HOST_PIN), newPhone, tenMinutesLater);
    expect(result.rejection).toBeUndefined();
    expect(viewFor(result.state, newPhone).you.role).toBe("host");
  });

  it("forgets earlier wrong PINs after a correct one", () => {
    let state = liveRoom();
    for (let i = 0; i < 4; i++)
      state = apply(state, claimHostWithPin("0000"), samDevice, 10_000).state;
    state = run(state, [claimHostWithPin(HOST_PIN), newPhone]);
    const result = apply(state, claimHostWithPin("0000"), samDevice, 10_000);
    expect(result.rejection?.code).toBe("wrong-pin");
  });

  it("still lets the Host link in during a lockout", () => {
    const result = apply(lockedOutRoom(), claimHost(), newPhone, 10_001);
    expect(viewFor(result.state, newPhone).you.role).toBe("host");
  });

  it("never shows the PIN in anyone's view", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    for (const viewer of [hostDevice, alexDevice, samDevice]) {
      expect(JSON.stringify(viewFor(state, viewer))).not.toContain(HOST_PIN);
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
      {
        at: 7_000,
        type: "person-joined",
        personId: expect.any(String),
        nickname: "Alex",
        as: "participant",
      },
    ]);
  });

  it("doesn't add the Host's device a second time as a Participant", () => {
    const result = apply(liveRoom(), join("Jordan 2"), hostDevice, 2_000);
    expect(result.rejection?.code).toBe("already-in-room");
    expect(nicknamesSeenBy(result.state, hostDevice)).toEqual(["Jordan"]);
  });
});

describe("Participant limit", () => {
  function liveRoomWithLimit(participantLimit: number): RoomState {
    return run(
      newRoom("Jordan", { participantLimit }),
      [claimHost(), hostDevice],
      [openRoom, hostDevice],
    );
  }

  it("lets 15 Participants join by default and refuses the 16th", () => {
    const full = withParticipants(liveRoom(), 15);
    const result = apply(full, join("Alex"), alexDevice, 9_000);
    expect(result.rejection?.code).toBe("room-full");
    expect(viewFor(result.state, alexDevice).you.role).toBe("visitor");
  });

  it("uses the limit the Host set when creating the Room", () => {
    const full = withParticipants(liveRoomWithLimit(2), 2);
    expect(apply(full, join("Alex"), alexDevice, 9_000).rejection?.code).toBe("room-full");
  });

  it.each([0, 51, 2.5, Number.NaN])("refuses a limit outside 1 to 50 at creation (%s)", (limit) => {
    const created = createRoom({
      hostSecret: HOST_SECRET,
      hostNickname: "Jordan",
      pin: HOST_PIN,
      participantLimit: limit,
    });
    expect("rejection" in created && created.rejection.code).toBe("limit-invalid");
  });

  it("shows everyone, including visitors, how many have joined out of the limit", () => {
    const state = withParticipants(liveRoomWithLimit(4), 3);
    expect(viewFor(state, samDevice).capacity).toEqual({ joined: 3, limit: 4 });
    expect(viewFor(state, hostDevice).capacity).toEqual({ joined: 3, limit: 4 });
  });

  it("lets the Host change the limit, and joins follow the new limit", () => {
    const state = run(withParticipants(liveRoom(), 2), [setLimit(3), hostDevice]);
    const third = run(state, [join("Alex"), alexDevice]);
    expect(apply(third, join("Sam"), samDevice, 9_000).rejection?.code).toBe("room-full");
    expect(viewFor(third, hostDevice).capacity).toEqual({ joined: 3, limit: 3 });
  });

  it("can be raised to 50 but no further", () => {
    expect(viewFor(run(liveRoom(), [setLimit(50), hostDevice]), hostDevice).capacity.limit).toBe(
      50,
    );
    expect(apply(liveRoom(), setLimit(51), hostDevice, 9_000).rejection?.code).toBe(
      "limit-invalid",
    );
  });

  it("can't be set below the number of Participants already in the Room", () => {
    const result = apply(withParticipants(liveRoom(), 3), setLimit(2), hostDevice, 9_000);
    expect(result.rejection?.code).toBe("limit-invalid");
    expect(result.rejection?.message).toContain("3");
  });

  it("can only be changed by the Host", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    expect(apply(state, setLimit(3), alexDevice, 9_000).rejection?.code).toBe("not-host");
  });

  it("still lets a Participant in a full Room reconnect", () => {
    const full = withParticipants(liveRoomWithLimit(1), 1);
    const again = apply(full, join("P1"), { token: "d1" }, 9_000);
    expect(again.rejection).toBeUndefined();
    expect(viewFor(again.state, { token: "d1" }).you.role).toBe("participant");
  });
});

describe("renaming", () => {
  const roomWithAlexAndSam = () =>
    run(liveRoom(), [join("Alxe"), alexDevice], [join("Sam"), samDevice]);

  it("lets the Host rename a Participant, and everyone sees the new nickname", () => {
    const state = roomWithAlexAndSam();
    const renamed = run(state, [rename(personIdOf(state, alexDevice), "Alex"), hostDevice]);
    for (const viewer of [hostDevice, alexDevice, samDevice]) {
      expect(nicknamesSeenBy(renamed, viewer)).toEqual(["Jordan", "Alex", "Sam"]);
    }
    expect(viewFor(renamed, alexDevice).you).toMatchObject({ nickname: "Alex" });
  });

  it("lets the Host rename themselves", () => {
    const renamed = run(liveRoom(), [rename("host", "Jo"), hostDevice]);
    expect(viewFor(renamed, hostDevice).you).toMatchObject({ role: "host", nickname: "Jo" });
  });

  it("still keeps nicknames unique", () => {
    const state = roomWithAlexAndSam();
    const result = apply(state, rename(personIdOf(state, alexDevice), "sam"), hostDevice, 9_000);
    expect(result.rejection?.code).toBe("nickname-taken");
    expect(nicknamesSeenBy(result.state, hostDevice)).toEqual(["Jordan", "Alxe", "Sam"]);
  });

  it("allows a change of case to the same person's nickname", () => {
    const state = roomWithAlexAndSam();
    const renamed = run(state, [rename(personIdOf(state, samDevice), "SAM"), hostDevice]);
    expect(nicknamesSeenBy(renamed, hostDevice)).toContain("SAM");
  });

  it("checks the new nickname like a joining one", () => {
    const state = roomWithAlexAndSam();
    expect(
      apply(state, rename(personIdOf(state, samDevice), " "), hostDevice, 9_000).rejection?.code,
    ).toBe("nickname-invalid");
  });

  it("is refused for anyone but the Host", () => {
    const state = roomWithAlexAndSam();
    const result = apply(state, rename(personIdOf(state, samDevice), "Sammy"), alexDevice, 9_000);
    expect(result.rejection?.code).toBe("not-host");
  });

  it("is refused for someone who isn't in the Room", () => {
    expect(apply(liveRoom(), rename("p99", "Ghost"), hostDevice, 9_000).rejection?.code).toBe(
      "person-not-found",
    );
  });

  it("records the rename in the Recap", () => {
    const state = roomWithAlexAndSam();
    const alexId = personIdOf(state, alexDevice);
    const result = apply(state, rename(alexId, "Alex"), hostDevice, 9_000);
    expect(result.recapEvents).toEqual([
      { at: 9_000, type: "person-renamed", personId: alexId, from: "Alxe", to: "Alex" },
    ]);
  });
});

describe("removing", () => {
  const roomWithAlexAndSam = () =>
    run(liveRoom(), [join("Alex"), alexDevice], [join("Sam"), samDevice]);

  it("takes the person out of the Waiting Room for everyone", () => {
    const state = roomWithAlexAndSam();
    const after = run(state, [remove(personIdOf(state, alexDevice)), hostDevice]);
    expect(nicknamesSeenBy(after, hostDevice)).toEqual(["Jordan", "Sam"]);
    expect(nicknamesSeenBy(after, samDevice)).toEqual(["Jordan", "Sam"]);
  });

  it("tells the removed device it was removed, and shows it nothing of the Room", () => {
    const state = roomWithAlexAndSam();
    const view = viewFor(
      run(state, [remove(personIdOf(state, alexDevice)), hostDevice]),
      alexDevice,
    );
    expect(view.you).toEqual({ role: "removed" });
    expect(view.waitingRoom).toBeNull();
  });

  it("keeps the removed device from joining again", () => {
    const state = roomWithAlexAndSam();
    const after = run(state, [remove(personIdOf(state, alexDevice)), hostDevice]);
    const result = apply(after, join("Alex again"), alexDevice, 9_000);
    expect(result.rejection?.code).toBe("removed");
    expect(nicknamesSeenBy(result.state, hostDevice)).toEqual(["Jordan", "Sam"]);
  });

  it("refuses anything else the removed device tries, such as guessing the PIN", () => {
    const state = roomWithAlexAndSam();
    const after = run(state, [remove(personIdOf(state, alexDevice)), hostDevice]);
    const result = apply(after, claimHostWithPin("0000"), alexDevice, 9_000);
    expect(result.rejection?.code).toBe("removed");
    expect(result.state).toBe(after);
  });

  it("frees the place and the nickname for someone else", () => {
    const state = withParticipants(
      run(
        newRoom("Jordan", { participantLimit: 1 }),
        [claimHost(), hostDevice],
        [openRoom, hostDevice],
      ),
      1,
    );
    const after = run(
      state,
      [remove(personIdOf(state, { token: "d1" })), hostDevice],
      [join("P1"), alexDevice],
    );
    expect(nicknamesSeenBy(after, hostDevice)).toEqual(["Jordan", "P1"]);
  });

  it("can't remove the Host", () => {
    const result = apply(liveRoom(), remove("host"), hostDevice, 9_000);
    expect(result.rejection?.code).toBe("cant-remove-host");
    expect(viewFor(result.state, hostDevice).you.role).toBe("host");
  });

  it("is refused for anyone but the Host", () => {
    const state = roomWithAlexAndSam();
    const result = apply(state, remove(personIdOf(state, samDevice)), alexDevice, 9_000);
    expect(result.rejection?.code).toBe("not-host");
    expect(viewFor(result.state, samDevice).you.role).toBe("participant");
  });

  it("is refused for someone who isn't in the Room", () => {
    expect(apply(liveRoom(), remove("p99"), hostDevice, 9_000).rejection?.code).toBe(
      "person-not-found",
    );
  });

  it("records the removal in the Recap", () => {
    const state = roomWithAlexAndSam();
    const alexId = personIdOf(state, alexDevice);
    expect(apply(state, remove(alexId), hostDevice, 9_000).recapEvents).toEqual([
      { at: 9_000, type: "person-removed", personId: alexId, nickname: "Alex" },
    ]);
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
