import { describe, expect, it } from "vite-plus/test";
import { apply, type Intent, parseIntent, type RoomState, viewFor } from "./room";
import {
  alexDevice,
  claimHost,
  hostDevice,
  join,
  liveRoom,
  plannedRoom,
  run,
} from "./test-helpers";

const addSpectrum: Intent = { type: "add-round", setup: { format: "spectrum" } };

const lineupOf = (state: RoomState) => viewFor(state, hostDevice).lineup ?? [];

describe("building the Lineup", () => {
  it("lets the Host add a Round with a Format", () => {
    const state = run(plannedRoom(), [
      { type: "add-round", setup: { format: "spectrum" } },
      hostDevice,
    ]);
    expect(lineupOf(state).map((r) => r.setup.format)).toEqual(["spectrum"]);
  });
});

describe("Round setup per Format", () => {
  it("gives a Middle Ground Round its two Side names", () => {
    const state = run(plannedRoom(), [
      {
        type: "add-round",
        setup: { format: "middle-ground", sides: ["Cat people", "Dog people"] },
      },
      hostDevice,
    ]);
    expect(lineupOf(state)[0]?.setup).toEqual({
      format: "middle-ground",
      sides: ["Cat people", "Dog people"],
    });
  });

  it("rejects a Middle Ground Round with a blank Side name", () => {
    const result = apply(
      plannedRoom(),
      { type: "add-round", setup: { format: "middle-ground", sides: ["Cats", "  "] } },
      hostDevice,
      3_000,
    );
    expect(result.rejection?.code).toBe("setup-invalid");
    expect(lineupOf(result.state)).toEqual([]);
  });

  it("gives a Surrounded Round a Center choice and an exchange timer", () => {
    const state = run(plannedRoom(), [
      {
        type: "add-round",
        setup: { format: "surrounded", center: { mode: "volunteer" }, exchangeSeconds: 90 },
      },
      hostDevice,
    ]);
    expect(lineupOf(state)[0]?.setup).toEqual({
      format: "surrounded",
      center: { mode: "volunteer" },
      exchangeSeconds: 90,
    });
  });

  it("lets the Host pick a person in the Room as the Center", () => {
    const state = run(plannedRoom(), [
      {
        type: "add-round",
        setup: {
          format: "surrounded",
          center: { mode: "chosen", personId: "host" },
          exchangeSeconds: 60,
        },
      },
      hostDevice,
    ]);
    expect(lineupOf(state)[0]?.setup).toMatchObject({
      center: { mode: "chosen", personId: "host" },
    });
  });

  it("rejects a Center who isn't in the Room", () => {
    const result = apply(
      plannedRoom(),
      {
        type: "add-round",
        setup: {
          format: "surrounded",
          center: { mode: "chosen", personId: "p99" },
          exchangeSeconds: 60,
        },
      },
      hostDevice,
      3_000,
    );
    expect(result.rejection?.code).toBe("setup-invalid");
  });

  it("rejects an exchange timer out of range", () => {
    const result = apply(
      plannedRoom(),
      {
        type: "add-round",
        setup: { format: "surrounded", center: { mode: "volunteer" }, exchangeSeconds: 5 },
      },
      hostDevice,
      3_000,
    );
    expect(result.rejection?.code).toBe("setup-invalid");
  });
});

/** A planned Room with one Spectrum Round, r1. */
function roomWithRound(): RoomState {
  return run(plannedRoom(), [addSpectrum, hostDevice]);
}

const promptsOf = (state: RoomState, roundIndex = 0) =>
  (lineupOf(state)[roundIndex]?.prompts ?? []).map((p) => [p.text, p.surprise]);

