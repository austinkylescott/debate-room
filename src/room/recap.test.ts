// The Recap, ending the Room and expiry, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  type ApplyResult,
  createRoom,
  type Actor,
  type Intent,
  parseIntent,
  type RecapEvent,
  ROOM_EXPIRY_MS,
  type RoomState,
  tick,
  viewFor,
} from "./room";
import type { Mood } from "./mood";
import { summarizeRecap } from "./recap";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const visitor: Actor = { token: "visitor-device" };

const ALEX = "p1";
const SAM = "p2";

const CREATED_AT = 1_000;
const DAY = 24 * 60 * 60_000;

/** Applies intents in order at the given times, failing loudly if any is rejected. */
function run(state: RoomState, ...steps: [Intent, Actor, number][]): RoomState {
  return steps.reduce((current, [intent, actor, at], i) => {
    const result = apply(current, intent, actor, at);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

/** Applies intents in order, collecting the Recap events they produce. */
function recapOf(state: RoomState, ...steps: [Intent, Actor, number][]): RecapEvent[] {
  const events: RecapEvent[] = [];
  steps.reduce((current, [intent, actor, at], i) => {
    const result = apply(current, intent, actor, at);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    events.push(...result.recapEvents);
    return result.state;
  }, state);
  return events;
}

function plannedRoom(): RoomState {
  const created = createRoom(
    { hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" },
    CREATED_AT,
  );
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(
    created.state,
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host, 1_100],
    [
      {
        type: "add-round",
        setup: { format: "spectrum" },
        prompts: [
          { text: "Cats beat dogs", surprise: false },
          { text: "Pineapple on pizza", surprise: true },
        ],
      },
      host,
      1_200,
    ],
  );
}

const GOING_LIVE: [Intent, Actor, number][] = [
  [{ type: "open-room" }, host, 1_300],
  [{ type: "join", nickname: "Alex" }, alex, 1_400],
  [{ type: "join", nickname: "Sam" }, sam, 2_000],
];

/** A Live Room with Alex and Sam in the Waiting Room, last active at 2,000. */
function liveRoom(): RoomState {
  return run(plannedRoom(), ...GOING_LIVE);
}

/** The whole Recap of a Room that went Live as {@link liveRoom} did, then took these steps. */
function wholeRecap(...steps: [Intent, Actor, number][]): RecapEvent[] {
  return recapOf(plannedRoom(), ...GOING_LIVE, ...steps);
}

const start: Intent = { type: "start-round", hostPlaying: false };
const lockIn = (position: number): Intent => ({ type: "lock-in", position });
const move = (position: number): Intent => ({ type: "move-position", position });
const advance: Intent = { type: "advance" };
const endRoom: Intent = { type: "end-room" };
const setMood = (mood: Mood): Intent => ({ type: "set-mood", mood });
/** Alex and Sam answer the Mood Check-in, which closes it. */
const checkIn = (at: number): [Intent, Actor, number][] => [
  [setMood("happy"), alex, at],
  [setMood("sad"), sam, at + 1],
];
const give = (personId: string): Intent => ({ type: "give-floor", personId });
const take = (personId: string): Intent => ({ type: "take-floor", personId });

describe("Round and Prompt boundaries in the Recap", () => {
  it("records each Prompt as it starts, with its text", () => {
    const events = recapOf(
      liveRoom(),
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
      [advance, host, 3_300],
      ...checkIn(3_310),
      [advance, host, 3_400],
    );
    expect(events.filter((e) => e.type === "prompt-started")).toEqual([
      expect.objectContaining({ at: 3_000, promptNumber: 1, text: "Cats beat dogs" }),
      expect.objectContaining({ at: 3_400, promptNumber: 2, text: "Pineapple on pizza" }),
    ]);
  });
});

describe("Spectrum moves in the Recap", () => {
  it("records moves after the reveal, from where and to where", () => {
    const events = recapOf(
      liveRoom(),
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
      [move(40), alex, 3_300],
      [move(55), alex, 3_400],
    );
    expect(events.filter((e) => e.type === "position-moved")).toEqual([
      expect.objectContaining({ at: 3_300, personId: ALEX, from: 10, to: 40 }),
      expect.objectContaining({ at: 3_400, personId: ALEX, from: 40, to: 55 }),
    ]);
  });

  it("never records hovering before the reveal, which stays hidden", () => {
    const events = recapOf(liveRoom(), [start, host, 3_000], [move(30), alex, 3_100]);
    expect(events.some((e) => e.type === "position-moved")).toBe(false);
  });
});

describe("who can see the Recap", () => {
  it("is open to everyone in the Room while it's Live, but not to visitors", () => {
    const state = liveRoom();
    expect(viewFor(state, host).seesRecap).toBe(true);
    expect(viewFor(state, alex).seesRecap).toBe(true);
    expect(viewFor(state, visitor).seesRecap).toBe(false);
  });

  it("is closed to visitors while the Room is in Planning", () => {
    expect(viewFor(plannedRoom(), visitor).seesRecap).toBe(false);
  });

  it("is open to anyone with the invite link once the Room has Ended", () => {
    const ended = run(liveRoom(), [endRoom, host, 3_000]);
    expect(viewFor(ended, visitor).seesRecap).toBe(true);
    expect(viewFor(ended, alex).seesRecap).toBe(true);
  });
});

describe("ending the Room", () => {
  it("moves the Room to Ended for everyone and records it", () => {
    const result = apply(liveRoom(), endRoom, host, 3_000);
    expect(viewFor(result.state, alex).phase).toBe("ended");
    expect(result.recapEvents).toContainEqual({ at: 3_000, type: "room-ended" });
  });

  it("is for the Host only", () => {
    expect(apply(liveRoom(), endRoom, alex, 3_000).rejection?.code).toBe("not-host");
  });

  it("ends the Round in progress and takes back the Floor", () => {
    const state = run(liveRoom(), [start, host, 3_000], [give(ALEX), host, 3_100]);
    const result = apply(state, endRoom, host, 4_000);
    expect(result.recapEvents.map((e) => e.type)).toEqual([
      "floor-taken",
      "round-ended",
      "room-ended",
    ]);
    expect(viewFor(result.state, alex).stage).toBeNull();
    expect(viewFor(result.state, alex).floor).toBeNull();
  });

  it("closes an open Mood Check-in, recording anyone who hadn't answered as no Mood", () => {
    const state = run(
      liveRoom(),
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
      [advance, host, 3_300],
      [setMood("happy"), alex, 3_400],
    );
    const result = apply(state, endRoom, host, 4_000);
    expect(result.recapEvents).toEqual([
      expect.objectContaining({
        at: 4_000,
        type: "mood-check-in-closed",
        by: "room-ended",
        moods: { [ALEX]: "happy", [SAM]: null },
      }),
      expect.objectContaining({ at: 4_000, type: "round-ended" }),
      { at: 4_000, type: "room-ended" },
    ]);
    // Its close no longer needs a tick: only the expiry is left.
    expect(result.scheduled).toBe(4_000 + 7 * DAY);
  });

  it("stops the Room: nobody can join, play or edit any more", () => {
    const ended = run(liveRoom(), [endRoom, host, 3_000]);
    for (const [intent, actor] of [
      [{ type: "join", nickname: "Riley" }, visitor],
      [start, host],
      [give(ALEX), host],
      [{ type: "raise-hand" }, alex],
      [{ type: "rename-person", personId: ALEX, nickname: "Al" }, host],
      [{ type: "open-room" }, host],
    ] as [Intent, Actor][]) {
      expect(apply(ended, intent, actor, 4_000).rejection?.code).toBe("room-ended");
    }
  });

  it("still lets the Host back in on a new device", () => {
    const ended = run(liveRoom(), [endRoom, host, 3_000]);
    const other: Actor = { token: "host-laptop" };
    const result = apply(ended, { type: "claim-host", hostSecret: HOST_SECRET }, other, 4_000);
    expect(viewFor(result.state, other).you.role).toBe("host");
  });

  it("happens once", () => {
    const ended = run(liveRoom(), [endRoom, host, 3_000]);
    expect(apply(ended, endRoom, host, 4_000).recapEvents).toEqual([]);
  });

  it("is accepted over the wire", () => {
    expect(parseIntent({ type: "end-room" })).toEqual(endRoom);
  });
});

describe("expiry after 7 days of inactivity", () => {
  it("is 7 days", () => {
    expect(ROOM_EXPIRY_MS).toBe(7 * DAY);
  });

  it("is scheduled from the moment the Room is created", () => {
    const created = createRoom(
      { hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" },
      CREATED_AT,
    );
    expect("scheduled" in created && created.scheduled).toBe(CREATED_AT + 7 * DAY);
  });

  it("is pushed back by activity", () => {
    const result = apply(liveRoom(), give(ALEX), host, 5 * DAY);
    expect(result.scheduled).toBe(5 * DAY + 7 * DAY);
  });

  it("isn't pushed back by an intent that is refused or changes nothing", () => {
    const state = liveRoom();
    expect(apply(state, give(ALEX), alex, 5 * DAY).scheduled).toBe(2_000 + 7 * DAY);
    expect(apply(state, { type: "join", nickname: "Alex" }, alex, 5 * DAY).scheduled).toBe(
      2_000 + 7 * DAY,
    );
  });

  it("isn't pushed back by a timer running out", () => {
    const state = run(
      liveRoom(),
      [{ type: "set-floor-timer", seconds: 60 }, host, 3_000],
      [give(ALEX), host, 3_000],
    );
    expect(tick(state, 63_000).scheduled).toBe(3_000 + 7 * DAY);
  });

  it("gives way to a timer that is due sooner", () => {
    const state = run(liveRoom(), [{ type: "set-floor-timer", seconds: 60 }, host, 3_000]);
    expect(apply(state, give(ALEX), host, 4_000).scheduled).toBe(64_000);
  });

  it("shares the one alarm with the Mood Check-in: neither masks the other", () => {
    const state = run(
      liveRoom(),
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
    );
    // Opening the Check-in is activity, so the Check-in's close is due long
    // before the expiry: it is what the alarm is set for.
    const opened = apply(state, advance, host, 3_300);
    expect(opened.scheduled).toBe(3_300 + 15_000);
    // Once it closes on its own, the expiry is back, still counted from the
    // last activity (closing on a timer isn't activity).
    const closed = tick(opened.state, 3_300 + 15_000);
    expect(closed.recapEvents.map((e) => e.type)).toEqual(["mood-check-in-closed"]);
    expect(closed.scheduled).toBe(3_300 + 7 * DAY);
    expect(tick(closed.state, 3_300 + 7 * DAY).expired).toBe(true);
  });

  it("still applies once the Room has Ended", () => {
    const ended = run(liveRoom(), [endRoom, host, 3_000]);
    expect(tick(ended, 3_000 + 7 * DAY).expired).toBe(true);
  });

  it("removes the Room once 7 days pass with no activity", () => {
    const state = liveRoom();
    expect(tick(state, 2_000 + 7 * DAY - 1).expired).toBeUndefined();
    const expired: ApplyResult = tick(state, 2_000 + 7 * DAY);
    expect(expired.expired).toBe(true);
    expect(expired.scheduled).toBeUndefined();
  });

  it("refuses to bring an expired Room back, even if its alarm is late", () => {
    const result = apply(liveRoom(), give(ALEX), host, 2_000 + 8 * DAY);
    expect(result.expired).toBe(true);
    expect(result.recapEvents).toEqual([]);
  });
});

describe("Floor changes recorded for Floor time", () => {
  it("records Floor turns with their times", () => {
    const events = recapOf(
      liveRoom(),
      [give(ALEX), host, 3_000],
      [give(SAM), host, 4_000],
      [take(ALEX), host, 9_000],
    );
    expect(events).toEqual([
      { at: 3_000, type: "floor-given", personId: ALEX },
      { at: 4_000, type: "floor-given", personId: SAM },
      { at: 9_000, type: "floor-taken", personId: ALEX },
    ]);
  });
});

describe("Floor time per person", () => {
  const floorTime = (events: RecapEvent[], now: number) =>
    summarizeRecap(events, now).floorTime.map(({ nickname, ms }) => [nickname, ms]);

  it("adds up each person's Floor turns, most Floor time first", () => {
    const events = wholeRecap(
      [give(ALEX), host, 3_000],
      [take(ALEX), host, 5_000],
      [give(SAM), host, 6_000],
      [take(SAM), host, 7_000],
      [give(ALEX), host, 10_000],
      [take(ALEX), host, 13_000],
    );
    expect(floorTime(events, 20_000)).toEqual([
      ["Alex", 5_000],
      ["Sam", 1_000],
    ]);
  });

  it("counts people who had the Floor at the same time in full", () => {
    const events = wholeRecap(
      [give(ALEX), host, 3_000],
      [give(SAM), host, 4_000],
      [{ type: "clear-floor" }, host, 9_000],
    );
    expect(floorTime(events, 20_000)).toEqual([
      ["Alex", 6_000],
      ["Sam", 5_000],
    ]);
  });

  it("counts a turn still running up to now", () => {
    const events = wholeRecap([give(ALEX), host, 3_000]);
    expect(floorTime(events, 8_000)).toEqual([["Alex", 5_000]]);
  });

  it("keeps counting a turn whose speaking timer ran out, until the Floor is taken back", () => {
    const steps: [Intent, Actor, number][] = [
      [{ type: "set-floor-timer", seconds: 10 }, host, 3_000],
      [give(ALEX), host, 3_000],
    ];
    const timeUp = tick(run(liveRoom(), ...steps), 13_000);
    const taken = apply(timeUp.state, take(ALEX), host, 20_000);
    const events = [...wholeRecap(...steps), ...timeUp.recapEvents, ...taken.recapEvents];
    expect(floorTime(events, 30_000)).toEqual([["Alex", 17_000]]);
  });

  it("stops counting when the Room ends", () => {
    const events = wholeRecap([give(ALEX), host, 3_000], [endRoom, host, 4_000]);
    expect(floorTime(events, 99_000)).toEqual([["Alex", 1_000]]);
  });

  it("names the Host, and people by their latest nickname, even once removed", () => {
    const events = recapOf(
      plannedRoom(),
      [{ type: "open-room" }, host, 1_300],
      [{ type: "join", nickname: "Alex" }, alex, 1_400],
      [give("host"), host, 2_000],
      [give(ALEX), host, 2_000],
      [{ type: "rename-person", personId: ALEX, nickname: "Lexi" }, host, 2_500],
      [{ type: "remove-person", personId: ALEX }, host, 3_000],
      [take("host"), host, 4_000],
    );
    expect(floorTime(events, 9_000)).toEqual([
      ["Jordan", 2_000],
      ["Lexi", 1_000],
    ]);
  });
});

describe("Rounds and Prompts in the Recap", () => {
  function playedRound(): RecapEvent[] {
    return wholeRecap(
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
      [move(60), alex, 3_300],
      [advance, host, 3_400],
      [setMood("happy"), alex, 3_410],
      [setMood("thinking"), sam, 3_420],
      [advance, host, 3_500],
      [lockIn(50), alex, 3_600],
      [{ type: "reveal-positions" }, host, 3_700],
      [advance, host, 3_800],
      ...checkIn(3_810),
      [advance, host, 3_900],
    );
  }

  it("lists each Round with its Prompts, when they started and ended", () => {
    const [round, ...others] = summarizeRecap(playedRound(), 9_000).rounds;
    expect(others).toEqual([]);
    expect(round).toMatchObject({ format: "spectrum", startedAt: 3_000, endedAt: 3_900 });
    expect(
      round!.prompts.map(({ promptNumber, text, startedAt, endedAt }) => ({
        promptNumber,
        text,
        startedAt,
        endedAt,
      })),
    ).toEqual([
      { promptNumber: 1, text: "Cats beat dogs", startedAt: 3_000, endedAt: 3_400 },
      { promptNumber: 2, text: "Pineapple on pizza", startedAt: 3_500, endedAt: 3_800 },
    ]);
  });

  it("shows the revealed positions and the moves after the reveal", () => {
    const [first] = summarizeRecap(playedRound(), 9_000).rounds[0]!.prompts;
    expect(first!.revealed).toEqual({
      at: 3_200,
      by: "everyone-locked-in",
      positions: [
        { personId: ALEX, nickname: "Alex", position: 10 },
        { personId: SAM, nickname: "Sam", position: 90 },
      ],
    });
    expect(first!.moves).toEqual([
      { at: 3_300, personId: ALEX, nickname: "Alex", from: 10, to: 60 },
    ]);
  });

  it("gives each ended Prompt its summary card: where people locked in, and where they ended up", () => {
    const [first, second] = summarizeRecap(playedRound(), 9_000).rounds[0]!.prompts;
    // Notches: Strongly Disagree, Disagree, Neutral, Agree, Strongly Agree.
    expect(first!.summary).toEqual({ before: [1, 0, 0, 0, 1], after: [0, 0, 1, 0, 1] });
    expect(second!.summary).toEqual({ before: [0, 0, 1, 0, 0], after: [0, 0, 1, 0, 0] });
  });

  it("keeps each Prompt's Mood events as they were recorded", () => {
    const [first] = summarizeRecap(playedRound(), 9_000).rounds[0]!.prompts;
    expect(first!.moodEvents).toEqual([
      expect.objectContaining({ at: 3_410, type: "mood-changed", personId: ALEX, mood: "happy" }),
      expect.objectContaining({ at: 3_420, type: "mood-changed", personId: SAM, mood: "thinking" }),
      expect.objectContaining({
        at: 3_420,
        type: "mood-check-in-closed",
        by: "everyone-answered",
        moods: { [ALEX]: "happy", [SAM]: "thinking" },
      }),
    ]);
  });

  it("leaves a Prompt cut short by the end of the Room without a summary card", () => {
    const events = wholeRecap([start, host, 3_000], [endRoom, host, 4_000]);
    const summary = summarizeRecap(events, 9_000);
    const [prompt] = summary.rounds[0]!.prompts;
    expect(summary.rounds[0]!.endedAt).toBe(4_000);
    expect(prompt).toMatchObject({ endedAt: 4_000, revealed: null, summary: null });
    expect(summary.endedAt).toBe(4_000);
  });
});
