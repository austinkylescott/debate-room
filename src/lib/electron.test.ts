// What an Electron (the person marker) shows: initials on the disc, the pole
// fill for a position, and the Floor marks (who has it, whose hand is up).
import { describe, expect, it } from "vite-plus/test";
import { floorMarks, initials, poleOf } from "./electron";

describe("initials on the disc", () => {
  it("takes the first letter of a one-word name", () => {
    expect(initials("Ada")).toBe("A");
  });

  // The design's own examples (docs/design/previews/Electron.html).
  it("takes the first two words' first letters, splitting a lone word at its hyphen", () => {
    expect(initials("Jordan B")).toBe("JB");
    expect(initials("Alexandria-Rose")).toBe("AR");
    expect(initials("Marcus Okonkwo-Hale")).toBe("MO");
  });

  it("keeps an emoji whole rather than cutting it in half", () => {
    expect(initials("🦊 fox")).toBe("🦊F");
    expect(initials("👩‍🚀 Sam")).toBe("👩‍🚀S");
  });
});

describe("the pole a position fills the disc with", () => {
  it("is Disagree below Neutral, Agree above it, and none on Neutral or while hidden", () => {
    expect(poleOf(0)).toBe("disagree");
    expect(poleOf(49)).toBe("disagree");
    expect(poleOf(50)).toBeNull();
    expect(poleOf(51)).toBe("agree");
    expect(poleOf(100)).toBe("agree");
    expect(poleOf(null)).toBeNull();
  });
});

describe("the Floor marks on someone's electron", () => {
  const floor = {
    holders: [
      { personId: "linus", nickname: "Linus", endsAt: null, durationSeconds: null, timeUp: false },
    ],
    timerSeconds: null,
    raisedHands: [
      { personId: "grace", nickname: "Grace" },
      { personId: "ada", nickname: "Ada" },
    ],
  };

  it("rings whoever has the Floor and numbers raised hands in the order they went up", () => {
    const marks = floorMarks(floor);
    expect(marks("linus")).toEqual({ speaking: true, hand: null });
    expect(marks("grace")).toEqual({ speaking: false, hand: 1 });
    expect(marks("ada")).toEqual({ speaking: false, hand: 2 });
    expect(marks("robin")).toEqual({ speaking: false, hand: null });
  });

  it("marks no one when there's no Floor", () => {
    expect(floorMarks(null)("linus")).toEqual({ speaking: false, hand: null });
  });
});
