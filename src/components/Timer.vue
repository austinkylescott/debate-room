<script setup lang="ts">
// A shared, server-timed countdown (docs/design/components/Timer.md). The
// server owns the deadline; this only draws it. The dial is the atom timer;
// the bar is the surfboard, for headers and the Mood Check-in.
import { computed, nextTick, ref, useId, watch } from "vue";
import { useCountdown } from "../lib/serverClock";
import { clockDigits, timeRemaining, timerAnnouncement } from "../lib/timer";

const props = withDefaults(
  defineProps<{
    /** The server's deadline, in server time. */
    endsAt: number;
    /** The countdown's full length in seconds, for how much of the arc or stripe is left. */
    totalSeconds: number;
    /** What is being timed, to start the accessible name: "Exchange time". */
    label: string;
    variant?: "dial" | "bar";
    /** The server says time is up, whatever this device's clock reads. */
    timeUp?: boolean;
  }>(),
  { variant: "dial", timeUp: false },
);

const countdown = useCountdown(() => !props.timeUp);
const secondsLeft = computed(() => (props.timeUp ? 0 : countdown(props.endsAt)));
const done = computed(() => secondsLeft.value === 0);
/** The last 10 seconds. Not an error, so never red. */
const low = computed(() => !done.value && secondsLeft.value <= 10);
const fraction = computed(() =>
  props.totalSeconds > 0 ? Math.min(1, secondsLeft.value / props.totalSeconds) : 0,
);
const name = computed(() => `${props.label}: ${timeRemaining(secondsLeft.value)}`);

// Spoken only at 30 s, 10 s and 0, through a polite live region. The timer
// itself stays silent (role="timer" is aria-live off), so it never reads every second.
const announcement = ref("");
watch(secondsLeft, async (current, previous) => {
  const said = timerAnnouncement(previous, current);
  if (!said) return;
  // Clear first, so the same words are announced again on a later countdown.
  announcement.value = "";
  await nextTick();
  announcement.value = `${props.label}: ${said}`;
});

// The dial: an arc of radius 30 in an 86px box, drawn from 12 o'clock.
const ARC_R = 30;
const ARC_LENGTH = 2 * Math.PI * ARC_R;
const ORBITS = [0, 60, 120];
// The surfboard: the orange stripe runs from x 22 to 336 of the 358-wide board.
const clipId = `dr-timer-bar-${useId()}`;
const stripeEnd = computed(() => 22 + 314 * fraction.value);
</script>

<template>
  <span class="dr-timer-wrap" :class="{ 'dr-timer-wrap--bar': variant === 'bar' }">
    <span
      v-if="variant === 'dial'"
      class="dr-timer"
      :class="{ 'is-low': low, 'is-done': done }"
      role="timer"
      :aria-label="name"
    >
      <svg viewBox="0 0 86 86" aria-hidden="true">
        <ellipse
          v-for="angle in ORBITS"
          :key="angle"
          class="dr-timer__orbit"
          cx="43"
          cy="43"
          rx="42"
          ry="15.12"
          :transform="`rotate(${angle} 43 43)`"
        />
        <circle class="dr-timer__face" cx="43" cy="43" r="26" />
        <circle
          class="dr-timer__arc"
          cx="43"
          cy="43"
          :r="ARC_R"
          :style="{ strokeDasharray: `${ARC_LENGTH * fraction} ${ARC_LENGTH}` }"
        />
        <g
          v-if="!done"
          class="dr-timer__tip"
          :style="{ transform: `rotate(${fraction * 360}deg)` }"
        >
          <circle cx="43" :cy="43 - ARC_R" r="4" />
        </g>
      </svg>
      <span class="dr-timer__num">{{ done ? "Time" : clockDigits(secondsLeft) }}</span>
    </span>

    <span
      v-else
      class="dr-timer-bar"
      :class="{ 'is-low': low, 'is-done': done }"
      role="timer"
      :aria-label="name"
    >
      <svg viewBox="0 0 358 24" aria-hidden="true">
        <defs>
          <clipPath :id="clipId">
            <rect class="dr-timer-bar__clip" :width="stripeEnd" height="24" />
          </clipPath>
        </defs>
        <path class="dr-timer-bar__board" d="M2,12 C60,-2 298,-2 356,12 C298,26 60,26 2,12Z" />
        <path
          class="dr-timer-bar__stripe"
          :clip-path="`url(#${clipId})`"
          d="M22,12 C80,5 278,5 336,12 C278,19 80,19 22,12Z"
        />
        <circle
          v-if="!done"
          class="dr-timer-bar__tip"
          cx="0"
          cy="12"
          r="3.5"
          :style="{ transform: `translateX(${stripeEnd}px)` }"
        />
      </svg>
      <span class="dr-timer__num">{{ done ? "Time" : clockDigits(secondsLeft) }}</span>
    </span>

    <span class="sr-only" aria-live="polite">{{ announcement }}</span>
  </span>
</template>
