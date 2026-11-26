// Co-Hosts, driven through the Room module's public seam.
import { describe, expect, it } from "vite-plus/test";
import {
  apply,
  type ApplyResult,
  createRoom,
  type Actor,
  type Intent,
  parseIntent,
  type RecapEvent,
  type RoomState,
  type StageView,
  viewFor,
} from "./room";
import { summarizeRecap } from "./recap";

const HOST_SECRET = "host-secret-123";
const host: Actor = { token: "host-device" };
const alex: Actor = { token: "alex-device" };
const sam: Actor = { token: "sam-device" };
const riley: Actor = { token: "riley-device" };
const casey: Actor = { token: "casey-device" };

const ALEX = "p1";
const SAM = "p2";
const RILEY = "p3";
const CASEY = "p4";

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

const grant = (...personIds: string[]): Intent => ({ type: "grant-co-host", personIds });
const revoke = (personId: string): Intent => ({ type: "revoke-co-host", personId });
const stepDown: Intent = { type: "step-down" };
const setPlaying = (playing: boolean): Intent => ({ type: "set-playing", playing });
const start = (hostPlaying = false): Intent => ({ type: "start-round", hostPlaying });
const reveal: Intent = { type: "reveal-positions" };
const advance: Intent = { type: "advance" };

/**
 * A Live Room with Jordan as Host; Alex, Sam and Riley as Participants and
 * Casey as a Spectator. The Lineup has a Spectrum Round and a Middle Ground Round.
 */
function liveRoom(): RoomState {
  const created = createRoom({ hostSecret: HOST_SECRET, hostNickname: "Jordan", pin: "4821" }, 0);
  if ("rejection" in created) throw new Error(created.rejection.message);
  return run(
    created.state,
    [{ type: "claim-host", hostSecret: HOST_SECRET }, host],
    [{ type: "open-room" }, host],
    [
      {
        type: "add-round",
        setup: { format: "spectrum" },
        prompts: [
          { text: "Cats beat dogs", surprise: false },
          { text: "Pineapple on pizza", surprise: false },
        ],
      },
      host,
    ],
    [
      {
        type: "add-round",
        setup: { format: "middle-ground", sides: ["Cat people", "Dog people"] },
        prompts: [{ text: "Pets belong on the sofa", surprise: false }],
      },
      host,
    ],
    [{ type: "join", nickname: "Alex" }, alex],
    [{ type: "join", nickname: "Sam" }, sam],
    [{ type: "join", nickname: "Riley" }, riley],
    [{ type: "join", nickname: "Casey", as: "spectator" }, casey],
  );
}

function coHostIds(state: RoomState, viewer: Actor = host): string[] {
  return (viewFor(state, viewer).waitingRoom?.people ?? [])
    .filter((p) => p.isCoHost)
    .map((p) => p.id);
}

