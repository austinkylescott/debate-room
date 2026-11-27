// What a Timer says aloud as a countdown runs: only at 30 s, 10 s and 0.
import { describe, expect, it } from "vite-plus/test";
import { clockDigits, timeRemaining, timerAnnouncement } from "./timer";

describe("timer announcements", () => {
  it("announces when the countdown reaches 30 seconds", () => {
    expect(timerAnnouncement(31, 30)).toBe("30 seconds left");
  });

  it("announces when the countdown reaches 10 seconds", () => {
    expect(timerAnnouncement(11, 10)).toBe("10 seconds left");
  });

  it("announces when time runs out", () => {
    expect(timerAnnouncement(1, 0)).toBe("Time's up");
  });

  it("announces the latest mark passed when ticks were missed", () => {
    // A backgrounded tab can skip from 12 straight to 0.
    expect(timerAnnouncement(12, 0)).toBe("Time's up");
    expect(timerAnnouncement(35, 8)).toBe("10 seconds left");
  });

  it("stays quiet on the first reading, even at a mark", () => {
    // Joining mid-countdown, or a 30-second timer starting, isn't news.
    expect(timerAnnouncement(null, 30)).toBeNull();
    expect(timerAnnouncement(null, 0)).toBeNull();
  });

  it("stays quiet when a new countdown starts above a mark", () => {
    expect(timerAnnouncement(0, 60)).toBeNull();
  });

  it("stays quiet on every other second", () => {
    for (const [from, to] of [
      [45, 44],
      [30, 29],
      [12, 11],
      [10, 9],
      [2, 1],
    ]) {
      expect(timerAnnouncement(from, to)).toBeNull();
    }
  });
});

describe("timer readouts", () => {
  it("names the time remaining in words", () => {
    expect(timeRemaining(42)).toBe("42 seconds remaining");
    expect(timeRemaining(1)).toBe("1 second remaining");
    expect(timeRemaining(65)).toBe("1 minute 5 seconds remaining");
    expect(timeRemaining(120)).toBe("2 minutes remaining");
    expect(timeRemaining(0)).toBe("Time's up");
  });

  it("shows minutes and two-digit seconds", () => {
    expect(clockDigits(42)).toBe("0:42");
    expect(clockDigits(8)).toBe("0:08");
    expect(clockDigits(125)).toBe("2:05");
  });
});
