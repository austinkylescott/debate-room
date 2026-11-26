// A Middle Ground Round end to end, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  createRoom,
  type Actor,
  type ApplyResult,
  type Intent,
  type RoomState,
  type StageView,
  viewFor,
} from "./room";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const riley: Actor = { token: "riley-device" };

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
const pickSide = (side: 0 | 1): Intent => ({ type: "pick-side", side });
const stepIn: Intent = { type: "choose-middle", stepIn: true };
const stay: Intent = { type: "choose-middle", stepIn: false };
const reveal: Intent = { type: "reveal-positions" };
const advance: Intent = { type: "advance" };

/** A Live Room with Alex and Sam in the Waiting Room and a Middle Ground Round in the Lineup. */
function roomWith(prompts: string[] = ["Cats beat dogs", "Pineapple on pizza"]): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" });
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(
    created.state,
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host],
    [{ type: "open-room" }, host],
    [
      {
        type: "add-round",
        setup: { format: "middle-ground", sides: ["Cat people", "Dog people"] },
        prompts: prompts.map((text) => ({ text, surprise: false })),
      },
      host,
    ],
    [{ type: "join", nickname: "Alex" }, alex],
    [{ type: "join", nickname: "Sam" }, sam],
  );
}

function middleOf(state: RoomState, viewer: Actor) {
  const stage: StageView | null = viewFor(state, viewer).stage;
  if (!stage) throw new Error("no Stage in this view");
  if (stage.format !== "middle-ground") throw new Error("not a Middle Ground Stage");
  return stage.middleGround;
}

describe("starting a Middle Ground Round", () => {
  it("puts the first Prompt and the two Sides on everyone's Stage", () => {
    const state = run(roomWith(), [start(), host]);
    for (const viewer of [host, alex, sam]) {
      const stage = viewFor(state, viewer).stage;
      expect(stage?.format).toBe("middle-ground");
      expect(stage?.prompt.text).toBe("Cats beat dogs");
      expect(middleOf(state, viewer).sides).toEqual(["Cat people", "Dog people"]);
    }
  });
});

describe("picking Sides", () => {
  const started = (hostPlaying = false) => run(roomWith(), [start(hostPlaying), host]);

  it("puts each Participant on the Side they pick, for everyone to see", () => {
    const state = run(started(), [pickSide(0), alex], [pickSide(1), sam]);
    for (const viewer of [host, alex, sam]) {
      expect(middleOf(state, viewer).people.map((p) => [p.nickname, p.side])).toEqual([
        ["Alex", 0],
        ["Sam", 1],
      ]);
    }
    expect(middleOf(state, alex).yours?.side).toBe(0);
  });

  it("allows lopsided Sides", () => {
    const state = run(started(), [pickSide(1), alex], [pickSide(1), sam]);
    expect(middleOf(state, host).people.map((p) => p.side)).toEqual([1, 1]);
  });

  it("doesn't let a Participant change their own Side once picked", () => {
    const state = run(started(), [pickSide(0), alex]);
    expect(attempt(state, pickSide(1), alex).rejection?.code).toBe("side-already-picked");
  });

  it("lets the Host move someone to the other Side, and logs it", () => {
    const state = run(started(), [pickSide(0), alex]);
    const result = attempt(state, { type: "move-to-side", personId: "p1", side: 1 }, host);
    expect(middleOf(result.state, alex).yours?.side).toBe(1);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "side-changed",
        personId: "p1",
        from: "Cat people",
        to: "Dog people",
      }),
    );
  });

  it("refuses a Side change from anyone but the Host", () => {
    const state = run(started(), [pickSide(0), alex]);
    const result = attempt(state, { type: "move-to-side", personId: "p1", side: 1 }, sam);
    expect(result.rejection?.code).toBe("not-host");
  });

  it("records each pick in the Recap", () => {
    const result = attempt(started(), pickSide(1), sam);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({ type: "side-picked", personId: "p2", side: "Dog people" }),
    );
  });

  it("gives a Host who isn't Playing no Side, and a Playing Host one", () => {
    expect(attempt(started(), pickSide(0), host).rejection?.code).toBe("not-playing");
    const state = run(started(true), [pickSide(0), host]);
    expect(middleOf(state, host).yours?.side).toBe(0);
  });

  it("needs a Side before choosing", () => {
    expect(attempt(started(), stepIn, alex).rejection?.code).toBe("no-side");
  });

  it("refuses Spectrum moves in a Middle Ground Round", () => {
    const result = attempt(started(), { type: "lock-in", position: 50 }, alex);
    expect(result.rejection?.code).toBe("wrong-format");
  });
});