describe("granting, revoking and stepping down", () => {
  it("lets the Host make several people Co-Hosts at once, and everyone sees who they are", () => {
    const state = run(liveRoom(), [grant(ALEX, SAM), host]);
    for (const viewer of [host, alex, riley, casey]) {
      expect(coHostIds(state, viewer)).toEqual([ALEX, SAM]);
    }
    expect(viewFor(state, alex).runsRoom).toBe(true);
    expect(viewFor(state, riley).runsRoom).toBe(false);
    expect(viewFor(state, host).runsRoom).toBe(true);
  });

  it("records each grant in the Recap", () => {
    const result = attempt(liveRoom(), grant(ALEX, SAM), host);
    expect(result.recapEvents).toEqual([
      { at: clock, type: "co-host-granted", personId: ALEX },
      { at: clock, type: "co-host-granted", personId: SAM },
    ]);
  });

  it("leaves someone who is already a Co-Host as they are", () => {
    const state = run(liveRoom(), [grant(ALEX), host]);
    const again = attempt(state, grant(ALEX, SAM), host);
    expect(again.recapEvents).toEqual([{ at: clock, type: "co-host-granted", personId: SAM }]);
    expect(coHostIds(again.state)).toEqual([ALEX, SAM]);
  });

  it("keeps granting to the Host alone", () => {
    const state = run(liveRoom(), [grant(ALEX), host]);
    expect(attempt(state, grant(SAM), alex).rejection?.code).toBe("not-host");
    expect(attempt(state, grant(SAM), riley).rejection?.code).toBe("not-host");
  });

  it("refuses to make a Spectator a Co-Host, granting nobody", () => {
    const result = attempt(liveRoom(), grant(ALEX, CASEY), host);
    expect(result.rejection?.code).toBe("spectators-watch");
    expect(coHostIds(result.state)).toEqual([]);
  });

  it("refuses someone who isn't in the Room, or the Host", () => {
    expect(attempt(liveRoom(), grant("p99"), host).rejection?.code).toBe("person-not-found");
    expect(attempt(liveRoom(), grant("host"), host).rejection?.code).toBe("person-not-found");
  });

  it("lets the Host revoke a Co-Host, and records it", () => {
    const state = run(liveRoom(), [grant(ALEX, SAM), host]);
    const result = attempt(state, revoke(ALEX), host);
    expect(result.recapEvents).toEqual([{ at: clock, type: "co-host-revoked", personId: ALEX }]);
    expect(coHostIds(result.state)).toEqual([SAM]);
    expect(viewFor(result.state, alex).runsRoom).toBe(false);
  });

  it("keeps revoking to the Host alone, and only for Co-Hosts", () => {
    const state = run(liveRoom(), [grant(ALEX, SAM), host]);
    expect(attempt(state, revoke(SAM), alex).rejection?.code).toBe("not-host");
    expect(attempt(state, revoke(RILEY), host).rejection?.code).toBe("not-co-host");
  });

  it("lets a Co-Host step down, and records it", () => {
    const state = run(liveRoom(), [grant(ALEX), host]);
    const result = attempt(state, stepDown, alex);
    expect(result.recapEvents).toEqual([
      { at: clock, type: "co-host-stepped-down", personId: ALEX },
    ]);
    expect(coHostIds(result.state)).toEqual([]);
  });

  it("only lets a Co-Host step down", () => {
    expect(attempt(liveRoom(), stepDown, riley).rejection?.code).toBe("not-co-host");
    expect(attempt(liveRoom(), stepDown, host).rejection?.code).toBe("not-co-host");
  });

  it("forgets a Co-Host the Host removes from the Room", () => {
    const state = run(
      liveRoom(),
      [grant(ALEX), host],
      [{ type: "remove-person", personId: ALEX }, host],
    );
    expect(coHostIds(state)).toEqual([]);
  });

  it("forgets a Co-Host who takes back the Host role on their device", () => {
    const state = run(
      liveRoom(),
      [grant(ALEX), host],
      [{ type: "claim-host", hostSecret: HOST_SECRET }, alex],
    );
    expect(coHostIds(state)).toEqual([]);
    expect(viewFor(state, alex).you.role).toBe("host");
  });
});

/** Ends the current Prompt with everyone Playing answering the Mood Check-in. */
function finishPrompt(...playing: Actor[]): [Intent, Actor][] {
  return [
    [reveal, host],
    [advance, host],
    ...playing.map((actor): [Intent, Actor] => [{ type: "set-mood", mood: "happy" }, actor]),
    [advance, host],
  ];
}

