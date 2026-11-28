// The Spectrum's orbit after the reveal: where notches, electrons and name pills go.
import { describe, expect, it } from "vite-plus/test";
import {
  ARC_RADIUS,
  CENTER,
  ELECTRON_RADIUS,
  ELECTRON_REACH,
  labelPoint,
  layoutOrbit,
  notchPoint,
  orbitLabel,
  orbitSummary,
  pillName,
  placePills,
  ringRadius,
  VIEW,
} from "./orbit";

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("the notches", () => {
  it("run along the arc from Strongly Disagree on the left to Strongly Agree on the right", () => {
    expect(notchPoint(0).x).toBeCloseTo(CENTER.x - ARC_RADIUS);
    expect(notchPoint(0).y).toBeCloseTo(CENTER.y);
    expect(notchPoint(2).x).toBeCloseTo(CENTER.x);
    expect(notchPoint(2).y).toBeCloseTo(CENTER.y - ARC_RADIUS);
    expect(notchPoint(4).x).toBeCloseTo(CENTER.x + ARC_RADIUS);
  });

  it("keep their labels inside the arc", () => {
    for (let i = 0; i < 5; i++) expect(distance(labelPoint(i), CENTER)).toBeLessThan(ARC_RADIUS);
  });
});

describe("an orbit's electrons", () => {
  it("sizes the first ring by how many people are on it", () => {
    expect([1, 2, 3, 4, 9].map(ringRadius)).toEqual([22, 26, 26, 34, 34]);
  });

  it("sets two people side by side along the arc, neither pointing at the label", () => {
    const { seats, center } = layoutOrbit(2, 2, false);
    expect(seats[0].y).toBeCloseTo(center.y);
    expect(seats[1].y).toBeCloseTo(center.y);
  });

  it("puts one person straight out from the arc", () => {
    const { seats, center } = layoutOrbit(2, 1, false);
    expect(seats[0].x).toBeCloseTo(center.x);
    expect(seats[0].y).toBeCloseTo(center.y - 22);
  });

  it("fans your open orbit over one side, and closed orbits all the way round", () => {
    const open = layoutOrbit(3, 4, true);
    const closed = layoutOrbit(3, 4, false);
    expect(open.fanned).toBe(true);
    expect(closed.fanned).toBe(false);
    const span = (s: { angle: number }[]) => s.at(-1)!.angle - s[0].angle;
    expect(span(open.seats)).toBeCloseTo((170 * Math.PI) / 180);
    expect(span(closed.seats)).toBeCloseTo((3 / 4) * 2 * Math.PI);
    expect(
      closed.seats.some((s) => Math.abs(s.angle - (open.seats[0].angle + Math.PI)) < 0.01),
    ).toBe(false);
  });

  it("goes all the way round when an open orbit is too full to fan out", () => {
    expect(layoutOrbit(3, 5, true).fanned).toBe(false);
  });

  it("adds a second ring past six people, and a +N electron past fourteen", () => {
    expect(layoutOrbit(2, 6, false).rings).toHaveLength(1);
    const seven = layoutOrbit(2, 7, false);
    expect(seven.rings).toEqual([34, 66]);
    expect(seven.seats.filter((s) => s.ring === 1)).toHaveLength(1);
    expect(layoutOrbit(2, 14, false).overflow).toBe(0);
    const crowd = layoutOrbit(2, 25, false);
    expect(crowd.overflow).toBe(12);
    expect(crowd.seats).toHaveLength(13);
    expect(crowd.extra).not.toBeNull();
    expect(crowd.seats).not.toContainEqual(crowd.extra);
  });

  it("keeps every electron off the notch's label, inside the arc", () => {
    for (let i = 0; i < 5; i++) {
      for (let count = 1; count <= 20; count++) {
        const { seats, extra } = layoutOrbit(i, count, false);
        for (const seat of extra ? [...seats, extra] : seats) {
          // The label's first line rises about 12px above its anchor, the baseline.
          expect(distance(seat, labelPoint(i))).toBeGreaterThan(ELECTRON_REACH + 12);
        }
      }
    }
  });

  it("never lets two electrons on one orbit touch, however many people", () => {
    for (const open of [true, false]) {
      for (let count = 1; count <= 30; count++) {
        const { seats: people, extra } = layoutOrbit(1, count, open);
        const seats = extra ? [...people, extra] : people;
        for (let i = 0; i < seats.length; i++) {
          for (let j = i + 1; j < seats.length; j++) {
            expect(distance(seats[i], seats[j])).toBeGreaterThan(ELECTRON_REACH * 2);
          }
        }
      }
    }
  });

  it("keeps neighbouring orbits apart while they have one ring each", () => {
    for (let i = 0; i < 4; i++) {
      const a = layoutOrbit(i, 6, false);
      const b = layoutOrbit(i + 1, 6, false);
      const reach = a.rings[0] + b.rings[0] + 2 * ELECTRON_RADIUS;
      expect(distance(a.center, b.center)).toBeGreaterThan(reach);
    }
  });
});

describe("name pills on your open orbit", () => {
  it("shows a first name and last initial, or You", () => {
    expect(pillName("Marcus Okonkwo-Hale", false)).toBe("Marcus O.");
    expect(pillName("Priya", false)).toBe("Priya");
    expect(pillName("Theo", true)).toBe("You");
  });

  it("fits the design's four names at Agree without overlapping, inside the box", () => {
    const names = ["Priya", "You", "Kiki", "Marcus O."];
    const pills = placePills(layoutOrbit(3, 4, true), names);
    expect(pills).not.toBeNull();
    for (const pill of pills!) {
      expect(pill.x - pill.width / 2).toBeGreaterThanOrEqual(0);
      expect(pill.x + pill.width / 2).toBeLessThanOrEqual(VIEW.width);
    }
  });

  it("gives up on pills for an orbit that can't fan out", () => {
    const layout = layoutOrbit(2, 9, true);
    expect(placePills(layout, Array(9).fill("Ada"))).toBeNull();
  });

  it("gives up on pills when long names would overlap", () => {
    const names = Array(4).fill("Maximilianaxolotlton");
    expect(placePills(layoutOrbit(2, 4, true), names)).toBeNull();
  });
});

describe("what a screen reader hears", () => {
  it("sums up every count, and which notch is yours", () => {
    expect(orbitSummary([2, 2, 1, 4, 2], 3)).toBe(
      "Spectrum: 2 Strongly Disagree, 2 Disagree, 1 Neutral, 4 Agree including you, 2 Strongly Agree",
    );
  });

  it("names everyone in an orbit", () => {
    expect(orbitLabel(3, ["Priya", "You", "Kiki"])).toBe("Agree, 3 people: Priya, You, Kiki");
    expect(orbitLabel(2, ["Sam"])).toBe("Neutral, 1 person: Sam");
    expect(orbitLabel(0, [])).toBe("Strongly Disagree, nobody");
  });
});

describe("pill names with emoji", () => {
  it("keeps an emoji initial whole", () => {
    expect(pillName("Sam 👩‍🚀", false)).toBe("Sam 👩‍🚀.");
  });
});
