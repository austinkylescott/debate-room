// A Surrounded Round end to end, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  type Actor,
  type ApplyResult,
  type Intent,
  parseIntent,
  type RecapEvent,
  type RoomState,
  type StageView,
  tick,
  viewFor,
} from "./room";
import { CHECK_IN_MS } from "./mood";
import { summarizeRecap } from "./recap";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const riley: Actor = { token: "riley-device" };
const casey: Actor = { token: "casey-device" };

// Person ids, in join order.
const ALEX = "p1";
const SAM = "p2";
const RILEY = "p3";
const CASEY = "p4";

const EXCHANGE_SECONDS = 60;

let clock = 10_000;

function attempt(state: RoomState, intent: Intent, actor: Actor): ApplyResult {
  clock += 1;
  return apply(state, intent, actor, clock);
}

/** Applies intents in order, failing loudly if any is rejected. */
function run(state: RoomState, ...steps: [Intent, Actor][]): RoomState {
  return steps.reduce((current, [intent, actor], i) => {
    const result = attempt(current, intent, actor);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

const start = (hostPlaying = false): Intent => ({ type: "start-round", hostPlaying });
const volunteer: Intent = { type: "volunteer-center" };
const chooseCenter = (personId: string): Intent => ({ type: "choose-center", personId });
const takeChair: Intent = { type: "take-chair" };
const voteRemove = (remove = true): Intent => ({ type: "vote-remove", remove });
const yieldChair: Intent = { type: "yield-chair" };
const endExchange: Intent = { type: "end-exchange" };
const seat = (personId: string): Intent => ({ type: "seat-challenger", personId });
const advance: Intent = { type: "advance" };

/**
 * A Live Room with Alex, Sam and Riley in the Waiting Room, Casey watching as a
 * Spectator, and a Surrounded Round in the Lineup.
 */
function roomWith(options: { centerId?: string | null; prompts?: string[] } = {}): RoomState {
  return run(newRoom(), ...settingUp(options));
}

function newRoom(): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" }, 0);
  if ("rejection" in created) throw new Error(created.rejection.message);
  return created.state;
}

/** What {@link roomWith} does to a new Room. */
function settingUp(options: { centerId?: string | null; prompts?: string[] }): [Intent, Actor][] {
  const { centerId = null, prompts = ["Cereal is a soup", "A hot dog is a sandwich"] } = options;
  return [
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host],
    [{ type: "open-room" }, host],
    [{ type: "join", nickname: "Alex" }, alex],
    [{ type: "join", nickname: "Sam" }, sam],
    [{ type: "join", nickname: "Riley" }, riley],
    [{ type: "join", nickname: "Casey", as: "spectator" }, casey],
    [
      {
        type: "add-round",
        setup: { format: "surrounded", centerId, exchangeSeconds: EXCHANGE_SECONDS },
        prompts: prompts.map((text) => ({ text, surprise: false })),
      },
      host,
    ],
  ];
}

function surroundedOf(state: RoomState, viewer: Actor) {
  const stage: StageView | null = viewFor(state, viewer).stage;
  if (!stage) throw new Error("no Stage in this view");
  if (stage.format !== "surrounded") throw new Error("not a Surrounded Stage");
  return stage.surrounded;
}

function floorHolders(state: RoomState): string[] {
  return viewFor(state, host).floor?.holders.map((h) => h.personId) ?? [];
}

describe("starting a Surrounded Round", () => {
  it("puts the Center the Host picked on everyone's Stage, and gives them the Floor", () => {
    const result = attempt(roomWith({ centerId: ALEX }), start(), host);
    for (const viewer of [host, alex, sam, casey]) {
      const surrounded = surroundedOf(result.state, viewer);
      expect(surrounded.center).toEqual({ personId: ALEX, nickname: "Alex" });
      expect(surrounded.chair).toBeNull();
    }
    expect(floorHolders(result.state)).toEqual([ALEX]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "center-chosen", personId: ALEX, by: "host" }),
    );
  });
});

