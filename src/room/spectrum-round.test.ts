// A Spectrum Round end to end, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  type Actor,
  type ApplyResult,
  type Intent,
  type RoomState,
  type StageView,
  tick,
  viewFor,
} from "./room";
import { CHECK_IN_MS } from "./mood";
import type { RoundSetup } from "./lineup";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const riley: Actor = { token: "riley-device" };
const visitor: Actor = { token: "visitor-device" };

const spectrum: RoundSetup = { format: "spectrum" };

let clock = 10_000;

function attempt(state: RoomState, intent: Intent, actor: Actor): ApplyResult {
  clock += 1;
  return apply(state, intent, actor, clock);
}

/** Lets the Mood Check-in that opens when a Prompt ends run out its time. */
const waitOutCheckIn = "wait-out-check-in";

type Step = [Intent, Actor] | typeof waitOutCheckIn;

/** Applies intents in order, failing loudly if any is rejected. */
function run(state: RoomState, ...steps: Step[]): RoomState {
  return steps.reduce((current, step, i) => {
    if (step === waitOutCheckIn) {
      clock += CHECK_IN_MS;
      return tick(current, clock).state;
    }
    const [intent, actor] = step;
    const result = attempt(current, intent, actor);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

const start = (hostPlaying = false): Intent => ({ type: "start-round", hostPlaying });
const move = (position: number): Intent => ({ type: "move-position", position });
const lockIn = (position: number): Intent => ({ type: "lock-in", position });
const reveal: Intent = { type: "reveal-positions" };
const advance: Intent = { type: "advance" };

/** A Live Room with Alex and Sam in the Waiting Room and the given Rounds in the Lineup. */
function roomWith(...rounds: { setup?: RoundSetup; prompts: string[] }[]): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" });
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(
    created.state,
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host],
    [{ type: "open-room" }, host],
    ...rounds.map((round): [Intent, Actor] => [
      {
        type: "add-round",
        setup: round.setup ?? spectrum,
        prompts: round.prompts.map((text) => ({ text, surprise: false })),
      },
      host,
    ]),
    [{ type: "join", nickname: "Alex" }, alex],
    [{ type: "join", nickname: "Sam" }, sam],
  );
}

function stageOf(state: RoomState, viewer: Actor): StageView {
  const stage = viewFor(state, viewer).stage;
  if (!stage) throw new Error("no Stage in this view");
  return stage;
}

describe("starting a Spectrum Round", () => {
  it("puts the Round's first Prompt on everyone's Stage", () => {
    const state = run(roomWith({ prompts: ["Cats beat dogs", "Pineapple on pizza"] }), [
      start(),
      host,
    ]);
    for (const viewer of [host, alex, sam]) {
      const stage = stageOf(state, viewer);
      expect(stage.format).toBe("spectrum");
      expect(stage.prompt.text).toBe("Cats beat dogs");
      expect(stage.promptNumber).toBe(1);
      expect(stage.promptCount).toBe(2);
    }
  });
});

describe("hidden positions before the reveal", () => {
  const playing = () =>
    run(
      roomWith({ prompts: ["Cats beat dogs", "Pineapple on pizza"] }),
      [start(), host],
      [lockIn(10), alex],
      [move(80), sam],
    );

  it("shows a Playing viewer who has locked in, and no one's position", () => {
    const spectrum = stageOf(playing(), sam).spectrum;
    expect(spectrum.positionsVisible).toBe(false);
    expect(spectrum.people).toEqual([
      { personId: "p1", nickname: "Alex", lockedIn: true, position: null, lockedPosition: null },
      { personId: "p2", nickname: "Sam", lockedIn: false, position: null, lockedPosition: null },
    ]);
  });

  it("shows a Host who isn't Playing where people are hovering and where they locked in", () => {
    const spectrum = stageOf(playing(), host).spectrum;
    expect(spectrum.positionsVisible).toBe(true);
    expect(spectrum.people).toEqual([
      { personId: "p1", nickname: "Alex", lockedIn: true, position: 10, lockedPosition: 10 },
      { personId: "p2", nickname: "Sam", lockedIn: false, position: 80, lockedPosition: null },
    ]);
  });

  it("hides positions from a Host who is Playing", () => {
    const state = run(
      roomWith({ prompts: ["Cats beat dogs"] }),
      [start(true), host],
      [lockIn(10), alex],
      [move(30), host],
    );
    const spectrum = stageOf(state, host).spectrum;
    expect(spectrum.positionsVisible).toBe(false);
    expect(spectrum.people.map((p) => [p.position, p.lockedPosition])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    expect(spectrum.yours).toEqual({ position: 30, lockedPosition: null });
  });

  it("shows a Playing viewer only their own slider", () => {
    expect(stageOf(playing(), sam).spectrum.yours).toEqual({ position: 80, lockedPosition: null });
  });

  it("shows someone who joined mid-Prompt, and isn't Playing it, where people stand", () => {
    const state = run(playing(), [{ type: "join", nickname: "Riley" }, riley]);
    const stage = stageOf(state, riley);
    expect(stage.playing).toBe(false);
    expect(stage.spectrum.positionsVisible).toBe(true);
    expect(stage.spectrum.people.map((p) => [p.position, p.lockedPosition])).toEqual([
      [10, 10],
      [80, null],
    ]);
    expect(stage.spectrum.yours).toBeNull();
  });

  it("hides the next Prompt's positions from them once they're Playing it", () => {
    const state = run(
      playing(),
      [{ type: "join", nickname: "Riley" }, riley],
      [reveal, host],
      [advance, host],
      waitOutCheckIn,
      [advance, host],
      [lockIn(40), alex],
    );
    const spectrum = stageOf(state, riley).spectrum;
    expect(spectrum.positionsVisible).toBe(false);
    expect(spectrum.people.every((p) => p.position === null && p.lockedPosition === null)).toBe(
      true,
    );
  });

  it("shows no Stage to a visitor", () => {
    expect(viewFor(playing(), visitor).stage).toBeNull();
  });
});

describe("revealing positions", () => {
  const started = () =>
    run(roomWith({ prompts: ["Cats beat dogs", "Pineapple"] }), [start(), host]);

  it("reveals automatically once everyone Playing has locked in", () => {
    const result = attempt(run(started(), [lockIn(10), alex]), lockIn(90), sam);
    const spectrum = stageOf(result.state, sam).spectrum;
    expect(spectrum.step).toBe("revealed");
    expect(spectrum.people.map((p) => p.position)).toEqual([10, 90]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "positions-revealed", by: "everyone-locked-in" }),
    );
  });

  it("waits for a Playing Host to lock in too", () => {
    const state = run(
      roomWith({ prompts: ["Cats beat dogs"] }),
      [start(true), host],
      [lockIn(10), alex],
      [lockIn(90), sam],
    );
    expect(stageOf(state, alex).spectrum.step).toBe("positioning");
    expect(stageOf(run(state, [lockIn(50), host]), alex).spectrum.step).toBe("revealed");
  });

  it("lets the Host reveal before everyone has locked in", () => {
    const result = attempt(run(started(), [lockIn(10), alex], [move(70), sam]), reveal, host);
    const spectrum = stageOf(result.state, alex).spectrum;
    expect(spectrum.step).toBe("revealed");
    // Sam never locked in, so where they were hovering stays private.
    expect(spectrum.people.map((p) => p.position)).toEqual([10, null]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "positions-revealed", by: "host" }),
    );
  });

  it("refuses a reveal from anyone but the Host", () => {
    expect(attempt(started(), reveal, alex).rejection?.code).toBe("not-host");
  });

  it("needs a lock-in before the reveal: a locked-in position can't move", () => {
    const state = run(started(), [lockIn(10), alex]);
    expect(attempt(state, move(40), alex).rejection?.code).toBe("already-locked-in");
    expect(attempt(state, lockIn(40), alex).rejection?.code).toBe("already-locked-in");
  });

  it("refuses positions off the Spectrum", () => {
    expect(attempt(started(), lockIn(101), alex).rejection?.code).toBe("position-invalid");
    expect(attempt(started(), move(-1), alex).rejection?.code).toBe("position-invalid");
  });

  it("shows moves after the reveal live to everyone", () => {
    const state = run(started(), [lockIn(10), alex], [lockIn(90), sam], [move(60), alex]);
    for (const viewer of [host, alex, sam]) {
      expect(stageOf(state, viewer).spectrum.people[0]).toMatchObject({
        position: 60,
        lockedPosition: 10,
      });
    }
  });

  it("lets someone who didn't lock in place themselves after a Host reveal", () => {
    const state = run(started(), [lockIn(10), alex], [reveal, host], [move(35), sam]);
    expect(stageOf(state, alex).spectrum.people[1]).toMatchObject({
      position: 35,
      lockedPosition: null,
    });
  });
});