describe("what a Co-Host can and can't do", () => {
  const withCoHost = () => run(liveRoom(), [grant(ALEX), host]);

  it("lets a Co-Host give and take the Floor and set its timer", () => {
    const given = run(
      withCoHost(),
      [{ type: "give-floor", personId: SAM }, alex],
      [{ type: "set-floor-timer", seconds: 60 }, alex],
      [{ type: "give-floor", personId: RILEY }, alex],
      [{ type: "take-floor", personId: SAM }, alex],
    );
    expect(viewFor(given, alex).floor?.holders.map((h) => h.personId)).toEqual([RILEY]);
    const cleared = run(given, [{ type: "clear-floor" }, alex]);
    expect(viewFor(cleared, alex).floor?.holders).toEqual([]);
  });

  it("lets a Co-Host edit the Lineup, and shows it to them", () => {
    const state = run(withCoHost(), [
      {
        type: "add-round",
        setup: { format: "spectrum" },
        prompts: [{ text: "Tabs beat spaces", surprise: false }],
      },
      alex,
    ]);
    expect(viewFor(state, alex).lineup).toHaveLength(3);
    expect(viewFor(state, alex).nextRoundId).toBe(viewFor(state, host).nextRoundId);
    expect(viewFor(state, sam).lineup).toBeNull();
    expect(viewFor(state, sam).nextRoundId).toBeNull();
  });

  it("lets a Co-Host rename and remove people", () => {
    const state = run(
      withCoHost(),
      [{ type: "rename-person", personId: SAM, nickname: "Sammy" }, alex],
      [{ type: "remove-person", personId: RILEY }, alex],
      [{ type: "remove-person", personId: CASEY }, alex],
    );
    expect(viewFor(state, host).waitingRoom?.people.map((p) => p.nickname)).toEqual([
      "Jordan",
      "Alex",
      "Sammy",
    ]);
    expect(viewFor(state, riley).you.role).toBe("removed");
    expect(viewFor(state, casey).you.role).toBe("removed");
  });

  it("doesn't let a Co-Host remove the Host or another Co-Host", () => {
    const state = run(liveRoom(), [grant(ALEX, SAM), host]);
    const removeHost = attempt(state, { type: "remove-person", personId: "host" }, alex);
    expect(removeHost.rejection?.code).toBe("cant-remove-host");
    const removeCoHost = attempt(state, { type: "remove-person", personId: SAM }, alex);
    expect(removeCoHost.rejection?.code).toBe("not-host");
  });

  it("lets a Co-Host reveal and move the Round on", () => {
    const state = run(withCoHost(), [start(), host], [reveal, alex], [advance, alex]);
    expect(viewFor(state, alex).stage?.checkIn?.status).toBe("open");
  });

  it("lets a Co-Host move people between Sides", () => {
    const state = run(
      withCoHost(),
      [start(), host],
      ...finishPrompt(alex, sam, riley),
      ...finishPrompt(alex, sam, riley),
      [start(), host],
      [{ type: "pick-side", side: 0 }, sam],
      [{ type: "move-to-side", personId: SAM, side: 1 }, alex],
    );
    const people = middleGroundStage(state, host).middleGround.people;
    expect(people.find((p) => p.personId === SAM)?.side).toBe(1);
  });

  it("refuses the Room-level controls to a Co-Host", () => {
    const state = withCoHost();
    const roomLevel: Intent[] = [
      { type: "end-room" },
      { type: "set-participant-limit", limit: 20 },
      grant(SAM),
      revoke(ALEX),
    ];
    for (const intent of roomLevel) {
      expect(attempt(state, intent, alex).rejection?.code).toBe("not-host");
    }
  });

  it("still refuses the running controls to Participants who aren't Co-Hosts", () => {
    const state = run(withCoHost(), [start(), host]);
    const running: Intent[] = [
      reveal,
      advance,
      { type: "give-floor", personId: SAM },
      { type: "set-floor-timer", seconds: 30 },
      { type: "rename-person", personId: SAM, nickname: "Sammy" },
      { type: "remove-person", personId: SAM },
      { type: "remove-round", roundId: viewFor(state, host).lineup![1]!.id },
    ];
    for (const intent of running) {
      expect(attempt(state, intent, riley).rejection?.code).toBe("not-host");
    }
  });

  it("takes the controls away once a Co-Host steps down or is revoked", () => {
    const steppedDown = run(withCoHost(), [stepDown, alex], [start(), host]);
    expect(attempt(steppedDown, reveal, alex).rejection?.code).toBe("not-host");
    expect(viewFor(steppedDown, alex).lineup).toBeNull();
    const revoked = run(withCoHost(), [revoke(ALEX), host], [start(), host]);
    expect(attempt(revoked, reveal, alex).rejection?.code).toBe("not-host");
  });
});