describe("hidden choices before the reveal", () => {
  const choosing = (hostPlaying = false) =>
    run(
      roomWith(),
      [start(hostPlaying), host],
      [pickSide(0), alex],
      [pickSide(1), sam],
      [stepIn, alex],
    );

  it("shows a Playing viewer who has chosen, and no one's choice", () => {
    const view = middleOf(choosing(), sam);
    expect(view.choicesVisible).toBe(false);
    expect(view.people.map((p) => [p.nickname, p.chosen, p.inMiddle])).toEqual([
      ["Alex", true, null],
      ["Sam", false, null],
    ]);
  });

  it("shows a Playing viewer their own choice", () => {
    expect(middleOf(choosing(), alex).yours?.inMiddle).toBe(true);
  });

  it("shows a Host who isn't Playing everyone's choices", () => {
    const view = middleOf(choosing(), host);
    expect(view.choicesVisible).toBe(true);
    expect(view.people.map((p) => p.inMiddle)).toEqual([true, null]);
  });

  it("hides choices from a Host who is Playing", () => {
    const view = middleOf(choosing(true), host);
    expect(view.choicesVisible).toBe(false);
    expect(view.people.map((p) => p.inMiddle)).toEqual([null, null, null]);
  });

  it("makes a choice final until the reveal", () => {
    expect(attempt(choosing(), stay, alex).rejection?.code).toBe("already-chosen");
  });

  it("shows no Stage to a visitor", () => {
    expect(viewFor(choosing(), { token: "visitor-device" }).stage).toBeNull();
  });
});

describe("revealing choices", () => {
  const sided = (hostPlaying = false) =>
    run(roomWith(), [start(hostPlaying), host], [pickSide(0), alex], [pickSide(1), sam]);

  it("reveals automatically once everyone Playing has chosen", () => {
    const result = attempt(run(sided(), [stepIn, alex]), stay, sam);
    const view = middleOf(result.state, alex);
    expect(view.step).toBe("revealed");
    expect(view.choicesVisible).toBe(true);
    expect(view.people.map((p) => p.inMiddle)).toEqual([true, false]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "choices-revealed",
        by: "everyone-chose",
        choices: { p1: true, p2: false },
      }),
    );
  });

  it("waits for a Playing Host to choose too", () => {
    const state = run(sided(true), [stepIn, alex], [stay, sam]);
    expect(middleOf(state, alex).step).toBe("choosing");
  });

  it("lets the Host reveal early, leaving anyone who hadn't chosen with their Side", () => {
    const result = attempt(run(sided(), [stepIn, alex]), reveal, host);
    expect(middleOf(result.state, sam).people.map((p) => p.inMiddle)).toEqual([true, false]);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "choices-revealed",
        by: "host",
        choices: { p1: true, p2: null },
      }),
    );
  });

  it("refuses a reveal from anyone but the Host", () => {
    expect(attempt(sided(), reveal, alex).rejection?.code).toBe("not-host");
  });

  it("lets people step in and back out live after the reveal, and logs each move", () => {
    const revealed = run(sided(), [stepIn, alex], [stay, sam]);
    const stepped = attempt(revealed, stepIn, sam);
    expect(middleOf(stepped.state, alex).people.map((p) => p.inMiddle)).toEqual([true, true]);
    expect(stepped.recapEvents).toContainEqual(
      expect.objectContaining({ type: "stepped-in", personId: "p2", side: "Dog people" }),
    );
    const back = attempt(stepped.state, stay, alex);
    expect(middleOf(back.state, sam).people.map((p) => p.inMiddle)).toEqual([false, true]);
    expect(back.recapEvents).toContainEqual(
      expect.objectContaining({ type: "stepped-back", personId: "p1", side: "Cat people" }),
    );
  });

  it("logs nothing when someone stays where they already are", () => {
    const revealed = run(sided(), [stepIn, alex], [stay, sam]);
    expect(attempt(revealed, stepIn, alex).recapEvents).toEqual([]);
  });
});

