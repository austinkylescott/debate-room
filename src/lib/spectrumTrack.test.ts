// The Spectrum track as the Stage draws it: notch jumps, what a screen reader
// hears, and how markers stack so names stay legible.
import { describe, expect, it } from "vite-plus/test";
import { describePosition, nextNotch, stackLabels } from "./spectrumTrack";

describe("jumping notches (Page Up / Page Down)", () => {
  it("goes to the next notch up or down from between notches", () => {
    expect(nextNotch(62, 1)).toBe(75);
    expect(nextNotch(62, -1)).toBe(50);
  });

  it("moves on to the neighbouring notch when already on one", () => {
    expect(nextNotch(25, 1)).toBe(50);
    expect(nextNotch(25, -1)).toBe(0);
  });

  it("stays put at either end", () => {
    expect(nextNotch(100, 1)).toBe(100);
    expect(nextNotch(0, -1)).toBe(0);
  });
});

describe("what a screen reader hears for a position", () => {
  it("names the notch when the position is on one", () => {
    expect(describePosition(0)).toBe("Strongly Disagree");
    expect(describePosition(75)).toBe("Agree");
  });

  it("gives the number and the notches either side when between them", () => {
    expect(describePosition(62)).toBe("62, between Neutral and Agree");
    expect(describePosition(1)).toBe("1, between Strongly Disagree and Disagree");
  });
});

// Widths are in percent of the track, like positions.
describe("stacking name labels so they don't overlap", () => {
  it("keeps labels that don't touch on the first row", () => {
    const rows = stackLabels([
      { id: "a", position: 10, width: 20 },
      { id: "b", position: 90, width: 20 },
    ]);
    expect(rows).toEqual({ a: 0, b: 0 });
  });

  it("puts a label that would overlap another on the next row up", () => {
    const rows = stackLabels([
      { id: "a", position: 50, width: 20 },
      { id: "b", position: 52, width: 20 },
    ]);
    expect(rows).toEqual({ a: 0, b: 1 });
  });

  it("drops a label back to the lowest row with room", () => {
    const rows = stackLabels([
      { id: "c", position: 80, width: 20 },
      { id: "a", position: 50, width: 20 },
      { id: "b", position: 52, width: 20 },
    ]);
    expect(rows).toEqual({ a: 0, b: 1, c: 0 });
  });

  it("anchors labels at the ends inside the track, so each end's label stays clear of the other", () => {
    // A label at 0 spans 0–30; one at 100 spans 70–100.
    expect(
      stackLabels([
        { id: "low", position: 0, width: 30 },
        { id: "high", position: 100, width: 30 },
      ]),
    ).toEqual({ low: 0, high: 0 });
    // A label at 25 spans 17.5–47.5, so it overlaps the one at 0.
    expect(
      stackLabels([
        { id: "low", position: 0, width: 30 },
        { id: "near", position: 25, width: 30 },
      ]),
    ).toEqual({ low: 0, near: 1 });
  });

  it("stacks fifteen people at the same spot into fifteen rows", () => {
    const labels = Array.from({ length: 15 }, (_, i) => ({ id: `p${i}`, position: 50, width: 25 }));
    expect(new Set(Object.values(stackLabels(labels))).size).toBe(15);
  });
});
