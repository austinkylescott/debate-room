// Moods and the Mood Check-in, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  type Actor,
  type ApplyResult,
  type Intent,
  type RoomState,
  type StageView,
  parseIntent,
  tick,
  upgradeState,
  viewFor,
} from "./room";
import type { Mood } from "./mood";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const riley: Actor = { token: "riley-device" };
const visitor: Actor = { token: "visitor-device" };

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
const setMood = (mood: Mood): Intent => ({ type: "set-mood", mood });
const lockIn = (position: number): Intent => ({ type: "lock-in", position });
const reveal: Intent = { type: "reveal-positions" };
const advance: Intent = { type: "advance" };

/** A Live Room with Alex and Sam in the Waiting Room and a Spectrum Round over these Prompts. */
function roomWith(...prompts: string[]): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" });
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(
    created.state,
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host],
    [{ type: "open-room" }, host],
    [
      {
        type: "add-round",
        setup: { format: "spectrum" },
        prompts: prompts.map((text) => ({ text, surprise: false })),
      },
      host,
    ],
    [{ type: "join", nickname: "Alex" }, alex],
    [{ type: "join", nickname: "Sam" }, sam],
  );
}

function stageOf(state: RoomState, viewer: Actor): StageView {
  const stage = viewFor(state, viewer).stage;
  if (!stage) throw new Error("no Stage in this view");
  return stage;
}

describe("setting a Mood", () => {
  it("shows a Playing Participant's Mood live to everyone", () => {
    const state = run(roomWith("A"), [start(), host], [setMood("amused"), alex]);
    for (const viewer of [host, alex, sam]) {
      expect(stageOf(state, viewer).moods).toEqual({ p1: "amused" });
    }
  });

  it("lets a Playing person change their Mood whenever, keeping one at a time", () => {
    const state = run(
      roomWith("A"),
      [start(), host],
      [setMood("thinking"), alex],
      [lockIn(30), alex],
      [lockIn(70), sam],
      [setMood("angry"), alex],
    );
    expect(stageOf(state, sam).moods).toEqual({ p1: "angry" });
  });

  it("lets a Host who is Playing set a Mood", () => {
    const state = run(roomWith("A"), [start(true), host], [setMood("love"), host]);
    expect(stageOf(state, alex).moods).toEqual({ host: "love" });
  });

  it("refuses a Mood from a Host who isn't Playing", () => {
    const state = run(roomWith("A"), [start(), host]);
    expect(attempt(state, setMood("happy"), host).rejection?.code).toBe("not-playing");
  });

  it("refuses a Mood from someone who joined mid-Prompt, until the next Prompt", () => {
    const state = run(
      roomWith("A", "B"),
      [start(), host],
      [{ type: "join", nickname: "Riley" }, riley],
    );
    expect(attempt(state, setMood("happy"), riley).rejection?.code).toBe("not-playing");
  });

  it("refuses a Mood from someone who isn't in the Room", () => {
    const state = run(roomWith("A"), [start(), host]);
    expect(attempt(state, setMood("happy"), visitor).rejection?.code).toBe("not-in-room");
  });

  it("refuses a Mood outside the fixed set", () => {
    const state = run(roomWith("A"), [start(), host]);
    const bogus = { type: "set-mood", mood: "smug" } as unknown as Intent;
    expect(attempt(state, bogus, alex).rejection?.code).toBe("mood-invalid");
  });

  it("starts each Prompt with no Moods", () => {
    const state = run(
      roomWith("A", "B"),
      [start(), host],
      [setMood("sad"), alex],
      [reveal, host],
      [advance, host],
    );
    const next = run(tick(state, clock + 15_000).state, [advance, host]);
    expect(stageOf(next, alex).moods).toEqual({});
  });

  it("records each Mood change in the Recap", () => {
    const state = run(roomWith("A"), [start(), host], [setMood("happy"), alex]);
    expect(attempt(state, setMood("surprised"), alex).recapEvents).toEqual([
      {
        at: clock,
        type: "mood-changed",
        roundId: "r1",
        promptId: expect.any(String),
        personId: "p1",
        mood: "surprised",
      },
    ]);
  });

  it("records nothing when someone picks the Mood they already have", () => {
    const state = run(roomWith("A"), [start(), host], [setMood("happy"), alex]);
    expect(attempt(state, setMood("happy"), alex).recapEvents).toEqual([]);
  });
});

