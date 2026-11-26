// Spectators, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  type ApplyResult,
  createRoom,
  type Actor,
  type CreateRoomInput,
  type Intent,
  type RoomState,
  type StageView,
  viewFor,
} from "./room";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const casey: Actor = { token: "casey-device" };

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

const joinAsParticipant = (nickname: string): Intent => ({
  type: "join",
  nickname,
  as: "participant",
});
const joinAsSpectator = (nickname: string): Intent => ({ type: "join", nickname, as: "spectator" });

/** A Live Room with Jordan as Host and the given Spectrum Prompts as one Round. */
function liveRoom(options: Partial<CreateRoomInput> = {}, prompts = ["Cats beat dogs"]): RoomState {
  const created = createRoom({
    hostSecret: HOST_SECRET,
    hostNickname: "Jordan",
    pin: "4821",
    ...options,
  });
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
  );
}

describe("joining as a Spectator", () => {
  it("lets a person join as a Spectator, and everyone sees them listed apart from the Participants", () => {
    const state = run(
      liveRoom(),
      [joinAsParticipant("Alex"), alex],
      [joinAsSpectator("Casey"), casey],
    );
    expect(viewFor(state, casey).you).toMatchObject({ role: "spectator", nickname: "Casey" });
    for (const viewer of [host, alex, casey]) {
      const waitingRoom = viewFor(state, viewer).waitingRoom;
      expect(waitingRoom?.people.map((p) => p.nickname)).toEqual(["Jordan", "Alex"]);
      expect(waitingRoom?.spectators.map((p) => p.nickname)).toEqual(["Casey"]);
    }
  });

  it("restores the same Spectator when the device comes back", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    const again = attempt(state, joinAsSpectator("Casey"), casey);
    expect(again.rejection).toBeUndefined();
    expect(viewFor(again.state, casey).waitingRoom?.spectators).toHaveLength(1);
  });

  it("keeps nicknames unique across Participants and Spectators", () => {
    const state = run(liveRoom(), [joinAsParticipant("Alex"), alex]);
    expect(attempt(state, joinAsSpectator("alex"), casey).rejection?.code).toBe("nickname-taken");
    const withSpectator = run(state, [joinAsSpectator("Casey"), casey]);
    expect(attempt(withSpectator, joinAsParticipant("Casey"), sam).rejection?.code).toBe(
      "nickname-taken",
    );
  });

  it("records a Spectator's join in the Recap", () => {
    const result = attempt(liveRoom(), joinAsSpectator("Casey"), casey);
    expect(result.recapEvents).toEqual([
      {
        at: clock,
        type: "person-joined",
        personId: expect.any(String),
        nickname: "Casey",
        as: "spectator",
      },
    ]);
  });
});

/** Joins `count` people named `${prefix}1`, `${prefix}2`, … from their own devices. */
function withJoined(state: RoomState, as: "participant" | "spectator", count: number): RoomState {
  const prefix = as === "participant" ? "P" : "S";
  return run(
    state,
    ...Array.from({ length: count }, (_, i): [Intent, Actor] => [
      { type: "join", nickname: `${prefix}${i + 1}`, as },
      { token: `${prefix}-device-${i + 1}` },
    ]),
  );
}

describe("Spectator limit", () => {
  it("lets 25 Spectators join and refuses the 26th", () => {
    const full = withJoined(liveRoom(), "spectator", 25);
    const result = attempt(full, joinAsSpectator("Casey"), casey);
    expect(result.rejection?.code).toBe("spectators-full");
    expect(result.rejection?.message).toContain("25");
    expect(viewFor(result.state, casey).you.role).toBe("visitor");
  });

  it("doesn't count Spectators towards the Participant limit", () => {
    const state = withJoined(liveRoom({ participantLimit: 2 }), "spectator", 5);
    const joined = run(state, [joinAsParticipant("Alex"), alex], [joinAsParticipant("Sam"), sam]);
    expect(viewFor(joined, sam).you.role).toBe("participant");
  });

  it("doesn't count Participants towards the Spectator limit", () => {
    const state = withJoined(liveRoom({ participantLimit: 30 }), "participant", 30);
    const joined = withJoined(state, "spectator", 25);
    expect(viewFor(joined, { token: "S-device-25" }).you.role).toBe("spectator");
  });

  it("still lets a Spectator join when the Participant limit is full", () => {
    const full = withJoined(liveRoom({ participantLimit: 2 }), "participant", 2);
    expect(attempt(full, joinAsParticipant("Casey"), casey).rejection?.code).toBe("room-full");
    const state = run(full, [joinAsSpectator("Casey"), casey]);
    expect(viewFor(state, casey).you.role).toBe("spectator");
  });

  it("shows everyone, including visitors, how many Spectators have joined out of 25", () => {
    const state = withJoined(liveRoom(), "spectator", 3);
    expect(viewFor(state, casey).spectatorCapacity).toEqual({ joined: 3, limit: 25 });
    expect(viewFor(state, casey).capacity).toEqual({ joined: 0, limit: 15 });
  });
});

