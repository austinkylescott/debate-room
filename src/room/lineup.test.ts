// Lineup planning, driven through the Room module's seam: intents in, views out.
import { describe, expect, it } from "vite-plus/test";
import type { NewPrompt, Round, RoundSetup } from "./lineup";
import {
  apply,
  createRoom,
  parseIntent,
  upgradeState,
  type Actor,
  type Intent,
  type RoomState,
  viewFor,
} from "./room";

const HOST_SECRET = "host-secret-123";
const hostDevice: Actor = { token: "host-device" };
const hostLaptop: Actor = { token: "host-laptop" };
const alexDevice: Actor = { token: "alex-device" };
const strangerDevice: Actor = { token: "stranger-device" };

function planningRoom(): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" }, 0);
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(created.state, [{ type: "claim-host", hostSecret: HOST_SECRET }, hostDevice]);
}

/** Applies intents in order, failing loudly if any is rejected. */
function run(state: RoomState, ...steps: [Intent, Actor][]): RoomState {
  return steps.reduce((current, [intent, actor], i) => {
    const result = apply(current, intent, actor, 2_000 + i);
    if (result.rejection) throw new Error(`step ${i} rejected: ${result.rejection.message}`);
    return result.state;
  }, state);
}

/** Applies one intent as the Host and returns its rejection code, if any. */
function refusal(state: RoomState, intent: Intent, actor: Actor = hostDevice) {
  const result = apply(state, intent, actor, 5_000);
  if (result.rejection) expect(result.state).toBe(state);
  return result.rejection?.code;
}

function lineup(state: RoomState, viewer: Actor = hostDevice): Round[] {
  const rounds = viewFor(state, viewer).lineup;
  if (!rounds) throw new Error("this viewer can't see the Lineup");
  return rounds;
}

function promptTexts(state: RoomState, roundIndex = 0): string[] {
  return lineup(state)[roundIndex].prompts.map((p) => p.text);
}

const spectrum: RoundSetup = { format: "spectrum" };
const middleGround = (a = "Cat people", b = "Dog people"): RoundSetup => ({
  format: "middle-ground",
  sides: [a, b],
});
const surrounded = (centerId: string | null = null, exchangeSeconds = 120): RoundSetup => ({
  format: "surrounded",
  centerId,
  exchangeSeconds,
});
const prompts = (...texts: string[]): NewPrompt[] =>
  texts.map((text) => ({ text, surprise: false }));
const addRound = (setup: RoundSetup, newPrompts: NewPrompt[] = []): Intent => ({
  type: "add-round",
  setup,
  prompts: newPrompts,
});

/** A Room in Planning with a Spectrum Round (A, B, C) and a Middle Ground Round (D). */
function plannedRoom(): RoomState {
  return run(
    planningRoom(),
    [addRound(spectrum, prompts("A", "B", "C")), hostDevice],
    [addRound(middleGround(), prompts("D")), hostDevice],
  );
}

const roundId = (state: RoomState, index: number) => lineup(state)[index].id;
const promptId = (state: RoomState, roundIndex: number, index: number) =>
  lineup(state)[roundIndex].prompts[index].id;

describe("the Lineup", () => {
  it("starts empty", () => {
    expect(lineup(planningRoom())).toEqual([]);
  });

  it("is shown in full only to the Host", () => {
    const live = run(
      plannedRoom(),
      [{ type: "open-room" }, hostDevice],
      [{ type: "join", nickname: "Alex" }, alexDevice],
    );
    expect(viewFor(live, alexDevice).lineup).toBeNull();
    expect(viewFor(live, strangerDevice).lineup).toBeNull();
  });

  it("shows the same edits on every device the Host uses", () => {
    const state = run(
      planningRoom(),
      [{ type: "claim-host", hostSecret: HOST_SECRET }, hostLaptop],
      [addRound(spectrum, prompts("Pineapple belongs on pizza")), hostLaptop],
    );
    expect(lineup(state, hostDevice)).toEqual(lineup(state, hostLaptop));
    expect(promptTexts(state)).toEqual(["Pineapple belongs on pizza"]);
  });
});

