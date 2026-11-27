<script setup lang="ts">
// The shape a toast or notice leads with (Toast.md): a teardrop for info, a
// sparkle for success, a diamond for a heads-up, an outlined triangle for errors.
import { SHAPES } from "../design/shapes";

defineProps<{ type: "info" | "success" | "warning" | "error" }>();
</script>

<template>
  <svg class="status-icon" :data-type="type" viewBox="0 0 26 26" aria-hidden="true">
    <path
      v-if="type === 'info'"
      class="status-icon__fill"
      transform="translate(13 14) scale(.24)"
      :d="SHAPES.teardrop"
    />
    <path
      v-else-if="type === 'success'"
      class="status-icon__fill"
      transform="translate(13 13) scale(.24)"
      :d="SHAPES.sparkle"
    />
    <path
      v-else-if="type === 'warning'"
      class="status-icon__fill"
      transform="translate(13 13) scale(.23)"
      :d="SHAPES.diamond"
    />
    <template v-else>
      <path class="status-icon__outline" d="M13,3 L24,22 L2,22Z" />
      <rect class="status-icon__mark" x="12" y="10" width="2" height="6" />
      <rect class="status-icon__mark" x="12" y="18" width="2" height="2" />
    </template>
  </svg>
</template>
