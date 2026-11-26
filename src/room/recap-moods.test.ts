// Mood insights in the Recap: timelines, Check-in tallies, Mood-to-position
// links and the Room-wide overview, driven through the Room module's public seam
// and derived with summarizeRecap.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  tick,
  type Actor,
  type Intent,
  type RecapEvent,
  type RoomState,
} from "./room";
import type { Mood } from "./mood";
import { summarizeRecap } from "./recap";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };

const ALEX = "p1";
const SAM = "p2";

/** An intent from someone at a time, or the Room's timers ticking at a time. */
type Step = [Intent, Actor, number] | ["tick", number];

/** The Recap events of a Room with these Rounds that went Live with Alex and Sam, then took these steps. */
function recapOf(rounds: Intent[], ...steps: Step[]): RecapEvent[] {
  const created = createRoom(
    { hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" },
    1_000,
  );
  if ("rejection" in created) throw new Error(created.rejection.message);
  const all: Step[] = [
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host, 1_100],
    ...rounds.map((round, i): Step => [round, host, 1_200 + i * 10]),
    [{ type: "open-room" }, host, 1_300],
    [{ type: "join", nickname: "Alex" }, alex, 1_400],
    [{ type: "join", nickname: "Sam" }, sam, 1_500],
    ...steps,
  ];
  const events: RecapEvent[] = [];
  all.reduce((state: RoomState, step, i) => {
    const result = step[0] === "tick" ? tick(state, step[1]) : apply(state, ...step);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    events.push(...result.recapEvents);
    return result.state;
  }, created.state);
  return events;
}

const spectrumRound: Intent = {
  type: "add-round",
  setup: { format: "spectrum" },
  prompts: [
    { text: "Cats beat dogs", surprise: false },
    { text: "Pineapple on pizza", surprise: false },
  ],
};
const middleGroundRound: Intent = {
  type: "add-round",
  setup: { format: "middle-ground", sides: ["Cat people", "Dog people"] },
  prompts: [{ text: "Mornings are best", surprise: false }],
};

const start: Intent = { type: "start-round", hostPlaying: false };
const advance: Intent = { type: "advance" };
const lockIn = (position: number): Intent => ({ type: "lock-in", position });
const move = (position: number): Intent => ({ type: "move-position", position });
const settle = (position: number): Intent => ({ type: "move-position", position, settled: true });
const setMood = (mood: Mood): Intent => ({ type: "set-mood", mood });
const pickSide = (side: 0 | 1): Intent => ({ type: "pick-side", side });
const choose = (stepIn: boolean): Intent => ({ type: "choose-middle", stepIn });

/** A Spectrum Prompt revealed at 3,000 with Alex at Disagree (25) and Sam at Agree (75). */
const revealedSpectrum: Step[] = [
  [start, host, 2_000],
  [lockIn(25), alex, 2_500],
  [lockIn(75), sam, 3_000],
];

const firstPrompt = (events: RecapEvent[], now = 999_999) =>
  summarizeRecap(events, now).rounds[0]!.prompts[0]!;

describe("Mood timeline per person per Prompt", () => {
  it("lists each person's Mood changes in order, people in the order they first set one", () => {
    const events = recapOf(
      [spectrumRound],
      [start, host, 2_000],
      [setMood("thinking"), sam, 2_100],
      [setMood("happy"), alex, 2_200],
      [setMood("angry"), sam, 2_300],
    );
    expect(firstPrompt(events).moods.timelines).toEqual([
      {
        personId: SAM,
        nickname: "Sam",
        changes: [
          { at: 2_100, mood: "thinking" },
          { at: 2_300, mood: "angry" },
        ],
      },
      { personId: ALEX, nickname: "Alex", changes: [{ at: 2_200, mood: "happy" }] },
    ]);
  });
});