describe("adding Rounds", () => {
  it("adds Rounds in order, each with its Format, setup and Prompts", () => {
    const rounds = lineup(plannedRoom());
    expect(rounds.map((r) => r.setup)).toEqual([spectrum, middleGround()]);
    expect(rounds[0].prompts.map((p) => p.text)).toEqual(["A", "B", "C"]);
  });

  it("gives every Round and Prompt its own id", () => {
    const rounds = lineup(plannedRoom());
    const ids = [...rounds.map((r) => r.id), ...rounds.flatMap((r) => r.prompts.map((p) => p.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("allows a Round with no Prompts yet", () => {
    const state = run(planningRoom(), [addRound(spectrum), hostDevice]);
    expect(lineup(state)[0].prompts).toEqual([]);
  });

  it("keeps working once the Room is Live", () => {
    const state = run(
      plannedRoom(),
      [{ type: "open-room" }, hostDevice],
      [addRound(spectrum), hostDevice],
    );
    expect(lineup(state)).toHaveLength(3);
  });

  it("is refused once the Room has Ended", () => {
    const ended: RoomState = { ...plannedRoom(), phase: "ended" };
    expect(refusal(ended, addRound(spectrum))).toBe("room-ended");
  });

  it("stops at 20 Rounds", () => {
    const full = run(
      planningRoom(),
      ...Array.from({ length: 20 }, (): [Intent, Actor] => [addRound(spectrum), hostDevice]),
    );
    expect(refusal(full, addRound(spectrum))).toBe("lineup-full");
  });

  it("stops at 30 Prompts in a Round", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Prompt ${i}`);
    expect(refusal(planningRoom(), addRound(spectrum, prompts(...many, "one more")))).toBe(
      "lineup-full",
    );
    const full = run(planningRoom(), [addRound(spectrum, prompts(...many)), hostDevice]);
    expect(
      refusal(full, {
        type: "add-prompts",
        roundId: roundId(full, 0),
        prompts: prompts("one more"),
      }),
    ).toBe("lineup-full");
  });
});

describe("Round setup", () => {
  it("names the two Sides of a Middle Ground Round, tidying whitespace", () => {
    const state = run(planningRoom(), [
      addRound(middleGround("  Cat   people ", "Dog people")),
      hostDevice,
    ]);
    expect(lineup(state)[0].setup).toEqual(middleGround("Cat people", "Dog people"));
  });

  it.each([
    ["an empty Side", middleGround("", "Dog people")],
    ["a Side over 30 characters", middleGround("x".repeat(31), "Dog people")],
    ["two Sides with the same name", middleGround("Cats", "cats")],
  ])("refuses %s", (_, setup) => {
    expect(refusal(planningRoom(), addRound(setup))).toBe("setup-invalid");
  });

  it("lets a Surrounded Round open the Center to volunteers", () => {
    const state = run(planningRoom(), [addRound(surrounded(null, 90)), hostDevice]);
    expect(lineup(state)[0].setup).toEqual(surrounded(null, 90));
  });

  it("lets the Host pick someone in the Room as the Center", () => {
    const live = run(
      planningRoom(),
      [{ type: "open-room" }, hostDevice],
      [{ type: "join", nickname: "Alex" }, alexDevice],
    );
    const alexId = viewFor(live, hostDevice).waitingRoom?.people.find(
      (p) => p.nickname === "Alex",
    )?.id;
    const state = run(live, [addRound(surrounded(alexId ?? "")), hostDevice]);
    expect(lineup(state)[0].setup).toEqual(surrounded(alexId));
  });

  it("refuses a Center who isn't in the Room", () => {
    expect(refusal(planningRoom(), addRound(surrounded("p99")))).toBe("setup-invalid");
  });

  it("frees the Center when the Host removes that person from the Room", () => {
    const live = run(
      planningRoom(),
      [{ type: "open-room" }, hostDevice],
      [{ type: "join", nickname: "Alex" }, alexDevice],
    );
    const withCenter = run(live, [addRound(surrounded("p1")), hostDevice]);
    const removed = run(withCenter, [{ type: "remove-person", personId: "p1" }, hostDevice]);
    expect(lineup(removed)[0].setup).toEqual(surrounded(null));
  });

  it.each([14, 601, 30.5])("refuses an exchange timer of %s seconds", (seconds) => {
    expect(refusal(planningRoom(), addRound(surrounded(null, seconds)))).toBe("setup-invalid");
  });

  it("can change a Round's Format and setup while keeping its Prompts", () => {
    const state = plannedRoom();
    const changed = run(state, [
      { type: "set-round-setup", roundId: roundId(state, 0), setup: surrounded("host", 60) },
      hostDevice,
    ]);
    expect(lineup(changed)[0].setup).toEqual(surrounded("host", 60));
    expect(promptTexts(changed)).toEqual(["A", "B", "C"]);
  });

  it("checks a changed setup like a new one", () => {
    const state = plannedRoom();
    expect(
      refusal(state, {
        type: "set-round-setup",
        roundId: roundId(state, 1),
        setup: middleGround("", ""),
      }),
    ).toBe("setup-invalid");
  });
});

describe("removing and reordering Rounds", () => {
  it("removes a Round", () => {
    const state = plannedRoom();
    const removed = run(state, [{ type: "remove-round", roundId: roundId(state, 0) }, hostDevice]);
    expect(lineup(removed).map((r) => r.setup.format)).toEqual(["middle-ground"]);
  });

  it("moves a Round to a new place in the Lineup", () => {
    const state = run(plannedRoom(), [addRound(surrounded()), hostDevice]);
    const moved = run(state, [
      { type: "move-round", roundId: roundId(state, 2), toIndex: 0 },
      hostDevice,
    ]);
    expect(lineup(moved).map((r) => r.setup.format)).toEqual([
      "surrounded",
      "spectrum",
      "middle-ground",
    ]);
  });

  it.each([-1, 2, 0.5])("refuses to move a Round to position %s", (toIndex) => {
    const state = plannedRoom();
    expect(refusal(state, { type: "move-round", roundId: roundId(state, 0), toIndex })).toBe(
      "position-invalid",
    );
  });

  it("refuses to change a Round that isn't in the Lineup", () => {
    expect(refusal(plannedRoom(), { type: "remove-round", roundId: "r99" })).toBe(
      "round-not-found",
    );
  });
});

describe("editing Prompts", () => {
  it("adds Prompts to the end of a Round", () => {
    const state = plannedRoom();
    const added = run(state, [
      { type: "add-prompts", roundId: roundId(state, 1), prompts: prompts("E", "F") },
      hostDevice,
    ]);
    expect(promptTexts(added, 1)).toEqual(["D", "E", "F"]);
  });

  it("edits a Prompt's text and Surprise flag", () => {
    const state = plannedRoom();
    const edited = run(state, [
      {
        type: "edit-prompt",
        roundId: roundId(state, 0),
        promptId: promptId(state, 0, 1),
        text: "  B, but better ",
        surprise: true,
      },
      hostDevice,
    ]);
    expect(lineup(edited)[0].prompts[1]).toMatchObject({ text: "B, but better", surprise: true });
  });

  it("removes a Prompt", () => {
    const state = plannedRoom();
    const removed = run(state, [
      { type: "remove-prompt", roundId: roundId(state, 0), promptId: promptId(state, 0, 0) },
      hostDevice,
    ]);
    expect(promptTexts(removed)).toEqual(["B", "C"]);
  });

  it("moves a Prompt within its Round", () => {
    const state = plannedRoom();
    const moved = run(state, [
      {
        type: "move-prompt",
        roundId: roundId(state, 0),
        promptId: promptId(state, 0, 2),
        toIndex: 0,
      },
      hostDevice,
    ]);
    expect(promptTexts(moved)).toEqual(["C", "A", "B"]);
  });

  it.each(["", "   ", "x".repeat(201)])("refuses a Prompt of %j", (text) => {
    const state = plannedRoom();
    expect(refusal(state, addRound(spectrum, prompts(text)))).toBe("prompt-invalid");
    expect(
      refusal(state, {
        type: "edit-prompt",
        roundId: roundId(state, 0),
        promptId: promptId(state, 0, 0),
        text,
        surprise: false,
      }),
    ).toBe("prompt-invalid");
  });

  it("refuses to change a Prompt that isn't in the Round", () => {
    const state = plannedRoom();
    // D belongs to the second Round, not the first.
    expect(
      refusal(state, {
        type: "remove-prompt",
        roundId: roundId(state, 0),
        promptId: promptId(state, 1, 0),
      }),
    ).toBe("prompt-not-found");
  });
});

describe("Surprise Prompts", () => {
  it("can be marked when a Prompt is added", () => {
    const state = run(planningRoom(), [
      addRound(spectrum, [
        { text: "Open", surprise: false },
        { text: "Hidden", surprise: true },
      ]),
      hostDevice,
    ]);
    expect(lineup(state)[0].prompts.map((p) => p.surprise)).toEqual([false, true]);
  });
});

describe("the Preview", () => {
  function preview(state: RoomState, viewer: Actor = strangerDevice) {
    const rounds = viewFor(state, viewer).preview;
    if (!rounds) throw new Error("this viewer can't see the Preview");
    return rounds;
  }

  /** Each Round's Prompt texts as the Preview shows them; a Surprise Prompt shows as null. */
  function previewTexts(state: RoomState) {
    return preview(state).map((r) => r.prompts.map((p) => (p.surprise ? null : p.text)));
  }

  it("shows visitors each Round's Format, Sides and Prompts while the Room is in Planning", () => {
    const state = plannedRoom();
    expect(preview(state).map((r) => r.setup)).toEqual([
      { format: "spectrum" },
      { format: "middle-ground", sides: ["Cat people", "Dog people"] },
    ]);
    expect(previewTexts(state)).toEqual([["A", "B", "C"], ["D"]]);
  });

  it("shows Surprise Prompts as placeholders, never with their text", () => {
    const state = run(planningRoom(), [
      addRound(spectrum, [
        { text: "Open", surprise: false },
        { text: "Hidden twist", surprise: true },
      ]),
      hostDevice,
    ]);
    const [open, surprise] = preview(state)[0].prompts;
    expect(open).toMatchObject({ text: "Open" });
    expect(surprise).toMatchObject({ surprise: true });
    expect(surprise).not.toHaveProperty("text");
    expect(JSON.stringify(viewFor(state, strangerDevice))).not.toContain("Hidden twist");
  });

  it("hides a Prompt as soon as the Host marks it a Surprise", () => {
    const state = plannedRoom();
    const edited = run(state, [
      {
        type: "edit-prompt",
        roundId: roundId(state, 0),
        promptId: promptId(state, 0, 1),
        text: "B, now a twist",
        surprise: true,
      },
      hostDevice,
    ]);
    expect(JSON.stringify(viewFor(edited, strangerDevice))).not.toContain("twist");
  });

  it("shows a Surrounded Round's Format without saying who the Center is", () => {
    const state = run(planningRoom(), [addRound(surrounded("host"), prompts("E")), hostDevice]);
    expect(preview(state)[0].setup).toEqual({ format: "surrounded" });
  });

  it("follows the Host's edits", () => {
    const state = plannedRoom();
    const edited = run(
      state,
      [{ type: "move-round", roundId: roundId(state, 1), toIndex: 0 }, hostDevice],
      [
        { type: "remove-prompt", roundId: roundId(state, 0), promptId: promptId(state, 0, 0) },
        hostDevice,
      ],
    );
    expect(previewTexts(edited)).toEqual([["D"], ["B", "C"]]);
  });

  it("is empty while the Host hasn't planned any Rounds", () => {
    expect(preview(planningRoom())).toEqual([]);
  });

  it("isn't sent to the Host, who sees the whole Lineup instead", () => {
    expect(viewFor(plannedRoom(), hostDevice).preview).toBeNull();
  });

  it("goes away once the Room is Live", () => {
    const live = run(plannedRoom(), [{ type: "open-room" }, hostDevice]);
    expect(viewFor(live, strangerDevice).preview).toBeNull();
  });
});

describe("the single-Format shortcut", () => {
  it("replaces the whole Lineup with one Round", () => {
    const state = run(plannedRoom(), [
      {
        type: "plan-single-round",
        setup: middleGround("Morning", "Night"),
        prompts: prompts("X", "Y"),
      },
      hostDevice,
    ]);
    expect(lineup(state)).toHaveLength(1);
    expect(lineup(state)[0].setup).toEqual(middleGround("Morning", "Night"));
    expect(promptTexts(state)).toEqual(["X", "Y"]);
  });

  it("never reuses an id from the Lineup it replaced", () => {
    const before = plannedRoom();
    const oldIds = lineup(before).flatMap((r) => [r.id, ...r.prompts.map((p) => p.id)]);
    const after = run(before, [
      { type: "plan-single-round", setup: spectrum, prompts: prompts("X") },
      hostDevice,
    ]);
    const newIds = lineup(after).flatMap((r) => [r.id, ...r.prompts.map((p) => p.id)]);
    expect(newIds.filter((id) => oldIds.includes(id))).toEqual([]);
  });
});

describe("who can edit the Lineup", () => {
  const live = () =>
    run(
      plannedRoom(),
      [{ type: "open-room" }, hostDevice],
      [{ type: "join", nickname: "Alex" }, alexDevice],
    );

  it.each<[string, (state: RoomState) => Intent]>([
    ["add-round", () => addRound(spectrum)],
    ["plan-single-round", () => ({ type: "plan-single-round", setup: spectrum, prompts: [] })],
    ["remove-round", (s) => ({ type: "remove-round", roundId: roundId(s, 0) })],
    ["move-round", (s) => ({ type: "move-round", roundId: roundId(s, 0), toIndex: 1 })],
    [
      "set-round-setup",
      (s) => ({ type: "set-round-setup", roundId: roundId(s, 0), setup: spectrum }),
    ],
    [
      "add-prompts",
      (s) => ({ type: "add-prompts", roundId: roundId(s, 0), prompts: prompts("Z") }),
    ],
    [
      "edit-prompt",
      (s) => ({
        type: "edit-prompt",
        roundId: roundId(s, 0),
        promptId: promptId(s, 0, 0),
        text: "Z",
        surprise: true,
      }),
    ],
    [
      "remove-prompt",
      (s) => ({ type: "remove-prompt", roundId: roundId(s, 0), promptId: promptId(s, 0, 0) }),
    ],
    [
      "move-prompt",
      (s) => ({
        type: "move-prompt",
        roundId: roundId(s, 0),
        promptId: promptId(s, 0, 0),
        toIndex: 1,
      }),
    ],
  ])("refuses %s from anyone but the Host", (_, makeIntent) => {
    const state = live();
    const intent = makeIntent(state);
    expect(refusal(state, intent, alexDevice)).toBe("not-host");
    expect(refusal(state, intent, strangerDevice)).toBe("not-host");
    expect(refusal(state, intent, hostDevice)).toBeUndefined();
  });
});

describe("Lineup intents over the wire", () => {
  it("accepts well-formed Lineup intents", () => {
    const intent: Intent = addRound(surrounded(null, 90), [{ text: "Hi", surprise: true }]);
    expect(parseIntent(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
  });

  it.each([
    { type: "add-round", setup: { format: "debate" }, prompts: [] },
    { type: "add-round", setup: { format: "middle-ground", sides: ["Only one"] }, prompts: [] },
    { type: "add-round", setup: { format: "spectrum" }, prompts: [{ text: "Hi" }] },
    { type: "add-prompts", roundId: "r1", prompts: "Hi" },
    { type: "move-round", roundId: "r1", toIndex: "0" },
  ])("drops a malformed one (%j)", (raw) => {
    expect(parseIntent(raw)).toBeNull();
  });
});

describe("Rooms stored before the Lineup existed", () => {
  it("get an empty Lineup the Host can edit", () => {
    const { lineup: _, ...stored } = planningRoom();
    const upgraded = upgradeState(stored as RoomState, 0);
    expect(lineup(upgraded)).toEqual([]);
    expect(lineup(run(upgraded, [addRound(spectrum), hostDevice]))).toHaveLength(1);
  });
});