describe("choosing the Center", () => {
  const openToVolunteers = () => run(roomWith(), [start(), host]);

  it("leaves the Center open to volunteers when the Host didn't pick one", () => {
    expect(surroundedOf(openToVolunteers(), alex).center).toBeNull();
  });

  it("makes the first volunteer the Center, for everyone to see", () => {
    const result = attempt(openToVolunteers(), volunteer, sam);
    expect(surroundedOf(result.state, alex).center?.personId).toBe(SAM);
    expect(floorHolders(result.state)).toEqual([SAM]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "center-chosen", personId: SAM, by: "volunteer" }),
    );
    expect(attempt(result.state, volunteer, alex).rejection?.code).toBe("has-center");
  });

  it("lets the Host pick the Center during the Round, while there is none", () => {
    const result = attempt(openToVolunteers(), chooseCenter(RILEY), host);
    expect(surroundedOf(result.state, sam).center?.personId).toBe(RILEY);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "center-chosen", personId: RILEY, by: "host" }),
    );
  });

  it("refuses a Center pick from anyone but the Host", () => {
    expect(attempt(openToVolunteers(), chooseCenter(ALEX), sam).rejection?.code).toBe("not-host");
  });

  it("never makes a Spectator the Center", () => {
    const state = openToVolunteers();
    expect(attempt(state, volunteer, casey).rejection?.code).toBe("spectators-watch");
    expect(attempt(state, chooseCenter(CASEY), host).rejection?.code).toBe("spectators-watch");
  });

  it("doesn't let a Host who isn't Playing volunteer", () => {
    expect(attempt(openToVolunteers(), volunteer, host).rejection?.code).toBe("not-playing");
  });

  it("needs the Host to be Playing when they're the Center", () => {
    const state = roomWith({ centerId: "host" });
    expect(attempt(state, start(false), host).rejection?.code).toBe("center-not-playing");
    const started = run(state, [start(true), host]);
    expect(surroundedOf(started, alex).center?.personId).toBe("host");
  });

  it("keeps the same Center for every Prompt in the Round", () => {
    const state = run(roomWith({ centerId: ALEX }), [start(), host], [advance, host]);
    const nextPrompt = run(state, ...everyoneAnswersCheckIn(), [advance, host]);
    expect(viewFor(nextPrompt, alex).stage?.promptNumber).toBe(2);
    expect(surroundedOf(nextPrompt, alex).center?.personId).toBe(ALEX);
  });
});

/** A Surrounded Round under way with Alex as the Center. */
const withCenter = (hostPlaying = false) =>
  run(roomWith({ centerId: ALEX }), [start(hostPlaying), host]);

describe("taking the chair", () => {
  it("gives the chair to the first Challenger who presses, and refuses the next", () => {
    const first = attempt(withCenter(), takeChair, sam);
    const chair = surroundedOf(first.state, riley).chair;
    expect(chair?.challenger).toEqual({ personId: SAM, nickname: "Sam" });
    expect(chair?.endsAt).toBe(clock + EXCHANGE_SECONDS * 1000);
    expect(first.recapEvents).toContainEqual(
      expect.objectContaining({ type: "chair-taken", personId: SAM, by: "challenger" }),
    );
    expect(attempt(first.state, takeChair, riley).rejection?.code).toBe("chair-taken");
  });

  it("gives the Floor to the Center and the Challenger in the chair", () => {
    const state = run(withCenter(), [takeChair, sam]);
    expect(floorHolders(state)).toEqual([ALEX, SAM]);
  });

  it("takes the Floor back from the Challenger when their exchange ends", () => {
    const result = attempt(run(withCenter(), [takeChair, sam]), endExchange, host);
    expect(floorHolders(result.state)).toEqual([ALEX]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "floor-taken", personId: SAM }),
    );
  });

  it("keeps a Floor the Host gave by hand, and lets the Host take it back from the Center", () => {
    const state = run(
      withCenter(),
      [{ type: "give-floor", personId: RILEY }, host],
      [{ type: "take-floor", personId: ALEX }, host],
      [takeChair, sam],
    );
    expect(floorHolders(state)).toEqual([RILEY, SAM]);
  });

  it("doesn't let the Center take the chair", () => {
    expect(attempt(withCenter(), takeChair, alex).rejection?.code).toBe("center-cant-challenge");
  });

  it("keeps the chair closed until there is a Center", () => {
    const state = run(roomWith(), [start(), host]);
    expect(attempt(state, takeChair, sam).rejection?.code).toBe("no-center");
  });

  it("refuses a Spectator", () => {
    expect(attempt(withCenter(), takeChair, casey).rejection?.code).toBe("spectators-watch");
  });

  it("lets a Playing Host take the chair", () => {
    const state = run(withCenter(true), [takeChair, host]);
    expect(surroundedOf(state, alex).chair?.challenger.personId).toBe("host");
  });

  it("blocks the Challenger who just left until someone else has held the chair", () => {
    const left = run(withCenter(), [takeChair, sam], [yieldChair, sam]);
    expect(surroundedOf(left, riley).cooldown?.personId).toBe(SAM);
    expect(attempt(left, takeChair, sam).rejection?.code).toBe("chair-cooldown");
    const someoneElse = run(left, [takeChair, riley], [yieldChair, riley]);
    expect(surroundedOf(someoneElse, sam).cooldown?.personId).toBe(RILEY);
    const back = attempt(someoneElse, takeChair, sam);
    expect(back.rejection).toBeUndefined();
    expect(surroundedOf(back.state, sam).chair?.challenger.personId).toBe(SAM);
  });

  it("starts each Prompt with no one on cooldown", () => {
    const state = run(
      withCenter(),
      [takeChair, sam],
      [yieldChair, sam],
      [advance, host],
      ...everyoneAnswersCheckIn(),
      [advance, host],
    );
    expect(surroundedOf(state, sam).cooldown).toBeNull();
    expect(attempt(state, takeChair, sam).rejection).toBeUndefined();
  });
});

