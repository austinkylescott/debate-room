// The Floor, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  parseIntent,
  type Actor,
  type Intent,
  ROOM_EXPIRY_MS,
  type RoomState,
  tick,
  type View,
  viewFor,
} from "./room";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const riley: Actor = { token: "riley-device" };
const visitor: Actor = { token: "visitor-device" };

const ALEX = "p1";
const SAM = "p2";
const RILEY = "p3";

/** Applies intents in order at the given times, failing loudly if any is rejected. */
function run(state: RoomState, ...steps: [Intent, Actor, number?][]): RoomState {
  return steps.reduce((current, [intent, actor, at], i) => {
    const result = apply(current, intent, actor, at ?? 1_000 + i);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

/** A Live Room with Alex, Sam and Riley in the Waiting Room. */
function liveRoom(): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" }, 0);
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(
    created.state,
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host],
    [{ type: "open-room" }, host],
    [{ type: "join", nickname: "Alex" }, alex],
    [{ type: "join", nickname: "Sam" }, sam],
    [{ type: "join", nickname: "Riley" }, riley],
  );
}

const give = (personId: string): Intent => ({ type: "give-floor", personId });
const take = (personId: string): Intent => ({ type: "take-floor", personId });
const clear: Intent = { type: "clear-floor" };

function floorOf(state: RoomState, viewer: Actor): NonNullable<View["floor"]> {
  const floor = viewFor(state, viewer).floor;
  if (!floor) throw new Error("no Floor in this view");
  return floor;
}

function holderIds(state: RoomState, viewer: Actor = host): string[] {
  return floorOf(state, viewer).holders.map((h) => h.personId);
}

describe("giving the Floor", () => {
  it("shows everyone in the Room who has the Floor", () => {
    const state = run(liveRoom(), [give(ALEX), host]);
    for (const viewer of [host, alex, sam, riley]) {
      expect(floorOf(state, viewer).holders).toEqual([
        { personId: ALEX, nickname: "Alex", endsAt: null, timeUp: false },
      ]);
    }
  });

  it("lets several people have the Floor at once, in the order they were given it", () => {
    const state = run(liveRoom(), [give(SAM), host], [give(ALEX), host], [give("host"), host]);
    expect(holderIds(state)).toEqual([SAM, ALEX, "host"]);
  });
});

describe("taking the Floor back", () => {
  it("takes it from one person and leaves the others speaking", () => {
    const state = run(liveRoom(), [give(ALEX), host], [give(SAM), host], [take(ALEX), host]);
    expect(holderIds(state)).toEqual([SAM]);
  });

  it("takes it from everyone at once", () => {
    const state = run(liveRoom(), [give(ALEX), host], [give(SAM), host], [clear, host]);
    expect(holderIds(state)).toEqual([]);
  });
});

describe("raised hands", () => {
  const raise: Intent = { type: "raise-hand" };
  const lower: Intent = { type: "lower-hand" };

  function handIds(state: RoomState, viewer: Actor = host): string[] {
    return floorOf(state, viewer).raisedHands.map((h) => h.personId);
  }

  it("shows raised hands in the order they were raised", () => {
    const state = run(liveRoom(), [raise, sam], [raise, riley], [raise, alex]);
    expect(floorOf(state, host).raisedHands).toEqual([
      { personId: SAM, nickname: "Sam" },
      { personId: RILEY, nickname: "Riley" },
      { personId: ALEX, nickname: "Alex" },
    ]);
  });

  it("keeps a hand's place when it is raised again", () => {
    const state = run(liveRoom(), [raise, sam], [raise, alex], [raise, sam]);
    expect(handIds(state)).toEqual([SAM, ALEX]);
  });

  it("lets a Participant lower their hand, and raise it again at the back", () => {
    const state = run(liveRoom(), [raise, sam], [raise, alex], [lower, sam], [raise, sam]);
    expect(handIds(state)).toEqual([ALEX, SAM]);
  });

  it("lowers someone's hand when they are given the Floor", () => {
    const state = run(liveRoom(), [raise, sam], [raise, alex], [give(SAM), host]);
    expect(handIds(state)).toEqual([ALEX]);
    expect(holderIds(state)).toEqual([SAM]);
  });

  it("refuses a hand from someone who already has the Floor", () => {
    const state = run(liveRoom(), [give(SAM), host]);
    expect(apply(state, raise, sam, 5_000).rejection?.code).toBe("has-floor");
  });

  it("shows raised hands to everyone in the Room", () => {
    const state = run(liveRoom(), [raise, sam]);
    expect(handIds(state, alex)).toEqual([SAM]);
  });

  it("only takes hands from Participants", () => {
    expect(apply(liveRoom(), raise, host, 5_000).rejection?.code).toBe("not-participant");
    expect(apply(liveRoom(), raise, visitor, 5_000).rejection?.code).toBe("not-in-room");
  });
});

describe("the speaking timer", () => {
  const timer = (seconds: number | null): Intent => ({ type: "set-floor-timer", seconds });

  it("is off by default", () => {
    const result = apply(liveRoom(), give(ALEX), host, 5_000);
    expect(floorOf(result.state, alex).timerSeconds).toBeNull();
    expect(floorOf(result.state, alex).holders[0]?.endsAt).toBeNull();
    // No timer to tick for: only the Room's expiry is scheduled.
    expect(result.scheduled).toBe(5_000 + ROOM_EXPIRY_MS);
  });

  it("gives each new Floor turn the set time, and asks for a tick when it runs out", () => {
    const state = run(liveRoom(), [timer(60), host]);
    const result = apply(state, give(ALEX), host, 5_000);
    expect(floorOf(result.state, sam).holders).toEqual([
      { personId: ALEX, nickname: "Alex", endsAt: 65_000, timeUp: false },
    ]);
    expect(result.scheduled).toBe(65_000);
  });

  it("asks for a tick at whichever running timer is due first", () => {
    const state = run(liveRoom(), [timer(60), host], [give(ALEX), host, 5_000]);
    expect(apply(state, give(SAM), host, 20_000).scheduled).toBe(65_000);
  });

  it("leaves turns already running alone when the Host changes it", () => {
    const state = run(liveRoom(), [timer(60), host], [give(ALEX), host, 5_000], [timer(30), host]);
    const after = run(state, [give(SAM), host, 10_000]);
    expect(floorOf(after, host).holders.map((h) => h.endsAt)).toEqual([65_000, 40_000]);
    expect(floorOf(after, host).timerSeconds).toBe(30);
  });

  it("shows everyone that time is up, without taking the Floor back", () => {
    const state = run(liveRoom(), [timer(60), host], [give(ALEX), host, 5_000]);
    expect(tick(state, 64_999).recapEvents).toEqual([]);
    const due = tick(state, 65_000);
    for (const viewer of [host, alex, sam]) {
      expect(floorOf(due.state, viewer).holders).toEqual([
        { personId: ALEX, nickname: "Alex", endsAt: 65_000, timeUp: true },
      ]);
    }
    expect(due.recapEvents).toEqual([{ at: 65_000, type: "floor-time-up", personId: ALEX }]);
    expect(due.scheduled).toBe(5_000 + ROOM_EXPIRY_MS);
  });

  it("runs out once per turn", () => {
    const state = run(liveRoom(), [timer(60), host], [give(ALEX), host, 5_000]);
    const due = tick(state, 65_000);
    expect(tick(due.state, 70_000).recapEvents).toEqual([]);
  });

  it("stops when the Floor is taken back", () => {
    const state = run(liveRoom(), [timer(60), host], [give(ALEX), host, 5_000]);
    const taken = apply(state, take(ALEX), host, 6_000);
    expect(taken.scheduled).toBe(6_000 + ROOM_EXPIRY_MS);
    expect(tick(taken.state, 65_000).recapEvents).toEqual([]);
  });

  it("can be turned off again", () => {
    const state = run(liveRoom(), [timer(60), host], [timer(null), host], [give(ALEX), host]);
    expect(floorOf(state, host).holders[0]?.endsAt).toBeNull();
  });

  it.each([0, 5, 601, 12.5, Number.NaN])("refuses a timer of %s seconds", (seconds) => {
    expect(apply(liveRoom(), timer(seconds), host, 5_000).rejection?.code).toBe("timer-invalid");
  });

  it("is set only by the Host", () => {
    expect(apply(liveRoom(), timer(60), alex, 5_000).rejection?.code).toBe("not-host");
  });
});

describe("Floor changes in the Recap", () => {
  it("records each time someone is given the Floor or has it taken back", () => {
    let state = liveRoom();
    const events = [];
    for (const [intent, at] of [
      [give(ALEX), 5_000],
      [give(SAM), 6_000],
      [give(ALEX), 6_500],
      [take(ALEX), 9_000],
      [clear, 12_000],
    ] as const) {
      const result = apply(state, intent, host, at);
      state = result.state;
      events.push(...result.recapEvents);
    }
    expect(events).toEqual([
      { at: 5_000, type: "floor-given", personId: ALEX },
      { at: 6_000, type: "floor-given", personId: SAM },
      { at: 9_000, type: "floor-taken", personId: ALEX },
      { at: 12_000, type: "floor-taken", personId: SAM },
    ]);
  });

  it("takes the Floor and the hand of someone removed from the Room", () => {
    const state = run(
      liveRoom(),
      [give(ALEX), host],
      [{ type: "raise-hand" }, sam],
      [{ type: "raise-hand" }, riley],
    );
    const removedAlex = apply(state, { type: "remove-person", personId: ALEX }, host, 7_000);
    expect(removedAlex.recapEvents).toContainEqual({
      at: 7_000,
      type: "floor-taken",
      personId: ALEX,
    });
    const removedSam = run(removedAlex.state, [{ type: "remove-person", personId: SAM }, host]);
    expect(holderIds(removedSam)).toEqual([]);
    expect(floorOf(removedSam, host).raisedHands.map((h) => h.personId)).toEqual([RILEY]);
  });
});

describe("who controls the Floor", () => {
  it("refuses a Participant who tries to give or take the Floor", () => {
    const state = run(liveRoom(), [give(SAM), host]);
    for (const intent of [give(ALEX), take(SAM), clear]) {
      expect(apply(state, intent, alex, 5_000).rejection?.code).toBe("not-host");
    }
  });

  it("only gives the Floor to someone in the Room", () => {
    expect(apply(liveRoom(), give("p99"), host, 5_000).rejection?.code).toBe("person-not-found");
  });

  it("has no Floor before the Room is Live, and shows none to visitors", () => {
    const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" }, 0);
    if ("rejection" in created) throw new Error(created.rejection.message);
    const planning = run(created.state, [{ type: "claim-host", hostSecret: HOST_SECRET }, host]);
    expect(apply(planning, give("host"), host, 5_000).rejection?.code).toBe("room-not-open");
    expect(viewFor(planning, host).floor).toBeNull();
    expect(viewFor(run(liveRoom(), [give(ALEX), host]), visitor).floor).toBeNull();
  });
});

describe("Floor intents over the wire", () => {
  it.each<Intent>([
    give(ALEX),
    take(ALEX),
    clear,
    { type: "set-floor-timer", seconds: 60 },
    { type: "set-floor-timer", seconds: null },
    { type: "raise-hand" },
    { type: "lower-hand" },
  ])("accepts %j", (intent) => {
    expect(parseIntent(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
  });

  it.each([
    { type: "give-floor" },
    { type: "take-floor", personId: 1 },
    { type: "set-floor-timer", seconds: "60" },
    { type: "set-floor-timer" },
  ])("drops a malformed one (%j)", (raw) => {
    expect(parseIntent(raw)).toBeNull();
  });
});