describe("Mood Check-in tally per Prompt", () => {
  const none = { happy: 0, love: 0, amused: 0, surprised: 0, thinking: 0, sad: 0, angry: 0 };

  it("counts each Mood answered, and anyone who didn't answer as no Mood", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [setMood("thinking"), sam, 3_100],
      [advance, host, 4_000],
      [setMood("love"), alex, 4_100],
      ["tick", 19_000],
    );
    expect(firstPrompt(events).moods.checkIn).toEqual({
      at: 19_000,
      by: "timeout",
      tally: { moods: { ...none, love: 1 }, noMood: 1 },
      answers: [
        { personId: ALEX, nickname: "Alex", mood: "love" },
        { personId: SAM, nickname: "Sam", mood: null },
      ],
    });
  });

  it("has no tally while the Check-in is still open", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [advance, host, 4_000],
      [setMood("love"), alex, 4_100],
    );
    expect(firstPrompt(events).moods.checkIn).toBeNull();
  });
});

describe("links from a Mood change to the position changes soon after", () => {
  /** Alex goes Surprised at 10,000, then moves from Disagree (25) to Neutral (50) at `movedAt`. */
  const surprisedThenMoved = (movedAt: number) =>
    recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [setMood("surprised"), alex, 10_000],
      [settle(50), alex, movedAt],
    );

  it.each([
    ["well within", 20_000],
    ["just inside", 39_999],
    ["exactly at", 40_000],
  ])("links a move %s 30 seconds after the Mood change", (_, movedAt) => {
    expect(firstPrompt(surprisedThenMoved(movedAt)).moods.links).toEqual([
      {
        personId: ALEX,
        nickname: "Alex",
        mood: "surprised",
        moodAt: 10_000,
        changes: [{ at: movedAt, kind: "moved", from: 25, to: 50 }],
      },
    ]);
  });

  it("doesn't link a move just over 30 seconds after the Mood change", () => {
    expect(firstPrompt(surprisedThenMoved(40_001)).moods.links).toEqual([]);
  });

  it("links a move at the very moment of the Mood change", () => {
    expect(firstPrompt(surprisedThenMoved(10_000)).moods.links).toHaveLength(1);
  });

  it("links every move in the window, each notch crossed and where the slider settled", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [setMood("angry"), alex, 4_000],
      [move(60), alex, 5_000],
      [settle(90), alex, 34_000],
      [settle(100), alex, 34_001],
    );
    expect(firstPrompt(events).moods.links).toEqual([
      expect.objectContaining({
        mood: "angry",
        changes: [
          { at: 5_000, kind: "moved", from: 25, to: 50 },
          { at: 34_000, kind: "moved", from: 50, to: 75 },
          { at: 34_000, kind: "moved", from: 75, to: 90 },
        ],
      }),
    ]);
  });

  it("gives a move to the person's latest Mood change before it", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [setMood("sad"), alex, 4_000],
      [settle(50), alex, 5_000],
      [setMood("amused"), alex, 6_000],
      [setMood("angry"), sam, 6_500],
      [settle(100), alex, 7_000],
    );
    expect(firstPrompt(events).moods.links.map((l) => [l.personId, l.mood, l.changes])).toEqual([
      [ALEX, "sad", [{ at: 5_000, kind: "moved", from: 25, to: 50 }]],
      [
        ALEX,
        "amused",
        [
          { at: 7_000, kind: "moved", from: 50, to: 75 },
          { at: 7_000, kind: "moved", from: 75, to: 100 },
        ],
      ],
    ]);
  });

  it("doesn't link a Mood change that came after the move", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [settle(50), alex, 4_000],
      [setMood("happy"), alex, 4_500],
    );
    expect(firstPrompt(events).moods.links).toEqual([]);
  });

  it("doesn't count settling near the same notch as a position change", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [setMood("thinking"), alex, 4_000],
      [settle(33), alex, 5_000],
    );
    expect(firstPrompt(events).moods.links).toEqual([]);
  });

  it("gives nothing away before the reveal: hovering, lock-ins and hidden choices aren't linked", () => {
    const spectrum = recapOf(
      [spectrumRound],
      [start, host, 2_000],
      [setMood("surprised"), alex, 2_100],
      [move(90), alex, 2_200],
      [lockIn(90), alex, 2_300],
    );
    expect(firstPrompt(spectrum).moods.links).toEqual([]);
    const middleGround = recapOf(
      [middleGroundRound],
      [start, host, 2_000],
      [pickSide(0), alex, 2_100],
      [setMood("love"), alex, 2_200],
      [choose(true), alex, 2_300],
    );
    expect(firstPrompt(middleGround).moods.links).toEqual([]);
  });

  it("doesn't link across Prompts", () => {
    const events = recapOf(
      [spectrumRound],
      ...revealedSpectrum,
      [setMood("happy"), alex, 4_000],
      [setMood("sad"), sam, 4_000],
      [advance, host, 5_000],
      [setMood("happy"), alex, 5_100],
      [setMood("sad"), sam, 5_100],
      [advance, host, 6_000],
      [lockIn(25), alex, 7_000],
      [lockIn(75), sam, 8_000],
      [settle(50), alex, 9_000],
    );
    const [first, second] = summarizeRecap(events, 99_999).rounds[0]!.prompts;
    expect(first!.moods.links).toEqual([]);
    expect(second!.moods.links).toEqual([]);
  });

  it("links Middle Ground step-ins and step-backs", () => {
    const events = recapOf(
      [middleGroundRound],
      [start, host, 2_000],
      [pickSide(0), alex, 2_100],
      [pickSide(1), sam, 2_200],
      [choose(false), alex, 2_300],
      [choose(true), sam, 2_400],
      [setMood("love"), alex, 3_000],
      [choose(true), alex, 33_000],
      [choose(false), alex, 33_001],
      [setMood("angry"), sam, 40_000],
      [choose(false), sam, 41_000],
    );
    expect(firstPrompt(events).moods.links).toEqual([
      {
        personId: ALEX,
        nickname: "Alex",
        mood: "love",
        moodAt: 3_000,
        changes: [{ at: 33_000, kind: "stepped-in", side: "Cat people" }],
      },
      {
        personId: SAM,
        nickname: "Sam",
        mood: "angry",
        moodAt: 40_000,
        changes: [{ at: 41_000, kind: "stepped-back", side: "Dog people" }],
      },
    ]);
  });
});