describe("the Host's chair controls", () => {
  it("ends an exchange by the Host", () => {
    const result = attempt(run(withCenter(), [takeChair, sam]), endExchange, host);
    expect(surroundedOf(result.state, sam).chair).toBeNull();
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "host" }),
    );
  });

  it("overrides who holds the chair, ending the exchange running and ignoring the cooldown", () => {
    const state = run(withCenter(), [takeChair, sam], [yieldChair, sam], [takeChair, riley]);
    const result = attempt(state, seat(SAM), host);
    expect(surroundedOf(result.state, alex).chair?.challenger.personId).toBe(SAM);
    expect(floorHolders(result.state)).toEqual([ALEX, SAM]);
    expect(result.recapEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "exchange-ended", challengerId: RILEY, endedBy: "host" }),
        expect.objectContaining({ type: "chair-taken", personId: SAM, by: "host" }),
      ]),
    );
  });

  it("refuses the chair controls from anyone but the Host", () => {
    const state = run(withCenter(), [takeChair, sam]);
    expect(attempt(state, endExchange, riley).rejection?.code).toBe("not-host");
    expect(attempt(state, seat(RILEY), riley).rejection?.code).toBe("not-host");
  });

  it("never seats a Spectator", () => {
    expect(attempt(withCenter(), seat(CASEY), host).rejection?.code).toBe("spectators-watch");
  });
});

describe("replacing the Center", () => {
  it("lets the Host replace the Center, who plays on as a Challenger", () => {
    const result = attempt(withCenter(), chooseCenter(SAM), host);
    const surrounded = surroundedOf(result.state, riley);
    expect(surrounded.center?.personId).toBe(SAM);
    expect(surrounded.challengers.map((c) => c.personId)).toEqual([ALEX, RILEY]);
    expect(attempt(result.state, takeChair, alex).rejection).toBeUndefined();
  });

  it("ends a running exchange by the Host", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, chooseCenter(RILEY), host);
    expect(surroundedOf(result.state, alex).chair).toBeNull();
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "host" }),
    );
  });

  it("can make the Challenger in the chair the Center, ending their exchange", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, chooseCenter(SAM), host);
    const surrounded = surroundedOf(result.state, alex);
    expect(surrounded.center?.personId).toBe(SAM);
    expect(surrounded.chair).toBeNull();
    expect(surrounded.cooldown).toBeNull();
  });

  it("moves the Floor to the new Center", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, chooseCenter(RILEY), host);
    expect(floorHolders(result.state)).toEqual([RILEY]);
    expect(result.recapEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "floor-taken", personId: ALEX }),
        expect.objectContaining({ type: "floor-taken", personId: SAM }),
        expect.objectContaining({ type: "floor-given", personId: RILEY }),
      ]),
    );
  });

  it("records who replaced whom in the Recap", () => {
    const result = attempt(withCenter(), chooseCenter(SAM), host);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "center-chosen",
        personId: SAM,
        by: "host",
        replacedId: ALEX,
      }),
    );
  });

  it("keeps the new Center for the following Prompts", () => {
    const state = run(
      withCenter(),
      [chooseCenter(SAM), host],
      [advance, host],
      ...everyoneAnswersCheckIn(),
      [advance, host],
    );
    expect(surroundedOf(state, alex).center?.personId).toBe(SAM);
  });

  it("needs the new Center to be Playing, and never a Spectator", () => {
    const state = withCenter();
    expect(attempt(state, chooseCenter("host"), host).rejection?.code).toBe("not-playing");
    expect(attempt(state, chooseCenter(CASEY), host).rejection?.code).toBe("spectators-watch");
  });

  it("refuses a replacement from anyone but the Host, and from a volunteer", () => {
    const state = withCenter();
    expect(attempt(state, chooseCenter(SAM), riley).rejection?.code).toBe("not-host");
    expect(attempt(state, volunteer, sam).rejection?.code).toBe("has-center");
  });
});