describe("advancing Prompts", () => {
  const twoPrompts = () =>
    run(roomWith({ prompts: ["Cats beat dogs", "Pineapple on pizza"] }), [start(), host]);
  /** Both lock in, then Alex moves after the reveal. */
  const revealedFirst = () =>
    run(twoPrompts(), [lockIn(0), alex], [lockIn(60), sam], [move(80), alex]);

  it("ends a revealed Prompt with a summary of the distribution before and after", () => {
    const spectrum = stageOf(run(revealedFirst(), [advance, host], waitOutCheckIn), sam).spectrum;
    expect(spectrum.step).toBe("summary");
    // Notches: Strongly Disagree, Disagree, Neutral, Agree, Strongly Agree.
    // Before: Alex at 0 and Sam at 60 (nearest Neutral). After: Alex moved to 80 (nearest Agree).
    expect(spectrum.summary).toEqual({ before: [1, 0, 1, 0, 0], after: [0, 0, 1, 1, 0] });
  });

  it("freezes positions once the summary is up", () => {
    const state = run(revealedFirst(), [advance, host]);
    expect(attempt(state, move(10), alex).rejection).toBeDefined();
  });

  it("goes from the summary to the next Prompt, with everyone positioning again", () => {
    const stage = stageOf(
      run(revealedFirst(), [advance, host], waitOutCheckIn, [advance, host]),
      alex,
    );
    expect(stage.prompt.text).toBe("Pineapple on pizza");
    expect(stage.promptNumber).toBe(2);
    expect(stage.spectrum.step).toBe("positioning");
    expect(stage.spectrum.people.every((p) => !p.lockedIn)).toBe(true);
    expect(stage.spectrum.yours).toEqual({ position: null, lockedPosition: null });
  });

  it("can't skip the reveal", () => {
    expect(attempt(twoPrompts(), advance, host).rejection?.code).toBe("not-revealed");
  });

  it("is a Host control", () => {
    expect(attempt(revealedFirst(), advance, alex).rejection?.code).toBe("not-host");
  });

  it("returns everyone to the Waiting Room after the last Prompt's summary", () => {
    const state = run(roomWith({ prompts: ["Cats beat dogs"] }), [start(), host], [reveal, host]);
    const result = attempt(run(state, [advance, host], waitOutCheckIn), advance, host);
    for (const viewer of [host, alex, sam]) expect(viewFor(result.state, viewer).stage).toBeNull();
    expect(result.recapEvents).toContainEqual(expect.objectContaining({ type: "round-ended" }));
  });

  it("records each Prompt's positions before and after in the Recap", () => {
    const result = attempt(revealedFirst(), advance, host);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "prompt-ended",
        before: { p1: 0, p2: 60 },
        after: { p1: 80, p2: 60 },
      }),
    );
  });
});

