// The server clock as a device sees it, driven through its public seam with
// fake device clocks.
import { describe, expect, it } from "vite-plus/test";
import { createServerClock } from "./serverClock";

/** A fake world: the true time, and a device clock that runs `skewMs` off it. */
function world() {
  let trueNow = 1_000_000;
  return {
    advance: (ms: number) => (trueNow += ms),
    get trueNow() {
      return trueNow;
    },
    device: (skewMs: number) => () => trueNow + skewMs,
  };
}

describe("server clock", () => {
  it("shows a skewed device the same countdown as a correct one", () => {
    const w = world();
    const correct = createServerClock(w.device(0));
    const skewed = createServerClock(w.device(-7_000));
    // The server (on true time) says a Floor timer ends in 30 seconds.
    const endsAt = w.trueNow + 30_000;
    for (const clock of [correct, skewed]) clock.observe(w.trueNow);

    w.advance(10_000);

    expect(correct.secondsLeft(endsAt)).toBe(20);
    expect(skewed.secondsLeft(endsAt)).toBe(20);
  });

  it("is not thrown off by a single slow message", () => {
    const w = world();
    const clock = createServerClock(w.device(5_000));
    /** A message the server stamps now, which reaches the device `latencyMs` later. */
    const deliver = (latencyMs: number) => {
      const serverTime = w.trueNow;
      w.advance(latencyMs);
      clock.observe(serverTime);
    };
    deliver(40);
    deliver(60);
    deliver(4_000);

    // Off by no more than the fast messages' latency, not the slow one's.
    expect(Math.abs(clock.now() - w.trueNow)).toBeLessThanOrEqual(60);
  });

  it("shows the deadline as-is before any message arrives", () => {
    const w = world();
    const clock = createServerClock(w.device(0));

    expect(clock.secondsLeft(w.trueNow + 15_000)).toBe(15);
    expect(clock.secondsLeft(w.trueNow - 1_000)).toBe(0);
  });

  it("ignores a message without a server time", () => {
    const w = world();
    const clock = createServerClock(w.device(0));
    clock.observe(undefined as unknown as number);

    expect(clock.secondsLeft(w.trueNow + 15_000)).toBe(15);
  });
});