const start: Intent = { type: "start-round", hostPlaying: false };
const reveal: Intent = { type: "reveal-positions" };
const advance: Intent = { type: "advance" };

function stageOf(state: RoomState, viewer: Actor): StageView {
  const stage = viewFor(state, viewer).stage;
  if (!stage) throw new Error("no Stage in this view");
  return stage;
}

/** Alex and Sam are Participants, Casey a Spectator; Alex has locked in at 80 and Sam hovers at 30. */
function midPrompt(): RoomState {
  return run(
    liveRoom({}, ["Cats beat dogs", "Pineapple on pizza"]),
    [joinAsParticipant("Alex"), alex],
    [joinAsParticipant("Sam"), sam],
    [joinAsSpectator("Casey"), casey],
    [start, host],
    [{ type: "lock-in", position: 80 }, alex],
    [{ type: "move-position", position: 30 }, sam],
  );
}

describe("what a Spectator sees on the Stage", () => {
  it("shows the Stage with the same view as a Playing Participant before the reveal", () => {
    const state = midPrompt();
    const spectators = stageOf(state, casey);
    expect(spectators.playing).toBe(false);
    expect(spectators.spectrum.positionsVisible).toBe(false);
    expect(spectators.spectrum.yours).toBeNull();
    expect(spectators.spectrum.people).toEqual(stageOf(state, sam).spectrum.people);
    expect(JSON.stringify(spectators)).not.toMatch(/80|30/);
  });

  it("hides positions from a Spectator who joins mid-Prompt, unlike a Participant who isn't Playing yet", () => {
    const riley: Actor = { token: "riley-device" };
    const state = run(midPrompt(), [joinAsSpectator("Riley"), riley]);
    expect(stageOf(state, riley).spectrum.positionsVisible).toBe(false);
  });

  it("never shows a Spectator the Host's calling aids", () => {
    const state = run(midPrompt(), [reveal, host]);
    expect(stageOf(state, casey).spectrum.positionsVisible).toBe(true);
    expect(stageOf(state, casey).spectrum.callingAids).toBeNull();
  });

  it("shows the summary card like everyone else", () => {
    const state = run(midPrompt(), [reveal, host], [advance, host]);
    expect(stageOf(state, casey).spectrum.summary).toEqual(stageOf(state, alex).spectrum.summary);
  });

  it("doesn't make a Spectator Playing on the next Prompt", () => {
    const state = run(midPrompt(), [reveal, host], [advance, host], [advance, host]);
    expect(stageOf(state, casey).promptNumber).toBe(2);
    expect(stageOf(state, casey).playing).toBe(false);
    expect(stageOf(state, casey).spectrum.people.map((p) => p.nickname)).toEqual(["Alex", "Sam"]);
  });
});

describe("what a Spectator can't do", () => {
  it.each<Intent>([
    { type: "move-position", position: 40 },
    { type: "lock-in", position: 40 },
  ])("refuses a Spectator's Round intent (%j)", (intent) => {
    const state = midPrompt();
    const result = attempt(state, intent, casey);
    expect(result.rejection?.code).toBe("spectator");
    expect(result.state).toBe(state);
  });

  it.each<Intent>([start, reveal, advance])("refuses a Spectator's Host control (%j)", (intent) => {
    expect(attempt(midPrompt(), intent, casey).rejection?.code).toBe("not-host");
  });

  it("can't make a Spectator the Center of a Surrounded Round", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    const result = attempt(
      state,
      {
        type: "add-round",
        setup: { format: "surrounded", centerId: spectatorIdOf(state, casey), exchangeSeconds: 60 },
        prompts: [{ text: "Cats beat dogs", surprise: false }],
      },
      host,
    );
    expect(result.rejection?.code).toBe("setup-invalid");
  });

  it("refuses a Spectator's raised hand", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    expect(attempt(state, { type: "raise-hand" }, casey).rejection?.code).toBe("spectator");
  });

  it("can't give a Spectator the Floor, but shows them who has it", () => {
    const state = run(
      liveRoom(),
      [joinAsParticipant("Alex"), alex],
      [joinAsSpectator("Casey"), casey],
    );
    const giveCasey = attempt(
      state,
      { type: "give-floor", personId: spectatorIdOf(state, casey) },
      host,
    );
    expect(giveCasey.rejection?.code).toBe("person-not-found");
    const alexId = viewFor(state, alex).you;
    const given = run(state, [
      { type: "give-floor", personId: "personId" in alexId ? alexId.personId : "" },
      host,
    ]);
    expect(viewFor(given, casey).floor?.holders.map((h) => h.nickname)).toEqual(["Alex"]);
  });

  it("doesn't wait for a Spectator before the reveal", () => {
    const state = run(midPrompt(), [{ type: "lock-in", position: 30 }, sam]);
    expect(stageOf(state, casey).spectrum.step).toBe("revealed");
  });
});