describe("the Round lifecycle", () => {
  it("tells the Host which Round starts next, and no one else", () => {
    let state = roomWith({ prompts: ["First"] }, { prompts: ["Second"] });
    expect(viewFor(state, host).nextRoundId).toBe("r1");
    expect(viewFor(state, alex).nextRoundId).toBeNull();
    state = run(state, [start(), host], [reveal, host], [advance, host], waitOutCheckIn, [
      advance,
      host,
    ]);
    expect(viewFor(state, host).nextRoundId).toBe("r3");
  });

  it("starts the next unplayed Round in the Lineup each time", () => {
    let state = roomWith({ prompts: ["First"] }, { prompts: ["Second"] });
    state = run(state, [start(), host], [reveal, host], [advance, host], waitOutCheckIn, [
      advance,
      host,
    ]);
    expect(stageOf(run(state, [start(), host]), alex).prompt.text).toBe("Second");
  });

  it("refuses to start when every Round has been played", () => {
    const state = run(
      roomWith({ prompts: ["Only"] }),
      [start(), host],
      [reveal, host],
      [advance, host],
      waitOutCheckIn,
      [advance, host],
    );
    expect(attempt(state, start(), host).rejection?.code).toBe("no-round-to-start");
  });

  it("refuses a second start while a Round is being played", () => {
    const state = run(roomWith({ prompts: ["A"] }, { prompts: ["B"] }), [start(), host]);
    expect(attempt(state, start(), host).rejection?.code).toBe("round-in-progress");
  });

  it("refuses a start from anyone but the Host", () => {
    expect(attempt(roomWith({ prompts: ["A"] }), start(), alex).rejection?.code).toBe("not-host");
  });

  it("refuses to start a Round with no Prompts", () => {
    expect(attempt(roomWith({ prompts: [] }), start(), host).rejection?.code).toBe("round-empty");
  });

  it("only plays Spectrum Rounds for now", () => {
    const state = roomWith({
      setup: { format: "middle-ground", sides: ["Cats", "Dogs"] },
      prompts: ["A"],
    });
    expect(attempt(state, start(), host).rejection?.code).toBe("format-not-available");
  });

  it("records the start in the Recap, with whether the Host is Playing", () => {
    const result = attempt(roomWith({ prompts: ["A"] }), start(true), host);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "round-started", format: "spectrum", hostPlaying: true }),
    );
  });

  it("keeps playing the Prompts it started with when the Lineup is edited mid-Round", () => {
    const state = run(
      roomWith({ prompts: ["A", "B"] }),
      [start(), host],
      [{ type: "remove-round", roundId: "r1" }, host],
    );
    const next = run(state, [reveal, host], [advance, host], waitOutCheckIn, [advance, host]);
    expect(stageOf(next, alex).prompt.text).toBe("B");
  });
});

