<script setup lang="ts">
// One small shape from the Atomic vocabulary, drawn in its 100×100 box: a filled
// path, a ball starburst, a leaf with its spine, or a pair of dots.
import { computed } from "vue";
import { SHAPES, starburst, type ShapeName } from "../design/shapes";

const props = defineProps<{ kind: ShapeName | "burst" | "leaf-spine" | "dots"; fill?: string }>();

const spokes = computed(() => (props.kind === "burst" ? starburst(8) : []));
</script>

<template>
  <g v-if="kind === 'burst'" class="atom-shape__ink">
    <template v-for="(spoke, i) in spokes" :key="i">
      <line x1="0" y1="0" :x2="spoke.x" :y2="spoke.y" vector-effect="non-scaling-stroke" />
      <circle :cx="spoke.x" :cy="spoke.y" :r="spoke.r" />
    </template>
    <circle r="5.5" />
  </g>
  <g v-else-if="kind === 'leaf-spine'">
    <path :class="fill" :d="SHAPES.leaf" />
    <line
      class="atom-shape__spine"
      x1="0"
      y1="-38"
      x2="0"
      y2="44"
      vector-effect="non-scaling-stroke"
    />
  </g>
  <g v-else-if="kind === 'dots'" class="atom-shape__ink">
    <circle cx="-16" cy="-16" r="16" />
    <circle cx="28" cy="16" r="10" />
  </g>
  <path v-else :class="fill" :d="SHAPES[kind]" />
</template>