describe("Prompts in a Round", () => {
  it("adds Prompts to a Round in order, each with its Surprise flag", () => {
    const state = run(roomWithRound(), [
      {
        type: "add-prompts",
        roundId: "r1",
        prompts: [
          { text: "Pineapple belongs on pizza", surprise: false },
          { text: "Cats are better than dogs", surprise: true },
        ],
      },
      hostDevice,
    ]);
    expect(promptsOf(state)).toEqual([
      ["Pineapple belongs on pizza", false],
      ["Cats are better than dogs", true],
    ]);
  });

  it("rejects a blank Prompt and adds none of the batch", () => {
    const result = apply(
      roomWithRound(),
      {
        type: "add-prompts",
        roundId: "r1",
        prompts: [
          { text: "Fine prompt", surprise: false },
          { text: "   ", surprise: false },
        ],
      },
      hostDevice,
      3_000,
    );
    expect(result.rejection?.code).toBe("prompt-invalid");
    expect(promptsOf(result.state)).toEqual([]);
  });

  it("rejects edits to a Round that doesn't exist", () => {
    const result = apply(
      roomWithRound(),
      { type: "add-prompts", roundId: "r9", prompts: [{ text: "Hi", surprise: false }] },
      hostDevice,
      3_000,
    );
    expect(result.rejection?.code).toBe("not-found");
  });
});

/** A planned Room with Round r1 holding Prompts q1 "One", q2 "Two", q3 "Three". */
function roomWithPrompts(): RoomState {
  return run(roomWithRound(), [
    {
      type: "add-prompts",
      roundId: "r1",
      prompts: ["One", "Two", "Three"].map((text) => ({ text, surprise: false })),
    },
    hostDevice,
  ]);
}

describe("editing Prompts", () => {
  it("rewrites a Prompt's text and flags it as a Surprise", () => {
    const state = run(roomWithPrompts(), [
      { type: "edit-prompt", roundId: "r1", promptId: "q2", text: "Two, reworded", surprise: true },
      hostDevice,
    ]);
    expect(promptsOf(state)).toEqual([
      ["One", false],
      ["Two, reworded", true],
      ["Three", false],
    ]);
  });

  it("removes a Prompt", () => {
    const state = run(roomWithPrompts(), [
      { type: "remove-prompt", roundId: "r1", promptId: "q1" },
      hostDevice,
    ]);
    expect(promptsOf(state).map(([text]) => text)).toEqual(["Two", "Three"]);
  });

  it("moves a Prompt to a new position", () => {
    const state = run(roomWithPrompts(), [
      { type: "move-prompt", roundId: "r1", promptId: "q3", toIndex: 0 },
      hostDevice,
    ]);
    expect(promptsOf(state).map(([text]) => text)).toEqual(["Three", "One", "Two"]);
  });

  it("rejects edits to a Prompt that doesn't exist", () => {
    const result = apply(
      roomWithPrompts(),
      { type: "remove-prompt", roundId: "r1", promptId: "q9" },
      hostDevice,
      3_000,
    );
    expect(result.rejection?.code).toBe("not-found");
  });
});

/** A planned Room with Rounds r1 (Spectrum), r2 (Middle Ground) and r3 (Surrounded). */
function roomWithThreeRounds(): RoomState {
  return run(
    plannedRoom(),
    [addSpectrum, hostDevice],
    [{ type: "add-round", setup: { format: "middle-ground", sides: ["A", "B"] } }, hostDevice],
    [
      {
        type: "add-round",
        setup: { format: "surrounded", center: { mode: "volunteer" }, exchangeSeconds: 60 },
      },
      hostDevice,
    ],
  );
}

const formatsOf = (state: RoomState) => lineupOf(state).map((r) => r.setup.format);