describe("people coming and going mid-Round", () => {
  it("includes someone who joins mid-Prompt from the next Prompt", () => {
    const state = run(
      roomWith({ prompts: ["A", "B"] }),
      [start(), host],
      [{ type: "join", nickname: "Riley" }, riley],
    );
    expect(stageOf(state, riley).playing).toBe(false);
    expect(attempt(state, lockIn(50), riley).rejection?.code).toBe("not-playing");
    // Everyone already Playing locks in: the late joiner doesn't hold up the reveal.
    const revealed = run(state, [lockIn(10), alex], [lockIn(90), sam]);
    expect(stageOf(revealed, riley).spectrum.step).toBe("revealed");

    const next = run(revealed, [advance, host], waitOutCheckIn, [advance, host]);
    expect(stageOf(next, riley).playing).toBe(true);
    expect(stageOf(next, host).spectrum.people.map((p) => p.nickname)).toEqual([
      "Alex",
      "Sam",
      "Riley",
    ]);
  });

  it("keeps the summary card as it was when someone is removed after the Prompt ended", () => {
    const state = run(
      roomWith({ prompts: ["A", "B"] }),
      [start(), host],
      [lockIn(0), alex],
      [lockIn(100), sam],
      [advance, host],
      waitOutCheckIn,
    );
    const after = run(state, [{ type: "remove-person", personId: "p2" }, host]);
    expect(stageOf(after, alex).spectrum.summary).toEqual({
      before: [1, 0, 0, 0, 1],
      after: [1, 0, 0, 0, 1],
    });
  });

  it("refuses a move from someone who isn't in the Room", () => {
    const state = run(roomWith({ prompts: ["A"] }), [start(), host]);
    expect(attempt(state, lockIn(50), visitor).rejection?.code).toBe("not-in-room");
  });

  it("reveals once the rest have locked in if the Host removes the last holdout", () => {
    const state = run(roomWith({ prompts: ["A"] }), [start(), host], [lockIn(10), alex]);
    const result = attempt(state, { type: "remove-person", personId: "p2" }, host);
    const spectrum = stageOf(result.state, alex).spectrum;
    expect(spectrum.step).toBe("revealed");
    expect(spectrum.people.map((p) => p.nickname)).toEqual(["Alex"]);
  });
});