describe("the summary card", () => {
  const revealedFirst = () =>
    run(
      roomWith(),
      [{ type: "join", nickname: "Riley" }, riley],
      [start(), host],
      [pickSide(0), alex],
      [pickSide(0), sam],
      [pickSide(1), riley],
      [stepIn, alex],
      [stay, sam],
      [stepIn, riley],
    );

  it("counts how many stepped in from each Side when the Prompt ends", () => {
    const state = run(revealedFirst(), [stay, riley], [advance, host]);
    for (const viewer of [host, alex, riley]) {
      const view = middleOf(state, viewer);
      expect(view.step).toBe("summary");
      expect(view.summary).toEqual({ steppedIn: [1, 0], onSide: [2, 1] });
    }
  });

  it("counts someone the Host moved under their new Side", () => {
    const state = run(
      revealedFirst(),
      [{ type: "move-to-side", personId: "p1", side: 1 }, host],
      [advance, host],
    );
    expect(middleOf(state, alex).summary).toEqual({ steppedIn: [0, 2], onSide: [1, 2] });
  });

  it("records the counts in the Recap", () => {
    const result = attempt(revealedFirst(), advance, host);
    expect(result.recapEvents).toContainEqual(
      expect.objectContaining({
        type: "prompt-ended",
        format: "middle-ground",
        sides: [
          { name: "Cat people", steppedIn: 1, onSide: 2 },
          { name: "Dog people", steppedIn: 1, onSide: 1 },
        ],
      }),
    );
  });

  it("freezes choices once the summary is up", () => {
    const state = run(revealedFirst(), [advance, host]);
    expect(attempt(state, stay, alex).rejection?.code).toBe("choices-frozen");
  });

  it("keeps the summary as it was when someone is removed afterwards", () => {
    const state = run(
      revealedFirst(),
      [advance, host],
      [{ type: "remove-person", personId: "p1" }, host],
    );
    expect(middleOf(state, sam).summary).toEqual({ steppedIn: [1, 1], onSide: [2, 1] });
  });

  it("starts the next Prompt with everyone choosing again on the same Sides", () => {
    const state = run(revealedFirst(), [advance, host], [advance, host]);
    const view = middleOf(state, alex);
    expect(viewFor(state, alex).stage?.prompt.text).toBe("Pineapple on pizza");
    expect(view.step).toBe("choosing");
    expect(view.people.map((p) => [p.side, p.chosen])).toEqual([
      [0, false],
      [0, false],
      [1, false],
    ]);
  });

  it("returns everyone to the Waiting Room after the last Prompt's summary", () => {
    const state = run(
      revealedFirst(),
      [advance, host],
      [advance, host],
      [reveal, host],
      [advance, host],
      [advance, host],
    );
    expect(viewFor(state, alex).stage).toBeNull();
  });

  it("can't skip the reveal", () => {
    const state = run(roomWith(), [start(), host]);
    expect(attempt(state, advance, host).rejection?.code).toBe("not-revealed");
  });
});

describe("people coming and going mid-Round", () => {
  const choosing = () =>
    run(roomWith(), [start(), host], [pickSide(0), alex], [pickSide(1), sam], [stepIn, alex]);

  it("lets someone who joins mid-Prompt pick a Side right away, and choose from the next Prompt", () => {
    const state = run(
      choosing(),
      [{ type: "join", nickname: "Riley" }, riley],
      [pickSide(1), riley],
    );
    expect(middleOf(state, riley).yours).toEqual({ side: 1, playing: false, inMiddle: null });
    expect(attempt(state, stepIn, riley).rejection?.code).toBe("not-playing");
    const next = run(state, [stay, sam], [advance, host], [advance, host], [stepIn, riley]);
    expect(middleOf(next, riley).yours).toEqual({ side: 1, playing: true, inMiddle: true });
  });

  it("doesn't wait on someone who joined mid-Prompt before revealing", () => {
    const state = run(choosing(), [{ type: "join", nickname: "Riley" }, riley], [stay, sam]);
    expect(middleOf(state, alex).step).toBe("revealed");
  });

  it("reveals once the rest have chosen if the Host removes the last holdout", () => {
    const state = run(choosing(), [{ type: "remove-person", personId: "p2" }, host]);
    const view = middleOf(state, alex);
    expect(view.step).toBe("revealed");
    expect(view.people.map((p) => p.nickname)).toEqual(["Alex"]);
  });
});