describe("yielding", () => {
  it.each([
    ["the Center", alex, "center"],
    ["the Challenger", sam, "challenger"],
  ] as const)("lets %s yield, ending the exchange", (_who, actor, yieldedBy) => {
    const result = attempt(run(withCenter(), [takeChair, sam]), yieldChair, actor);
    expect(surroundedOf(result.state, riley).chair).toBeNull();
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", endedBy: "yield", yieldedBy }),
    );
  });

  it("refuses a yield from anyone else", () => {
    const state = run(withCenter(), [takeChair, sam]);
    expect(attempt(state, yieldChair, riley).rejection?.code).toBe("cant-yield");
    expect(attempt(state, yieldChair, casey).rejection?.code).toBe("spectators-watch");
  });
});

describe("the exchange timer", () => {
  it("ends the exchange when it runs out, on the tick", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const endsAt = surroundedOf(state, alex).chair!.endsAt;
    expect(tick(state, endsAt - 1).state).toBe(state);
    const ticked = tick(state, endsAt);
    expect(surroundedOf(ticked.state, alex).chair).toBeNull();
    expect(surroundedOf(ticked.state, alex).cooldown?.personId).toBe(SAM);
    expect(floorHolders(ticked.state)).toEqual([ALEX]);
    expect(ticked.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "timer" }),
    );
  });

  it("schedules the tick for the exchange's end", () => {
    const result = attempt(withCenter(), takeChair, sam);
    expect(result.scheduled).toBe(clock + EXCHANGE_SECONDS * 1000);
  });

  it("schedules a sooner Floor timer first, then the exchange's end", () => {
    const state = run(withCenter(), [{ type: "set-floor-timer", seconds: 10 }, host]);
    const result = attempt(state, takeChair, sam);
    // Sam's Floor turn has a 10 second speaking timer; the exchange lasts a minute.
    const floorTimeUp = clock + 10_000;
    const exchangeEnd = clock + EXCHANGE_SECONDS * 1000;
    expect(result.scheduled).toBe(floorTimeUp);
    const afterFloor = tick(result.state, floorTimeUp);
    expect(afterFloor.recapEvents).toContainEqual(
      expect.objectContaining({ type: "floor-time-up", personId: SAM }),
    );
    expect(surroundedOf(afterFloor.state, alex).chair).not.toBeNull();
    expect(afterFloor.scheduled).toBe(exchangeEnd);
    expect(tick(afterFloor.state, exchangeEnd).recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", endedBy: "timer" }),
    );
  });

  it("schedules a sooner exchange end before a later Floor timer", () => {
    const state = run(withCenter(), [{ type: "set-floor-timer", seconds: 120 }, host]);
    const result = attempt(state, takeChair, sam);
    expect(result.scheduled).toBe(clock + EXCHANGE_SECONDS * 1000);
  });

  it("ends a running exchange when the Prompt ends, and schedules the Mood Check-in", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, advance, host);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "host" }),
    );
    expect(result.scheduled).toBe(clock + CHECK_IN_MS);
    expect(floorHolders(result.state)).toEqual([]);
  });
});