function spectrumStage(
  state: RoomState,
  viewer: Actor,
): Extract<StageView, { format: "spectrum" }> {
  const stage = viewFor(state, viewer).stage;
  if (stage?.format !== "spectrum") throw new Error("not a Spectrum Stage");
  return stage;
}

function middleGroundStage(
  state: RoomState,
  viewer: Actor,
): Extract<StageView, { format: "middle-ground" }> {
  const stage = viewFor(state, viewer).stage;
  if (stage?.format !== "middle-ground") throw new Error("not a Middle Ground Stage");
  return stage;
}

describe("Playing as a Co-Host", () => {
  it("has a new Co-Host Playing, until they choose otherwise between Rounds", () => {
    const state = run(liveRoom(), [grant(ALEX), host]);
    expect(viewFor(state, alex).coHost).toEqual({ playingNextRound: true });
    const sittingOut = run(state, [setPlaying(false), alex]);
    expect(viewFor(sittingOut, alex).coHost).toEqual({ playingNextRound: false });
    expect(viewFor(sittingOut, sam).coHost).toBeNull();
  });

  it("only lets a Co-Host choose, and only between Rounds", () => {
    expect(attempt(liveRoom(), setPlaying(false), sam).rejection?.code).toBe("not-co-host");
    const midRound = run(liveRoom(), [grant(ALEX), host], [start(), host]);
    expect(attempt(midRound, setPlaying(false), alex).rejection?.code).toBe("round-in-progress");
  });

  it("shows a non-Playing Co-Host where people are before the reveal, and calling aids after", () => {
    const state = run(
      liveRoom(),
      [grant(ALEX), host],
      [setPlaying(false), alex],
      [start(), host],
      [{ type: "lock-in", position: 80 }, sam],
      [{ type: "move-position", position: 30 }, riley],
    );
    const stage = spectrumStage(state, alex);
    expect(stage.playing).toBe(false);
    expect(stage.spectrum.positionsVisible).toBe(true);
    expect(stage.spectrum.people.map((p) => [p.personId, p.position])).toEqual([
      [SAM, 80],
      [RILEY, 30],
    ]);
    const revealed = run(state, [reveal, alex]);
    expect(spectrumStage(revealed, alex).spectrum.callingAids).not.toBeNull();
    expect(spectrumStage(revealed, sam).spectrum.callingAids).toBeNull();
  });

  it("hides positions before the reveal from a Playing Co-Host, who still sees calling aids after", () => {
    const state = run(
      liveRoom(),
      [grant(ALEX), host],
      [start(), host],
      [{ type: "lock-in", position: 80 }, sam],
    );
    const stage = spectrumStage(state, alex);
    expect(stage.playing).toBe(true);
    expect(stage.spectrum.positionsVisible).toBe(false);
    expect(stage.spectrum.people.find((p) => p.personId === SAM)?.position).toBeNull();
    const revealed = run(state, [reveal, alex]);
    expect(spectrumStage(revealed, alex).spectrum.callingAids).not.toBeNull();
  });

  it("leaves a non-Playing Co-Host out of the Prompt: no lock-in and no Mood", () => {
    const state = run(liveRoom(), [grant(ALEX), host], [setPlaying(false), alex], [start(), host]);
    const lockIn = attempt(state, { type: "lock-in", position: 50 }, alex);
    expect(lockIn.rejection?.code).toBe("not-playing");
    const mood = attempt(state, { type: "set-mood", mood: "happy" }, alex);
    expect(mood.rejection?.code).toBe("not-playing");
    // Everyone Playing locking in reveals, without waiting for the Co-Host.
    const revealed = run(
      state,
      [{ type: "lock-in", position: 10 }, sam],
      [{ type: "lock-in", position: 90 }, riley],
    );
    expect(spectrumStage(revealed, sam).spectrum.step).toBe("revealed");
  });

  it("shows a non-Playing Co-Host Middle Ground choices before the reveal; a Playing one sees none", () => {
    // Alex and Sam play the Spectrum Round; then Alex sits out the Middle Ground one.
    const state = run(
      liveRoom(),
      [grant(ALEX, SAM), host],
      [start(), host],
      ...finishPrompt(alex, sam, riley),
      ...finishPrompt(alex, sam, riley),
      [setPlaying(false), alex],
      [start(), host],
      [{ type: "pick-side", side: 0 }, sam],
      [{ type: "pick-side", side: 1 }, riley],
      [{ type: "choose-middle", stepIn: true }, sam],
    );
    const alexSees = middleGroundStage(state, alex);
    expect(alexSees.playing).toBe(false);
    expect(alexSees.middleGround.choicesVisible).toBe(true);
    expect(alexSees.middleGround.people.map((p) => p.personId)).toEqual([SAM, RILEY]);
    expect(alexSees.middleGround.people.find((p) => p.personId === SAM)?.inMiddle).toBe(true);
    const samSees = middleGroundStage(state, sam);
    expect(samSees.playing).toBe(true);
    expect(samSees.middleGround.choicesVisible).toBe(false);
    const pickSide = attempt(state, { type: "pick-side", side: 0 }, alex);
    expect(pickSide.rejection?.code).toBe("not-playing");
  });

  it("has a sitting-out Co-Host who steps down Playing from the next Prompt", () => {
    const state = run(
      liveRoom(),
      [grant(ALEX), host],
      [setPlaying(false), alex],
      [start(), host],
      [stepDown, alex],
    );
    // Still out of this Prompt, which they may already have seen.
    expect(spectrumStage(state, alex).playing).toBe(false);
    const next = run(state, ...finishPrompt(sam, riley));
    expect(spectrumStage(next, alex).playing).toBe(true);
    expect(spectrumStage(next, alex).spectrum.positionsVisible).toBe(false);
  });

  it("has a sitting-out Co-Host who is revoked Playing from the next Prompt", () => {
    const state = run(
      liveRoom(),
      [grant(ALEX), host],
      [setPlaying(false), alex],
      [start(), host],
      [revoke(ALEX), host],
      ...finishPrompt(sam, riley),
    );
    expect(spectrumStage(state, alex).playing).toBe(true);
  });
});

