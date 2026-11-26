// The Room's clock as this device sees it. The server owns every countdown and
// stamps each message with its own time; this device estimates how far its own
// clock is from the server's, so countdowns show the server's remaining time
// whatever this device's clock says.
import { onBeforeUnmount, ref, watch } from "vue";

export interface ServerClock {
  /** Takes in a server timestamp from a message that has just arrived. */
  observe(serverTime: number): void;
  /** The server's current time, as best this device can tell. */
  now(): number;
  /** Whole seconds until a server deadline, never below zero. */
  secondsLeft(deadline: number): number;
}

/** How many recent messages the offset estimate draws on. */
const SAMPLES = 8;

export function createServerClock(localNow: () => number = Date.now): ServerClock {
  // Each sample is the server's stamp minus this device's time on arrival. A
  // message's time in flight can only make its sample read low, so the highest
  // recent sample is the one least thrown off by latency. Keeping only recent
  // ones lets the estimate follow this device's clock if it is changed.
  let samples: number[] = [];
  let offset = 0;
  const now = () => localNow() + offset;
  return {
    observe(serverTime) {
      // A message from a server without stamps (mid-deploy) leaves the estimate be.
      if (!Number.isFinite(serverTime)) return;
      samples = [...samples.slice(1 - SAMPLES), serverTime - localNow()];
      offset = Math.max(...samples);
    },
    now,
    secondsLeft: (deadline) => Math.max(0, Math.ceil((deadline - now()) / 1000)),
  };
}

/** This device's one server clock, fed by every message from the Room (see useRoom). */
export const serverClock = createServerClock();

/** How often a running countdown redraws. */
const TICK_MS = 250;

/**
 * Every countdown in the UI goes through this. It returns `secondsLeft` on the
 * shared server clock, which redraws while `running()` is true.
 */
export function useCountdown(running: () => boolean): (deadline: number) => number {
  const tick = ref(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  watch(
    running,
    (on) => {
      clearInterval(timer);
      timer = on ? setInterval(() => tick.value++, TICK_MS) : undefined;
    },
    { immediate: true },
  );
  onBeforeUnmount(() => clearInterval(timer));
  return (deadline) => {
    void tick.value; // Redraw on each tick.
    return serverClock.secondsLeft(deadline);
  };
}