describe("removal votes", () => {
  const taylor: Actor = { token: "taylor-device" };
  const morgan: Actor = { token: "morgan-device" };

  /**
   * Alex is the Center and Sam in the chair, with Riley, Taylor and Morgan as
   * the Challengers not in the chair (and the Host too, if Playing).
   */
  const samInTheChair = (hostPlaying: boolean) =>
    run(
      roomWith({ centerId: ALEX }),
      [{ type: "join", nickname: "Taylor" }, taylor],
      [{ type: "join", nickname: "Morgan" }, morgan],
      [start(hostPlaying), host],
      [takeChair, sam],
    );

  it("removes the Challenger at a majority of the Challengers not in the chair", () => {
    // Riley, Taylor and Morgan: 2 of 3 is a majority.
    const oneVote = run(samInTheChair(false), [voteRemove(), riley]);
    const chair = surroundedOf(oneVote, casey).chair;
    expect(chair?.votes.map((v) => v.personId)).toEqual([RILEY]);
    expect(chair?.votesNeeded).toBe(2);
    const removed = attempt(oneVote, voteRemove(), taylor);
    expect(surroundedOf(removed.state, alex).chair).toBeNull();
    expect(floorHolders(removed.state)).toEqual([ALEX]);
    expect(removed.recapEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "removal-vote", personId: "p5", challengerId: SAM }),
        expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "vote" }),
      ]),
    );
  });

  it("counts a Playing Host among the voters", () => {
    // The Host, Riley, Taylor and Morgan: it takes 3 of 4.
    const twoVotes = run(samInTheChair(true), [voteRemove(), riley], [voteRemove(), taylor]);
    expect(surroundedOf(twoVotes, alex).chair?.votesNeeded).toBe(3);
    expect(surroundedOf(twoVotes, alex).chair).not.toBeNull();
    const removed = attempt(twoVotes, voteRemove(), host);
    expect(surroundedOf(removed.state, alex).chair).toBeNull();
  });

  it("doesn't let a Host who isn't Playing vote", () => {
    expect(attempt(samInTheChair(false), voteRemove(), host).rejection?.code).toBe("cant-vote");
  });

  it("never lets a Spectator vote", () => {
    const result = attempt(samInTheChair(false), voteRemove(), casey);
    expect(result.rejection?.code).toBe("spectators-watch");
  });

  it("doesn't let the Center or the Challenger vote", () => {
    const state = samInTheChair(false);
    expect(attempt(state, voteRemove(), alex).rejection?.code).toBe("cant-vote");
    expect(attempt(state, voteRemove(), sam).rejection?.code).toBe("cant-vote");
  });

  it("lets a voter take their vote back", () => {
    const result = attempt(
      run(samInTheChair(false), [voteRemove(), riley]),
      voteRemove(false),
      riley,
    );
    expect(surroundedOf(result.state, alex).chair?.votes).toEqual([]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "removal-vote", personId: RILEY, remove: false }),
    );
  });

  it("refuses a vote with nobody in the chair", () => {
    expect(attempt(withCenter(), voteRemove(), sam).rejection?.code).toBe("no-exchange");
  });

  it("starts each exchange with no votes", () => {
    const state = run(
      samInTheChair(false),
      [voteRemove(), riley],
      [yieldChair, sam],
      [takeChair, taylor],
    );
    expect(surroundedOf(state, alex).chair?.votes).toEqual([]);
  });

  it("removes the Challenger once a voter leaving the Room leaves a majority", () => {
    // Riley has voted; with Morgan and Taylor gone, Riley alone is a majority.
    const state = run(
      samInTheChair(false),
      [voteRemove(), riley],
      [{ type: "remove-person", personId: "p6" }, host],
    );
    expect(surroundedOf(state, alex).chair).not.toBeNull();
    const result = attempt(state, { type: "remove-person", personId: "p5" }, host);
    expect(surroundedOf(result.state, alex).chair).toBeNull();
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", endedBy: "vote" }),
    );
  });
});

describe("people leaving", () => {
  it("ends the exchange when the Challenger leaves the Room", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, { type: "remove-person", personId: SAM }, host);
    expect(surroundedOf(result.state, alex).chair).toBeNull();
    expect(surroundedOf(result.state, alex).cooldown).toBeNull();
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "left" }),
    );
  });

  it("opens the Center to volunteers again when the Center leaves", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, { type: "remove-person", personId: ALEX }, host);
    const surrounded = surroundedOf(result.state, sam);
    expect(surrounded.center).toBeNull();
    expect(surrounded.chair).toBeNull();
    expect(floorHolders(result.state)).toEqual([]);
    expect(attempt(result.state, volunteer, riley).rejection).toBeUndefined();
  });
});