describe("calling aids after the reveal", () => {
  /** Alex, Sam and Riley Playing a Prompt. */
  const threePlaying = () =>
    run(
      roomWith({ prompts: ["Cats beat dogs", "Pineapple"] }),
      [{ type: "join", nickname: "Riley" }, riley],
      [start(), host],
    );
  const aidsOf = (state: RoomState) => stageOf(state, host).spectrum.callingAids;

  it("flags someone who moved past a notch boundary from where they locked in", () => {
    // Notches sit every 25; the boundaries between them are halfway, at 12.5, 37.5, 62.5 and 87.5.
    const state = run(
      threePlaying(),
      [lockIn(30), alex],
      [lockIn(50), sam],
      [lockIn(70), riley],
      [move(40), alex],
      [move(62), sam],
    );
    expect(aidsOf(state)?.changedMind).toEqual(["p1"]);
  });

  it("clears the flag once they move back within their notch", () => {
    const state = run(
      threePlaying(),
      [lockIn(30), alex],
      [lockIn(50), sam],
      [lockIn(70), riley],
      [move(90), alex],
      [move(26), alex],
    );
    expect(aidsOf(state)?.changedMind).toEqual([]);
  });

  it("counts a position exactly on a boundary toward agreeing", () => {
    const state = run(
      threePlaying(),
      [lockIn(37), alex],
      [lockIn(38), sam],
      [lockIn(70), riley],
      [move(37.5), alex],
      [move(37.5), sam],
    );
    expect(aidsOf(state)?.changedMind).toEqual(["p1"]);
  });

  it("flags a move across several notches, end to end", () => {
    const state = run(
      threePlaying(),
      [lockIn(0), alex],
      [lockIn(100), sam],
      [lockIn(50), riley],
      [move(100), alex],
    );
    expect(aidsOf(state)?.changedMind).toEqual(["p1"]);
  });

  it("doesn't flag someone who never locked in", () => {
    const state = run(threePlaying(), [lockIn(10), alex], [reveal, host], [move(90), sam]);
    expect(aidsOf(state)?.changedMind).toEqual([]);
  });

  it("shows no flags before the reveal", () => {
    expect(aidsOf(run(threePlaying(), [lockIn(10), alex]))).toBeNull();
  });

  it("highlights the lowest and highest positions as furthest apart", () => {
    const state = run(
      threePlaying(),
      [lockIn(50), alex],
      [lockIn(20), sam],
      [lockIn(70), riley],
      [move(95), alex],
    );
    expect(aidsOf(state)?.furthestApart).toEqual({ low: "p2", high: "p1" });
  });

  it("breaks a tie for furthest apart by Waiting Room order", () => {
    const state = run(threePlaying(), [lockIn(80), alex], [lockIn(10), sam], [lockIn(10), riley]);
    expect(aidsOf(state)?.furthestApart).toEqual({ low: "p2", high: "p1" });
    const moved = run(state, [move(10), alex], [move(80), riley]);
    expect(aidsOf(moved)?.furthestApart).toEqual({ low: "p1", high: "p3" });
  });

  it("leaves out anyone with no position when picking furthest apart", () => {
    const state = run(threePlaying(), [lockIn(40), alex], [lockIn(60), sam], [reveal, host]);
    expect(aidsOf(state)?.furthestApart).toEqual({ low: "p1", high: "p2" });
  });

  it("has no one furthest apart when everyone stands in one spot", () => {
    const state = run(threePlaying(), [lockIn(50), alex], [lockIn(50), sam], [lockIn(50), riley]);
    expect(aidsOf(state)?.furthestApart).toBeNull();
  });

  it("has no one furthest apart with only one position", () => {
    const state = run(threePlaying(), [lockIn(50), alex], [reveal, host]);
    expect(aidsOf(state)?.furthestApart).toBeNull();
  });

  it("shows the calling aids to the Host only", () => {
    const state = run(threePlaying(), [lockIn(10), alex], [lockIn(90), sam], [lockIn(50), riley]);
    expect(aidsOf(state)).not.toBeNull();
    for (const viewer of [alex, sam, riley])
      expect(stageOf(state, viewer).spectrum.callingAids).toBeNull();
  });

  it("takes the calling aids down once the Prompt ends", () => {
    const state = run(threePlaying(), [lockIn(10), alex], [reveal, host], [advance, host]);
    expect(aidsOf(state)).toBeNull();
  });
});