function spectatorIdOf(state: RoomState, viewer: Actor): string {
  const you = viewFor(state, viewer).you;
  if (you.role !== "spectator") throw new Error("not a Spectator");
  return you.personId;
}

describe("the Host and Spectators", () => {
  it("lets the Host rename a Spectator, and everyone sees the new nickname", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    const renamed = run(state, [
      { type: "rename-person", personId: spectatorIdOf(state, casey), nickname: "Case" },
      host,
    ]);
    expect(viewFor(renamed, casey).you).toMatchObject({ role: "spectator", nickname: "Case" });
    expect(viewFor(renamed, host).waitingRoom?.spectators.map((p) => p.nickname)).toEqual(["Case"]);
  });

  it("lets the Host remove a Spectator, who can't join again", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    const removed = run(state, [
      { type: "remove-person", personId: spectatorIdOf(state, casey) },
      host,
    ]);
    expect(viewFor(removed, casey).you.role).toBe("removed");
    expect(viewFor(removed, host).waitingRoom?.spectators).toEqual([]);
    expect(viewFor(removed, host).spectatorCapacity.joined).toBe(0);
    expect(attempt(removed, joinAsSpectator("Casey"), casey).rejection?.code).toBe("removed");
  });

  it("lets the Host link take over a device that had joined as a Spectator", () => {
    const state = run(
      liveRoom(),
      [joinAsSpectator("Casey"), casey],
      [{ type: "claim-host", hostSecret: HOST_SECRET }, casey],
    );
    expect(viewFor(state, casey).you.role).toBe("host");
    expect(viewFor(state, host).waitingRoom?.spectators).toEqual([]);
  });
});

const becomeParticipant: Intent = { type: "become-participant" };

describe("switching from Spectator to Participant", () => {
  it("lets a Spectator become a Participant in the Waiting Room, keeping their nickname", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey], [becomeParticipant, casey]);
    expect(viewFor(state, casey).you).toMatchObject({ role: "participant", nickname: "Casey" });
    const waitingRoom = viewFor(state, host).waitingRoom;
    expect(waitingRoom?.people.map((p) => p.nickname)).toEqual(["Jordan", "Casey"]);
    expect(waitingRoom?.spectators).toEqual([]);
  });

  it("keeps the same person id, so the Recap follows them across the switch", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    const before = viewFor(state, casey).you;
    const after = viewFor(run(state, [becomeParticipant, casey]), casey).you;
    expect("personId" in after && after.personId).toBe("personId" in before && before.personId);
  });

  it("records the switch in the Recap", () => {
    const state = run(liveRoom(), [joinAsSpectator("Casey"), casey]);
    const you = viewFor(state, casey).you;
    const result = attempt(state, becomeParticipant, casey);
    expect(result.recapEvents).toEqual([
      {
        at: clock,
        type: "spectator-became-participant",
        personId: "personId" in you ? you.personId : "",
      },
    ]);
  });

  it("is refused while a Round is being played, and allowed once it's over", () => {
    const state = midPrompt();
    expect(attempt(state, becomeParticipant, casey).rejection?.code).toBe("round-in-progress");
    const over = run(
      state,
      [reveal, host],
      [advance, host],
      [advance, host],
      [reveal, host],
      [advance, host],
      [advance, host],
    );
    expect(viewFor(over, casey).stage).toBeNull();
    expect(viewFor(run(over, [becomeParticipant, casey]), casey).you.role).toBe("participant");
  });

  it("is refused when the Participant limit is full", () => {
    const state = run(withJoined(liveRoom({ participantLimit: 2 }), "participant", 2), [
      joinAsSpectator("Casey"),
      casey,
    ]);
    const result = attempt(state, becomeParticipant, casey);
    expect(result.rejection?.code).toBe("room-full");
    expect(viewFor(result.state, casey).you.role).toBe("spectator");
  });

  it("is only for Spectators", () => {
    const state = run(liveRoom(), [joinAsParticipant("Alex"), alex]);
    expect(attempt(state, becomeParticipant, alex).rejection?.code).toBe("not-spectator");
    expect(attempt(state, becomeParticipant, host).rejection?.code).toBe("not-spectator");
    expect(attempt(state, becomeParticipant, casey).rejection?.code).toBe("not-spectator");
  });
});