describe("the summary card", () => {
  /** Three exchanges on the first Prompt: ended by yield, by vote and by the timer. */
  const threeExchanges = () => {
    const state = run(
      withCenter(),
      [takeChair, sam],
      [yieldChair, alex],
      [takeChair, riley],
      [voteRemove(), sam],
      [takeChair, sam],
    );
    const timedOut = tick(state, surroundedOf(state, alex).chair!.endsAt).state;
    return run(timedOut, [advance, host]);
  };

  it("waits for the Mood Check-in to close", () => {
    const state = threeExchanges();
    expect(viewFor(state, alex).stage?.checkIn?.status).toBe("open");
    expect(surroundedOf(state, alex).summary).toBeNull();
  });

  it("shows the number of exchanges and how each ended", () => {
    const state = run(threeExchanges(), ...everyoneAnswersCheckIn());
    const surrounded = surroundedOf(state, casey);
    expect(surrounded.step).toBe("summary");
    expect(surrounded.summary).toEqual({
      exchanges: 3,
      endedBy: { timer: 1, vote: 1, yield: 1, host: 0, left: 0 },
    });
    expect(surrounded.exchanges.map((e) => [e.nickname, e.endedBy])).toEqual([
      ["Sam", "yield"],
      ["Riley", "vote"],
      ["Sam", "timer"],
    ]);
  });

  it("closes the chair once the Prompt is over", () => {
    const state = run(threeExchanges(), ...everyoneAnswersCheckIn());
    expect(attempt(state, takeChair, riley).rejection?.code).toBe("exchanges-over");
  });

  it("returns to the Waiting Room after the last Prompt, giving the Floor back", () => {
    const state = run(
      roomWith({ centerId: ALEX, prompts: ["Cereal is a soup"] }),
      [start(), host],
      [advance, host],
      ...everyoneAnswersCheckIn(),
      [advance, host],
    );
    expect(viewFor(state, alex).stage).toBeNull();
    expect(floorHolders(state)).toEqual([]);
  });
});

describe("Moods in a Surrounded Round", () => {
  it("lets the Center and Challengers set a Mood, for everyone to see", () => {
    const state = run(withCenter(), [{ type: "set-mood", mood: "angry" }, alex]);
    expect(viewFor(state, casey).stage?.moods).toEqual({ [ALEX]: "angry" });
  });

  it("closes the Mood Check-in once everyone Playing has answered", () => {
    const state = run(withCenter(), [advance, host], ...everyoneAnswersCheckIn());
    const checkIn = viewFor(state, alex).stage?.checkIn;
    expect(checkIn?.status === "closed" && checkIn.tally.moods.thinking).toBe(3);
  });

  it("closes the Mood Check-in after 15 seconds", () => {
    const state = run(withCenter(), [advance, host]);
    const ticked = tick(state, clock + CHECK_IN_MS);
    expect(viewFor(ticked.state, alex).stage?.checkIn?.status).toBe("closed");
  });
});

describe("late joiners", () => {
  it("are Challengers from the next Prompt", () => {
    const taylor: Actor = { token: "taylor-device" };
    const state = run(withCenter(), [{ type: "join", nickname: "Taylor" }, taylor]);
    expect(attempt(state, takeChair, taylor).rejection?.code).toBe("not-playing");
    const next = run(
      state,
      [advance, host],
      ...everyoneAnswersCheckIn(),
      [advance, host],
      [takeChair, taylor],
    );
    expect(surroundedOf(next, alex).chair?.challenger.nickname).toBe("Taylor");
  });
});

describe("ending the Room mid-Round", () => {
  it("ends the exchange and the Prompt with its summary, and gives the Floor back", () => {
    const state = run(withCenter(), [takeChair, sam]);
    const result = attempt(state, { type: "end-room" }, host);
    expect(result.state.phase).toBe("ended");
    expect(result.scheduled).toBe(clock + 7 * 24 * 60 * 60_000);
    const types = result.recapEvents.map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["exchange-ended", "prompt-ended", "round-ended", "room-ended"]),
    );
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "prompt-ended",
        format: "surrounded",
        exchanges: [{ challengerId: SAM, endedBy: "host" }],
      }),
    );
  });
});

