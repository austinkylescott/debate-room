<script setup lang="ts">
// A breathing container (AtomicStage.md): small shapes drifting on a back layer,
// the container shape whose edges morph, and content in a fixed inner area that
// never moves. The amoeba holds the Prompt; the kidney holds the Floor.
import { computed } from "vue";
import { breatheValues, SHAPES } from "../design/shapes";
import { usePrefersReducedMotion } from "../lib/reducedMotion";
import AtomShape from "./AtomShape.vue";

const props = defineProps<{ variant: "prompt" | "floor" }>();

interface Drift {
  kind: InstanceType<typeof AtomShape>["$props"]["kind"];
  fill?: string;
  /** Centre, in percent of the zone. */
  x: number;
  y: number;
  /** Size in px, and turn in degrees. */
  size: number;
  rotate?: number;
  /** The drift: seconds per swing, how far (px) and how much it turns, and its head start. */
  d: number;
  dx: number;
  dy: number;
  dr: number;
  delay?: number;
}

// Positions and drifts from the design's preview (previews/AtomicStage.html), in its
// 370×214 and 370×132 boxes, turned into percentages.
const PROMPT: Drift[] = [
  {
    kind: "boomerang",
    fill: "fill-mustard",
    x: 19,
    y: 90,
    size: 110,
    rotate: -12,
    d: 18,
    dx: 10,
    dy: -6,
    dr: 6,
  },
  {
    kind: "kidney",
    fill: "fill-pink",
    x: 89,
    y: 19,
    size: 70,
    rotate: 30,
    d: 20,
    dx: -8,
    dy: 8,
    dr: -10,
    delay: -4,
  },
  { kind: "burst", x: 92, y: 87, size: 38, d: 15, dx: -6, dy: -8, dr: 20, delay: -2 },
  {
    kind: "sparkle",
    fill: "fill-ink",
    x: 6,
    y: 13,
    size: 22,
    d: 14,
    dx: 6,
    dy: 8,
    dr: 30,
    delay: -6,
  },
  {
    kind: "leaf-spine",
    fill: "fill-teal",
    x: 4,
    y: 65,
    size: 34,
    rotate: -30,
    d: 17,
    dx: 8,
    dy: -10,
    dr: -12,
    delay: -8,
  },
  { kind: "dots", x: 83, y: 8, size: 20, d: 12, dx: -8, dy: 6, dr: 0 },
];
const FLOOR: Drift[] = [
  { kind: "sparkle", fill: "fill-ink", x: 95, y: 11, size: 20, d: 13, dx: -6, dy: 6, dr: 25 },
  // Mustard, not the preview's orange: the spark stays for "your move" (hard rule 2).
  {
    kind: "boomerang",
    fill: "fill-mustard",
    x: 86,
    y: 80,
    size: 64,
    rotate: 150,
    d: 19,
    dx: -6,
    dy: -4,
    dr: -8,
    delay: -5,
  },
  { kind: "burst", x: 4, y: 15, size: 26, d: 16, dx: 6, dy: 6, dr: -20, delay: -3 },
  {
    kind: "diamond",
    fill: "fill-sky",
    x: 4,
    y: 85,
    size: 22,
    rotate: 20,
    d: 14,
    dx: 8,
    dy: -6,
    dr: 14,
    delay: -7,
  },
];

const reduce = usePrefersReducedMotion();
const drifts = computed(() => (props.variant === "prompt" ? PROMPT : FLOOR));
const shape = computed(() => (props.variant === "prompt" ? SHAPES.amoeba : SHAPES.kidney));
const breathe = computed(() => breatheValues(shape.value, 3.5));
</script>

<template>
  <div class="dr-zone" :class="`dr-zone--${variant}`">
    <svg
      v-for="(drift, i) in drifts"
      :key="i"
      class="dr-zone__drift"
      viewBox="-50 -50 100 100"
      aria-hidden="true"
      :style="{
        left: `${drift.x}%`,
        top: `${drift.y}%`,
        width: `${drift.size}px`,
        height: `${drift.size}px`,
        '--turn': `${drift.rotate ?? 0}deg`,
        '--d': `${drift.d}s`,
        '--dx': `${drift.dx}px`,
        '--dy': `${drift.dy}px`,
        '--dr': `${drift.dr}deg`,
        '--delay': `${drift.delay ?? 0}s`,
      }"
    >
      <AtomShape :kind="drift.kind" :fill="drift.fill" />
    </svg>
    <svg
      class="dr-zone__shape"
      viewBox="-50 -50 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path :d="shape">
        <animate
          v-if="!reduce"
          attributeName="d"
          :dur="variant === 'prompt' ? '11s' : '12s'"
          repeatCount="indefinite"
          calcMode="spline"
          keyTimes="0;.33;.66;1"
          keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"
          :values="breathe"
        />
      </path>
    </svg>
    <div class="dr-zone__content">
      <slot />
    </div>
  </div>
</template>