describe("editing Rounds", () => {
  it("removes a Round", () => {
    const state = run(roomWithThreeRounds(), [{ type: "remove-round", roundId: "r2" }, hostDevice]);
    expect(formatsOf(state)).toEqual(["spectrum", "surrounded"]);
  });

  it("moves a Round to a new position", () => {
    const state = run(roomWithThreeRounds(), [
      { type: "move-round", roundId: "r1", toIndex: 2 },
      hostDevice,
    ]);
    expect(formatsOf(state)).toEqual(["middle-ground", "surrounded", "spectrum"]);
  });

  it("changes a Round's Format and setup, keeping its Prompts", () => {
    const state = run(roomWithPrompts(), [
      {
        type: "set-round-setup",
        roundId: "r1",
        setup: { format: "middle-ground", sides: ["Early birds", "Night owls"] },
      },
      hostDevice,
    ]);
    expect(lineupOf(state)[0]?.setup).toEqual({
      format: "middle-ground",
      sides: ["Early birds", "Night owls"],
    });
    expect(promptsOf(state).map(([text]) => text)).toEqual(["One", "Two", "Three"]);
  });
});

describe("the single-Format shortcut", () => {
  it("replaces the Lineup with one Round of that Format holding the Pack's Prompts", () => {
    const state = run(roomWithThreeRounds(), [
      {
        type: "use-single-round",
        setup: { format: "middle-ground", sides: ["Cat people", "Dog people"] },
        prompts: [
          { text: "Cats are easier", surprise: false },
          { text: "Dogs are loyal", surprise: false },
        ],
      },
      hostDevice,
    ]);
    const lineup = lineupOf(state);
    expect(lineup).toHaveLength(1);
    expect(lineup[0]?.setup.format).toBe("middle-ground");
    expect(promptsOf(state).map(([text]) => text)).toEqual(["Cats are easier", "Dogs are loyal"]);
  });
});

describe("who can edit the Lineup", () => {
  it("refuses Lineup edits from a visitor who hasn't joined", () => {
    const result = apply(plannedRoom(), addSpectrum, alexDevice, 3_000);
    expect(result.rejection?.code).toBe("not-host");
    expect(lineupOf(result.state)).toEqual([]);
  });

  it("refuses Lineup edits from a Participant", () => {
    const state = run(liveRoom(), [join("Alex"), alexDevice]);
    const result = apply(state, addSpectrum, alexDevice, 3_000);
    expect(result.rejection?.code).toBe("not-host");
    expect(lineupOf(result.state)).toEqual([]);
  });
});

describe("who sees the Lineup", () => {
  it("shows Lineup edits on every device the Host uses", () => {
    const laptop = { token: "host-laptop" };
    const state = run(plannedRoom(), [claimHost(), laptop], [addSpectrum, hostDevice]);
    expect(viewFor(state, laptop).lineup?.map((r) => r.setup.format)).toEqual(["spectrum"]);
  });

  it("keeps the Lineup editable once the Room is Live", () => {
    const state = run(liveRoom(), [addSpectrum, hostDevice]);
    expect(lineupOf(state)).toHaveLength(1);
  });

  it("doesn't send the Lineup to Participants", () => {
    const state = run(liveRoom(), [addSpectrum, hostDevice], [join("Alex"), alexDevice]);
    expect(viewFor(state, alexDevice).lineup).toBeNull();
  });
});

describe("Lineup intents from the wire", () => {
  it("accepts a well-formed Lineup intent", () => {
    const intent = {
      type: "add-prompts",
      roundId: "r1",
      prompts: [{ text: "Hello", surprise: true }],
    };
    expect(parseIntent(intent)).toEqual(intent);
  });

  it.each([
    { type: "add-round", setup: { format: "middle-ground", sides: ["Only one"] } },
    { type: "add-round", setup: { format: "karaoke" } },
    {
      type: "add-round",
      setup: { format: "surrounded", center: { mode: "chosen" }, exchangeSeconds: 60 },
    },
    { type: "add-prompts", roundId: "r1", prompts: "not a list" },
    { type: "add-prompts", roundId: "r1", prompts: [{ text: 42, surprise: false }] },
    { type: "move-round", roundId: "r1", toIndex: "first" },
    { type: "edit-prompt", roundId: "r1", promptId: "q1", text: "Hi" },
  ])("refuses a malformed intent: %j", (raw) => {
    expect(parseIntent(raw)).toBeNull();
  });
});