describe("the Recap", () => {
  /** Runs steps and keeps every Recap event they add. */
  function recapOf(state: RoomState, ...steps: ([Intent, Actor] | "time-out")[]) {
    const events: RecapEvent[] = [];
    let current = state;
    for (const step of steps) {
      const result =
        step === "time-out"
          ? tick(current, surroundedOf(current, alex).chair!.endsAt)
          : attempt(current, ...step);
      if (result.rejection) throw new Error(result.rejection.message);
      events.push(...result.recapEvents);
      current = result.state;
    }
    return events;
  }

  it("records the Center, each exchange with its votes and how it ended, and the summary", () => {
    const events = recapOf(
      newRoom(),
      ...settingUp({}),
      [start(), host],
      [volunteer, alex],
      [takeChair, sam],
      // Riley is the only Challenger not in the chair, so one vote removes Sam.
      [voteRemove(), riley],
      [seat(RILEY), host],
      [yieldChair, riley],
      [takeChair, sam],
      "time-out",
      [advance, host],
    );
    const [round] = summarizeRecap(events, clock).rounds;
    expect(round?.centers.map((c) => [c.nickname, c.by])).toEqual([["Alex", "volunteer"]]);
    const surrounded = round?.prompts[0]?.surrounded;
    expect(
      surrounded?.exchanges.map((e) => ({
        nickname: e.nickname,
        takenBy: e.takenBy,
        endedBy: e.endedBy,
        yieldedBy: e.yieldedBy,
        votes: e.votes.map((v) => [v.nickname, v.remove]),
      })),
    ).toEqual([
      {
        nickname: "Sam",
        takenBy: "challenger",
        endedBy: "vote",
        yieldedBy: null,
        votes: [["Riley", true]],
      },
      { nickname: "Riley", takenBy: "host", endedBy: "yield", yieldedBy: "challenger", votes: [] },
      { nickname: "Sam", takenBy: "challenger", endedBy: "timer", yieldedBy: null, votes: [] },
    ]);
    expect(surrounded?.summary).toEqual({
      exchanges: 3,
      endedBy: { timer: 1, vote: 1, yield: 1, host: 0, left: 0 },
    });
  });

  it("lists each Center of the Round, with the one a replacement replaced", () => {
    const events = recapOf(
      newRoom(),
      ...settingUp({ centerId: ALEX }),
      [start(), host],
      [chooseCenter(SAM), host],
    );
    const [round] = summarizeRecap(events, clock).rounds;
    expect(round?.centers.map((c) => [c.nickname, c.by, c.replaced?.nickname ?? null])).toEqual([
      ["Alex", "host", null],
      ["Sam", "host", "Alex"],
    ]);
  });

  it("gives a Surrounded Prompt its Mood insights, with no position changes to link", () => {
    const events = recapOf(
      newRoom(),
      ...settingUp({ centerId: ALEX }),
      [start(), host],
      [{ type: "set-mood", mood: "angry" }, alex],
      [takeChair, sam],
      [yieldChair, sam],
      [advance, host],
      ...everyoneAnswersCheckIn(),
    );
    const summary = summarizeRecap(events, clock);
    const moods = summary.rounds[0]?.prompts[0]?.moods;
    expect(moods?.timelines.map((t) => [t.nickname, t.changes.map((c) => c.mood)])).toEqual([
      ["Alex", ["angry", "thinking"]],
      ["Sam", ["thinking"]],
      ["Riley", ["thinking"]],
    ]);
    expect(moods?.checkIn?.tally.moods.thinking).toBe(3);
    expect(moods?.links).toEqual([]);
    expect(summary.moodOverview[0]?.checkIn?.moods.thinking).toBe(3);
  });

  it("leaves Spectrum and Middle Ground details off a Surrounded Prompt", () => {
    const events = recapOf(roomWith({ centerId: ALEX }), [start(), host]);
    const prompt = summarizeRecap(events, clock).rounds[0]?.prompts[0];
    expect(prompt?.spectrum).toBeNull();
    expect(prompt?.middleGround).toBeNull();
    expect(prompt?.surrounded).toEqual({ exchanges: [], summary: null });
  });
});