describe("Co-Host intents over the wire", () => {
  it("accepts well-formed Co-Host intents and refuses malformed ones", () => {
    for (const intent of [grant(ALEX, SAM), revoke(ALEX), stepDown, setPlaying(false)]) {
      expect(parseIntent(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
    }
    expect(parseIntent({ type: "grant-co-host", personIds: ALEX })).toBeNull();
    expect(parseIntent({ type: "grant-co-host", personIds: [ALEX, 3] })).toBeNull();
    expect(parseIntent({ type: "revoke-co-host" })).toBeNull();
    expect(parseIntent({ type: "set-playing", playing: "no" })).toBeNull();
  });
});

describe("Co-Hosts in the Recap", () => {
  it("lists when each person was made a Co-Host, revoked or stepped down", () => {
    const events: RecapEvent[] = [];
    let state = liveRoom();
    const steps: [Intent, Actor][] = [
      [grant(ALEX, SAM), host],
      [stepDown, alex],
      [revoke(SAM), host],
      [grant(ALEX), host],
    ];
    const times: number[] = [];
    for (const [intent, actor] of steps) {
      const result = attempt(state, intent, actor);
      if (result.rejection) throw new Error(result.rejection.message);
      events.push(...result.recapEvents);
      times.push(clock);
      state = result.state;
    }
    const joins: RecapEvent[] = [
      { at: 1, type: "room-opened", hostNickname: "Jordan" },
      { at: 2, type: "person-joined", personId: ALEX, nickname: "Alex", as: "participant" },
      { at: 3, type: "person-joined", personId: SAM, nickname: "Sam", as: "participant" },
    ];
    const people = summarizeRecap([...joins, ...events], clock).people;
    expect(people.map((p) => [p.personId, p.coHost])).toEqual([
      ["host", []],
      [
        ALEX,
        [
          { at: times[0], change: "granted" },
          { at: times[1], change: "stepped-down" },
          { at: times[3], change: "granted" },
        ],
      ],
      [
        SAM,
        [
          { at: times[0], change: "granted" },
          { at: times[2], change: "revoked" },
        ],
      ],
    ]);
  });
});
