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
const settle = (position: number): Intent => ({ type: "move-position", position, settled: true });
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
  /** Alex and Sam lock in at 10 and 90, which reveals; then Alex makes these moves. */
  const movesAfterReveal = (...moves: Intent[]) =>
    recapOf(
      liveRoom(),
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
      ...moves.map((intent, i): [Intent, Actor, number] => [intent, alex, 3_300 + i * 100]),
    ).filter((e) => e.type === "position-moved");

  it("records each notch a move crosses, at the notch", () => {
    // Notches sit at 0, 25, 50, 75 and 100.
    expect(movesAfterReveal(move(30), move(60))).toEqual([
      expect.objectContaining({ at: 3_300, personId: ALEX, position: 25, reason: "notch" }),
      expect.objectContaining({ at: 3_400, personId: ALEX, position: 50, reason: "notch" }),
    ]);
  });

  it("records every notch crossed in one jump, in the order they're reached", () => {
    expect(movesAfterReveal(move(80), move(5)).map((e) => "position" in e && e.position)).toEqual([
      25, 50, 75, 75, 50, 25,
    ]);
  });

  it("counts landing on a notch as crossing it, but not leaving it", () => {
    expect(movesAfterReveal(move(25), move(30)).map((e) => "position" in e && e.position)).toEqual([
      25,
    ]);
  });

  it("records nothing for jitter between notches", () => {
    expect(movesAfterReveal(move(12), move(18), move(14), move(20))).toEqual([]);
  });

  it("records where the slider settles, wherever it lands", () => {
    expect(movesAfterReveal(move(12), settle(18))).toEqual([
      expect.objectContaining({ at: 3_400, personId: ALEX, position: 18, reason: "settled" }),
    ]);
  });

  it("records a settle on a notch once, as the notch", () => {
    expect(movesAfterReveal(move(20), settle(50))).toEqual([
      expect.objectContaining({ position: 25, reason: "notch" }),
      expect.objectContaining({ position: 50, reason: "notch" }),
    ]);
  });

  it("records the settle even when the last move while dragging already got there", () => {
    expect(movesAfterReveal(move(18), settle(18))).toEqual([
      expect.objectContaining({ at: 3_400, position: 18, reason: "settled" }),
    ]);
  });

  it("accepts a settled move over the wire", () => {
    expect(parseIntent({ type: "move-position", position: 40, settled: true })).toEqual(settle(40));
    expect(parseIntent({ type: "move-position", position: 40, settled: "yes" })).toEqual(move(40));
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

  it("is open to Spectators while the Room is Live", () => {
    const casey: Actor = { token: "casey-device" };
    const state = run(liveRoom(), [
      { type: "join", nickname: "Casey", as: "spectator" },
      casey,
      2_500,
    ]);
    expect(viewFor(state, casey).you.role).toBe("spectator");
    expect(viewFor(state, casey).seesRecap).toBe(true);
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

  it("keeps a Spectator a Spectator: switching to Participant is refused", () => {
    const casey: Actor = { token: "casey-device" };
    const ended = run(
      liveRoom(),
      [{ type: "join", nickname: "Casey", as: "spectator" }, casey, 2_500],
      [endRoom, host, 3_000],
    );
    const result = apply(ended, { type: "become-participant" }, casey, 4_000);
    expect(result.rejection?.code).toBe("room-ended");
    expect(viewFor(result.state, casey).you.role).toBe("spectator");
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
    expect(tick(closed.state, 3_300 + 7 * DAY).gone).toBe("expired");
  });

  it("still applies once the Room has Ended", () => {
    const ended = run(liveRoom(), [endRoom, host, 3_000]);
    expect(tick(ended, 3_000 + 7 * DAY).gone).toBe("expired");
  });

  it("removes the Room once 7 days pass with no activity", () => {
    const state = liveRoom();
    expect(tick(state, 2_000 + 7 * DAY - 1).gone).toBeUndefined();
    const expired: ApplyResult = tick(state, 2_000 + 7 * DAY);
    expect(expired.gone).toBe("expired");
    expect(expired.scheduled).toBeUndefined();
  });

  it("refuses to bring an expired Room back, even if its alarm is late", () => {
    const result = apply(liveRoom(), give(ALEX), host, 2_000 + 8 * DAY);
    expect(result.gone).toBe("expired");
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

describe("who was in the Room", () => {
  it("lists the Host, Participants and Spectators, with switches and removals", () => {
    const casey: Actor = { token: "casey-device" };
    const events = wholeRecap(
      [{ type: "join", nickname: "Casey", as: "spectator" }, casey, 2_500],
      [{ type: "become-participant" }, casey, 2_600],
      [{ type: "remove-person", personId: SAM }, host, 2_700],
    );
    const people = summarizeRecap(events, 9_000).people.map(
      ({ nickname, joinedAs, becameParticipantAt, removedAt }) => [
        nickname,
        joinedAs,
        becameParticipantAt,
        removedAt,
      ],
    );
    expect(people).toEqual([
      ["Jordan", "host", null, null],
      ["Alex", "participant", null, null],
      ["Sam", "participant", null, 2_700],
      ["Casey", "spectator", 2_600, null],
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
      [settle(60), alex, 3_305],
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
    expect(first!.spectrum!.revealed).toEqual({
      at: 3_200,
      by: "everyone-locked-in",
      positions: [
        { personId: ALEX, nickname: "Alex", position: 10 },
        { personId: SAM, nickname: "Sam", position: 90 },
      ],
    });
    expect(first!.spectrum!.moves).toEqual([
      { at: 3_300, personId: ALEX, nickname: "Alex", from: 10, to: 25, reason: "notch" },
      { at: 3_300, personId: ALEX, nickname: "Alex", from: 25, to: 50, reason: "notch" },
      { at: 3_305, personId: ALEX, nickname: "Alex", from: 50, to: 60, reason: "settled" },
    ]);
  });

  it("gives each ended Prompt its summary card: where people locked in, and where they ended up", () => {
    const [first, second] = summarizeRecap(playedRound(), 9_000).rounds[0]!.prompts;
    // Notches: Strongly Disagree, Disagree, Neutral, Agree, Strongly Agree.
    expect(first!.spectrum!.summary).toEqual({ before: [1, 0, 0, 0, 1], after: [0, 0, 1, 0, 1] });
    expect(second!.spectrum!.summary).toEqual({ before: [0, 0, 1, 0, 0], after: [0, 0, 1, 0, 0] });
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
    expect(prompt).toMatchObject({ endedAt: 4_000, spectrum: { revealed: null, summary: null } });
    expect(summary.endedAt).toBe(4_000);
  });

  it("gives a revealed Prompt cut short by the end of the Room its summary card", () => {
    const events = wholeRecap(
      [start, host, 3_000],
      [lockIn(10), alex, 3_100],
      [lockIn(90), sam, 3_200],
      [endRoom, host, 4_000],
    );
    expect(events.slice(-3).map((e) => e.type)).toEqual([
      "prompt-ended",
      "round-ended",
      "room-ended",
    ]);
    const [prompt] = summarizeRecap(events, 9_000).rounds[0]!.prompts;
    expect(prompt!.spectrum!.summary).toEqual({
      before: [1, 0, 0, 0, 1],
      after: [1, 0, 0, 0, 1],
    });
  });
});

describe("cancelling a Room in Planning", () => {
  const cancel: Intent = { type: "cancel-room" };

  it("discards the Room, leaving no Recap", () => {
    const result = apply(plannedRoom(), cancel, host, 3_000);
    expect(result.gone).toBe("cancelled");
    expect(result.recapEvents).toEqual([]);
    expect(result.scheduled).toBeUndefined();
  });

  it("is for the Host only", () => {
    expect(apply(plannedRoom(), cancel, visitor, 3_000).rejection?.code).toBe("not-host");
  });

  it("is refused once the Room is open: it has to be ended instead", () => {
    const result = apply(liveRoom(), cancel, host, 3_000);
    expect(result.rejection?.code).toBe("room-already-open");
    expect(result.gone).toBeUndefined();
  });

  it("is the only way out of Planning: ending is for an open Room", () => {
    expect(apply(plannedRoom(), endRoom, host, 3_000).rejection?.code).toBe("room-not-open");
  });

  it("is accepted over the wire", () => {
    expect(parseIntent({ type: "cancel-room" })).toEqual(cancel);
  });
});

describe("Middle Ground in the Recap", () => {
  const pickSide = (side: 0 | 1): Intent => ({ type: "pick-side", side });
  const choose = (stepIn: boolean): Intent => ({ type: "choose-middle", stepIn });
  const moveToSide = (personId: string, side: 0 | 1): Intent => ({
    type: "move-to-side",
    personId,
    side,
  });

  /** A Room in Planning with one Middle Ground Round: Cat people vs Dog people. */
  function plannedMiddleGround(): RoomState {
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
          setup: { format: "middle-ground", sides: ["Cat people", "Dog people"] },
          prompts: [{ text: "Cats beat dogs", surprise: false }],
        },
        host,
        1_200,
      ],
    );
  }

  const middleGroundRoom = () => run(plannedMiddleGround(), ...GOING_LIVE);
  const wholeMiddleGroundRecap = (...steps: [Intent, Actor, number][]) =>
    recapOf(plannedMiddleGround(), ...GOING_LIVE, ...steps);

  /** Alex and Sam pick Cat people, the Host moves Sam to Dog people; Alex steps in, Sam stays. */
  const chosen: [Intent, Actor, number][] = [
    [start, host, 3_000],
    [pickSide(0), alex, 3_100],
    [pickSide(0), sam, 3_150],
    [moveToSide(SAM, 1), host, 3_200],
    [choose(true), alex, 3_300],
    [choose(false), sam, 3_400],
  ];

  it("records Sides, the reveal, step-ins and step-backs, and the per-Side summary", () => {
    const events = recapOf(
      middleGroundRoom(),
      ...chosen,
      [choose(true), sam, 3_500],
      [choose(false), alex, 3_600],
      [advance, host, 3_700],
    );
    expect(events.map((e) => e.type)).toEqual([
      "round-started",
      "prompt-started",
      "side-picked",
      "side-picked",
      "side-changed",
      "choices-revealed",
      "stepped-in",
      "stepped-back",
      "prompt-ended",
    ]);
    expect(events.at(-1)).toMatchObject({
      format: "middle-ground",
      sides: [
        { name: "Cat people", steppedIn: 0, onSide: 1 },
        { name: "Dog people", steppedIn: 1, onSide: 1 },
      ],
    });
  });

  it("shows the Sides, each Prompt's choices by Side, the steps after the reveal and its summary card", () => {
    const events = wholeMiddleGroundRecap(
      ...chosen,
      [choose(true), sam, 3_500],
      [advance, host, 3_700],
    );
    const [round] = summarizeRecap(events, 9_000).rounds;
    expect(round!.format).toBe("middle-ground");
    expect(round!.sides.map(({ nickname, side, from }) => [nickname, side, from])).toEqual([
      ["Alex", "Cat people", null],
      ["Sam", "Cat people", null],
      ["Sam", "Dog people", "Cat people"],
    ]);
    const middleGround = round!.prompts[0]!.middleGround!;
    expect(middleGround.revealed).toEqual({
      at: 3_400,
      by: "everyone-chose",
      choices: [
        { personId: ALEX, nickname: "Alex", side: "Cat people", steppedIn: true },
        { personId: SAM, nickname: "Sam", side: "Dog people", steppedIn: false },
      ],
    });
    expect(middleGround.steps).toEqual([
      { at: 3_500, personId: SAM, nickname: "Sam", side: "Dog people", steppedIn: true },
    ]);
    expect(middleGround.summary).toEqual({
      sides: [
        { name: "Cat people", steppedIn: 1, onSide: 1 },
        { name: "Dog people", steppedIn: 1, onSide: 1 },
      ],
    });
  });

  it("ends a Prompt still hidden without giving away anyone's choice when the Room ends", () => {
    const state = run(middleGroundRoom(), ...chosen.slice(0, 5));
    const result = apply(state, endRoom, host, 4_000);
    expect(result.recapEvents.map((e) => e.type)).toEqual(["round-ended", "room-ended"]);
  });

  it("gives a revealed Prompt its summary card when the Room ends", () => {
    const state = run(middleGroundRoom(), ...chosen);
    const result = apply(state, endRoom, host, 4_000);
    expect(result.recapEvents).toEqual([
      expect.objectContaining({ at: 4_000, type: "prompt-ended", format: "middle-ground" }),
      expect.objectContaining({ at: 4_000, type: "round-ended" }),
      { at: 4_000, type: "room-ended" },
    ]);
  });

  it("closes the Prompt's open Mood Check-in when the Room ends", () => {
    const state = run(middleGroundRoom(), ...chosen, [advance, host, 3_700]);
    const result = apply(state, endRoom, host, 4_000);
    expect(result.recapEvents).toEqual([
      expect.objectContaining({
        type: "mood-check-in-closed",
        by: "room-ended",
        moods: { [ALEX]: null, [SAM]: null },
      }),
      expect.objectContaining({ type: "round-ended" }),
      { at: 4_000, type: "room-ended" },
    ]);
  });
});