describe("a Co-Host running a Surrounded Round", () => {
  const taylor: Actor = { token: "taylor-device" };
  const TAYLOR = "p5";

  /** Riley is a Co-Host, Playing or sitting the Round out; Taylor is a Participant. */
  const withCoHost = (rileyPlaying: boolean, centerId: string | null = ALEX) =>
    run(
      roomWith({ centerId }),
      [{ type: "join", nickname: "Taylor" }, taylor],
      [{ type: "grant-co-host", personIds: [RILEY] }, host],
      [{ type: "set-playing", playing: rileyPlaying }, riley],
      [start(), host],
    );

  it("lets a Co-Host pick the Center, seat and end exchanges, and override the Floor", () => {
    const state = run(
      withCoHost(false, null),
      [chooseCenter(ALEX), riley],
      [seat(SAM), riley],
      [{ type: "give-floor", personId: TAYLOR }, riley],
    );
    expect(surroundedOf(state, alex).center?.personId).toBe(ALEX);
    expect(surroundedOf(state, alex).chair?.challenger.personId).toBe(SAM);
    expect(floorHolders(state)).toEqual([ALEX, SAM, TAYLOR]);
    const ended = attempt(state, endExchange, riley);
    expect(ended.recapEvents).toContainEqual(
      expect.objectContaining({ type: "exchange-ended", challengerId: SAM, endedBy: "host" }),
    );
  });

  it("never lets a Co-Host seat a Spectator or make one the Center", () => {
    const state = withCoHost(false, null);
    expect(attempt(state, chooseCenter(CASEY), riley).rejection?.code).toBe("spectators-watch");
    const withCenterChosen = run(state, [chooseCenter(ALEX), riley]);
    expect(attempt(withCenterChosen, seat(CASEY), riley).rejection?.code).toBe("spectators-watch");
  });

  it("doesn't count a Co-Host who sits out as a Challenger or a voter", () => {
    const state = run(withCoHost(false), [takeChair, sam]);
    const surrounded = surroundedOf(state, riley);
    expect(surrounded.challengers.map((c) => c.personId)).toEqual([SAM, TAYLOR]);
    // Only Taylor votes, so one vote is a majority.
    expect(surrounded.chair?.votesNeeded).toBe(1);
    expect(attempt(state, voteRemove(), riley).rejection?.code).toBe("cant-vote");
    expect(attempt(state, yieldChair, riley).rejection?.code).toBe("cant-yield");
    expect(viewFor(state, riley).stage?.playing).toBe(false);
    const free = run(state, [yieldChair, sam]);
    expect(attempt(free, takeChair, riley).rejection?.code).toBe("not-playing");
  });

  it("counts a Playing Co-Host as a Challenger and a voter", () => {
    const state = run(withCoHost(true), [takeChair, sam]);
    expect(viewFor(state, riley).stage?.playing).toBe(true);
    // Riley and Taylor vote: it takes both.
    expect(surroundedOf(state, riley).chair?.votesNeeded).toBe(2);
    const oneVote = run(state, [voteRemove(), riley]);
    expect(surroundedOf(oneVote, alex).chair).not.toBeNull();
    const removed = run(oneVote, [voteRemove(), taylor]);
    expect(surroundedOf(removed, alex).chair).toBeNull();
    expect(attempt(removed, takeChair, riley).rejection).toBeUndefined();
  });

  it("lets a Co-Host replace the Center", () => {
    const result = attempt(withCoHost(false), chooseCenter(TAYLOR), riley);
    expect(surroundedOf(result.state, alex).center?.personId).toBe(TAYLOR);
    expect(floorHolders(result.state)).toEqual([TAYLOR]);
  });

  it("refuses to start a Round whose Center is a Co-Host sitting it out", () => {
    const state = run(
      roomWith({ centerId: RILEY }),
      [{ type: "grant-co-host", personIds: [RILEY] }, host],
      [{ type: "set-playing", playing: false }, riley],
    );
    expect(attempt(state, start(), host).rejection?.code).toBe("center-not-playing");
  });

  it("refuses the chair controls once the Co-Host steps down", () => {
    const state = run(withCoHost(false), [takeChair, sam], [{ type: "step-down" }, riley]);
    expect(attempt(state, endExchange, riley).rejection?.code).toBe("not-host");
  });
});

describe("Surrounded intents over the wire", () => {
  it.each<Intent>([
    volunteer,
    chooseCenter(ALEX),
    takeChair,
    voteRemove(true),
    voteRemove(false),
    yieldChair,
    endExchange,
    seat(SAM),
  ])("accepts %j", (intent) => {
    expect(parseIntent(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
  });

  it.each([
    { type: "vote-remove" },
    { type: "vote-remove", remove: "yes" },
    { type: "choose-center" },
    { type: "seat-challenger", personId: 2 },
  ])("drops a malformed one (%j)", (raw) => {
    expect(parseIntent(raw)).toBeNull();
  });
});

/** Everyone Playing (the Host isn't) answers the Mood Check-in. */
function everyoneAnswersCheckIn(): [Intent, Actor][] {
  return [alex, sam, riley].map((actor) => [{ type: "set-mood", mood: "thinking" }, actor]);
}
