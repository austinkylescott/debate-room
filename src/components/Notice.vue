<script setup lang="ts">
// An inline notice that explains state (Toast.md): a dashed box on the ground it sits on.
//   plain    ink outline, with an optional glyph ("✦ 7 of 11 locked in")
//   host     what only you see because you aren't Playing ("Only you can see this")
//   warning  a heads-up, led by a diamond
//   error    something went wrong: spicy outline and an outlined triangle, never orange
import StatusIcon from "./StatusIcon.vue";

defineProps<{ tone?: "plain" | "host" | "warning" | "error"; glyph?: string }>();
</script>

<template>
  <p class="dr-notice" :class="tone && tone !== 'plain' ? `dr-notice--${tone}` : null">
    <StatusIcon v-if="tone === 'warning'" type="warning" />
    <span v-else-if="glyph" class="dr-notice__glyph" aria-hidden="true">{{ glyph }}</span>
    <span><slot /></span>
  </p>
</template>