describe("the Mood Check-in", () => {
  /** Alex and Sam have locked in and the positions are out. */
  const revealed = (...prompts: string[]) =>
    run(
      roomWith(...(prompts.length > 0 ? prompts : ["A", "B"])),
      [start(), host],
      [lockIn(20), alex],
      [lockIn(80), sam],
    );

  it("opens when the Host advances a Prompt, before the summary card", () => {
    const result = attempt(revealed(), advance, host);
    for (const viewer of [host, alex, sam]) {
      const stage = stageOf(result.state, viewer);
      expect(stage.checkIn).toEqual({ status: "open", closesAt: clock + 15_000, answered: [] });
      expect(stage.spectrum.summary).toBeNull();
    }
    expect(result.scheduled).toBe(clock + 15_000);
  });

  it("shows who has answered while it's open", () => {
    const state = run(revealed(), [advance, host], [setMood("happy"), sam]);
    expect(stageOf(state, alex).checkIn).toMatchObject({ status: "open", answered: ["p2"] });
  });

  it("closes early once everyone Playing has answered, and shows the tally on the summary card", () => {
    const state = run(revealed(), [advance, host], [setMood("happy"), alex]);
    const result = attempt(state, setMood("angry"), sam);
    const stage = stageOf(result.state, host);
    expect(stage.checkIn).toEqual({
      status: "closed",
      tally: {
        moods: { happy: 1, love: 0, amused: 0, surprised: 0, thinking: 0, sad: 0, angry: 1 },
        noMood: 0,
      },
    });
    expect(stage.spectrum.summary).not.toBeNull();
    expect(result.recapEvents).toContainEqual({
      at: clock,
      type: "mood-check-in-closed",
      roundId: "r1",
      promptId: expect.any(String),
      by: "everyone-answered",
      moods: { p1: "happy", p2: "angry" },
    });
  });

  it("counts confirming the Mood someone already has as an answer", () => {
    const state = run(
      roomWith("A"),
      [start(), host],
      [setMood("thinking"), alex],
      [setMood("sad"), sam],
      [reveal, host],
      [advance, host],
      [setMood("thinking"), alex],
    );
    const result = attempt(state, setMood("sad"), sam);
    expect(stageOf(result.state, alex).checkIn?.status).toBe("closed");
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "mood-check-in-closed",
        moods: { p1: "thinking", p2: "sad" },
      }),
    );
  });

  it("waits for a Host who is Playing to answer too", () => {
    const state = run(
      roomWith("A"),
      [start(true), host],
      [reveal, host],
      [advance, host],
      [setMood("happy"), alex],
      [setMood("happy"), sam],
    );
    expect(stageOf(state, alex).checkIn?.status).toBe("open");
    expect(stageOf(run(state, [setMood("love"), host]), alex).checkIn?.status).toBe("closed");
  });

  it("stays open until 15 seconds have passed", () => {
    const opened = attempt(revealed(), advance, host);
    const result = tick(opened.state, opened.scheduled! - 1);
    expect(stageOf(result.state, alex).checkIn?.status).toBe("open");
    expect(result.recapEvents).toEqual([]);
    // An early tick says when to come back, so the close is never missed.
    expect(result.scheduled).toBe(opened.scheduled);
  });

  it("closes at 15 seconds, recording anyone who didn't answer as no Mood", () => {
    const opened = attempt(revealed(), advance, host);
    const answered = run(opened.state, [setMood("surprised"), alex]);
    const result = tick(answered, opened.scheduled!);
    expect(stageOf(result.state, sam).checkIn).toEqual({
      status: "closed",
      tally: {
        moods: { happy: 0, love: 0, amused: 0, surprised: 1, thinking: 0, sad: 0, angry: 0 },
        noMood: 1,
      },
    });
    expect(stageOf(result.state, sam).spectrum.summary).not.toBeNull();
    expect(result.recapEvents).toEqual([
      {
        at: opened.scheduled,
        type: "mood-check-in-closed",
        roundId: "r1",
        promptId: expect.any(String),
        by: "timeout",
        moods: { p1: "surprised", p2: null },
      },
    ]);
  });

  it("records no Mood for someone who had a Mood during the Prompt but didn't answer", () => {
    const state = run(
      roomWith("A"),
      [start(), host],
      [setMood("happy"), alex],
      [reveal, host],
      [advance, host],
    );
    const result = tick(state, clock + 15_000);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "mood-check-in-closed", moods: { p1: null, p2: null } }),
    );
  });

  it("does nothing on a tick when no Check-in is open", () => {
    const state = run(roomWith("A"), [start(), host]);
    const result = tick(state, clock + 60_000);
    expect(result.state).toBe(state);
    expect(result.recapEvents).toEqual([]);
  });

  it("keeps its close scheduled while open, and nothing once it closes", () => {
    const opened = attempt(revealed(), advance, host);
    const answered = attempt(opened.state, setMood("happy"), alex);
    expect(answered.scheduled).toBe(opened.scheduled);
    expect(attempt(answered.state, setMood("sad"), sam).scheduled).toBeUndefined();
  });

  it("holds the Round until it closes", () => {
    const state = run(revealed(), [advance, host]);
    expect(attempt(state, advance, host).rejection?.code).toBe("check-in-open");
  });

  it("makes the Prompt's Moods final once it closes", () => {
    const state = run(revealed(), [advance, host], [setMood("happy"), alex], [setMood("sad"), sam]);
    expect(attempt(state, setMood("angry"), alex).rejection?.code).toBe("prompt-over");
  });

  it("doesn't ask someone who joined mid-Prompt", () => {
    const state = run(
      roomWith("A", "B"),
      [start(), host],
      [{ type: "join", nickname: "Riley" }, riley],
      [reveal, host],
      [advance, host],
    );
    expect(attempt(state, setMood("happy"), riley).rejection?.code).toBe("not-playing");
    const closed = run(state, [setMood("happy"), alex], [setMood("happy"), sam]);
    expect(stageOf(closed, riley).checkIn?.status).toBe("closed");
  });

  it("closes once the rest have answered if the Host removes the last holdout", () => {
    const state = run(revealed(), [advance, host], [setMood("happy"), alex]);
    const result = attempt(state, { type: "remove-person", personId: "p2" }, host);
    expect(stageOf(result.state, alex).checkIn?.status).toBe("closed");
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "mood-check-in-closed", moods: { p1: "happy" } }),
    );
  });

  it("opens again for the next Prompt", () => {
    const state = run(
      revealed(),
      [advance, host],
      [setMood("happy"), alex],
      [setMood("happy"), sam],
      [advance, host],
      [lockIn(50), alex],
      [lockIn(50), sam],
    );
    expect(stageOf(state, alex).checkIn).toBeNull();
    expect(stageOf(run(state, [advance, host]), alex).checkIn?.status).toBe("open");
  });
});

describe("Mood intents over the wire", () => {
  it("accepts a Mood from the fixed set", () => {
    expect(parseIntent({ type: "set-mood", mood: "love" })).toEqual({
      type: "set-mood",
      mood: "love",
    });
  });

  it.each([{ type: "set-mood", mood: "smug" }, { type: "set-mood" }])(
    "drops a malformed one (%j)",
    (raw) => {
      expect(parseIntent(raw)).toBeNull();
    },
  );
});

describe("Rounds stored before Moods existed", () => {
  it("pick up with no Moods, and still run the Check-in", () => {
    const playing = run(roomWith("A"), [start(), host], [lockIn(20), alex], [lockIn(80), sam]);
    const { moods: _, ...round } = playing.round!;
    const upgraded = upgradeState({ ...playing, round } as RoomState);
    expect(stageOf(upgraded, alex).moods).toEqual({});
    const ended = run(upgraded, [advance, host], [setMood("happy"), alex], [setMood("sad"), sam]);
    expect(stageOf(ended, alex).checkIn?.status).toBe("closed");
  });
});