describe("Room-wide Mood overview by Prompt", () => {
  const none = { happy: 0, love: 0, amused: 0, surprised: 0, thinking: 0, sad: 0, angry: 0 };

  it("lists every Prompt across the Rounds with its Mood changes and Check-in tally", () => {
    const events = recapOf(
      [spectrumRound, middleGroundRound],
      ...revealedSpectrum,
      [setMood("happy"), alex, 3_100],
      [setMood("angry"), alex, 3_200],
      [setMood("angry"), sam, 3_300],
      [advance, host, 4_000],
      [setMood("love"), alex, 4_100],
      [setMood("angry"), sam, 4_200],
      [advance, host, 5_000],
      [lockIn(50), alex, 5_100],
      [lockIn(50), sam, 5_200],
      [advance, host, 6_000],
      ["tick", 21_000],
      [advance, host, 22_000],
      [start, host, 23_000],
      [setMood("sad"), sam, 23_500],
    );
    expect(summarizeRecap(events, 99_999).moodOverview).toEqual([
      {
        roundNumber: 1,
        promptNumber: 1,
        text: "Cats beat dogs",
        moodChanges: { ...none, happy: 1, angry: 2, love: 1 },
        checkIn: { moods: { ...none, love: 1, angry: 1 }, noMood: 0 },
      },
      {
        roundNumber: 1,
        promptNumber: 2,
        text: "Pineapple on pizza",
        moodChanges: none,
        checkIn: { moods: none, noMood: 2 },
      },
      {
        roundNumber: 2,
        promptNumber: 1,
        text: "Mornings are best",
        moodChanges: { ...none, sad: 1 },
        checkIn: null,
      },
    ]);
  });
});
