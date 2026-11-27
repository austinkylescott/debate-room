import { describe, expect, it } from "vite-plus/test";
import { TIMER_CHOICES, timerChoice, timerSeconds } from "./speakingTimer";

describe("Speaking timer choices", () => {
  it("offers Off and five lengths, labelled for people", () => {
    expect(TIMER_CHOICES.map((c) => c.label)).toEqual([
      "Off",
      "30 seconds",
      "1 minute",
      "2 minutes",
      "3 minutes",
      "5 minutes",
    ]);
  });

  it("chooses Off when there is no speaking timer", () => {
    expect(timerChoice(null)).toBe("off");
    expect(timerSeconds("off")).toBeNull();
  });

  it("turns a choice into its length in seconds, and back", () => {
    expect(timerSeconds("30")).toBe(30);
    expect(timerSeconds("300")).toBe(300);
    expect(timerChoice(120)).toBe("120");
  });

  it("names every choice by a distinct value", () => {
    const values = TIMER_CHOICES.map((c) => c.value);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(timerChoice(timerSeconds(value))).toBe(value);
  });
});
