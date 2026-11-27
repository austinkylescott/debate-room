// The Atomic shape vocabulary (ported from docs/design/shapes.ts): the helpers
// later Stages draw with. Expected values come from the designer's comments.
import { describe, expect, it } from "vite-plus/test";
import { SHAPES, breatheValues, compassPoints, starburst } from "./shapes";

const NUMBER = /-?\d+(\.\d+)?/g;
const commands = (d: string) => d.replace(NUMBER, "#");
const numbers = (d: string) => (d.match(NUMBER) ?? []).map(Number);

describe("breathing containers", () => {
  it("starts and ends on the shape itself, with two nudged versions between", () => {
    const frames = breatheValues(SHAPES.amoeba).split(";");
    expect(frames).toHaveLength(4);
    expect(frames[0]).toBe(SHAPES.amoeba);
    expect(frames[3]).toBe(SHAPES.amoeba);
    expect(frames[1]).not.toBe(SHAPES.amoeba);
    expect(frames[2]).not.toBe(frames[1]);
  });

  it("keeps every command so SMIL can interpolate between the frames", () => {
    for (const frame of breatheValues(SHAPES.kidney).split(";")) {
      expect(commands(frame)).toBe(commands(SHAPES.kidney));
    }
  });

  it("nudges no coordinate by more than the amplitude", () => {
    const original = numbers(SHAPES.amoeba);
    const nudged = numbers(breatheValues(SHAPES.amoeba, 2).split(";")[1] ?? "");
    expect(nudged).toHaveLength(original.length);
    nudged.forEach((n, i) => expect(Math.abs(n - (original[i] ?? 0))).toBeLessThanOrEqual(2.05));
  });
});

describe("compass star (your notch)", () => {
  it("has 16 points with the long ones at north, east, south and west", () => {
    const points = compassPoints().split(" ");
    expect(points).toHaveLength(16);
    expect(points[0]).toBe("0.0,-50.0");
    expect(points[4]).toBe("50.0,0.0");
    expect(points[8]).toBe("0.0,50.0");
    expect(points[12]).toBe("-50.0,0.0");
  });
});

describe("ball-tipped starburst (a notch)", () => {
  it("has eight spokes by default, alternating long and short", () => {
    const balls = starburst();
    expect(balls).toHaveLength(8);
    expect(balls[0]).toEqual({ x: 50, y: 0, r: 4.5 });
    expect(Math.hypot(balls[1]?.x ?? 0, balls[1]?.y ?? 0)).toBeCloseTo(36);
  });
});
