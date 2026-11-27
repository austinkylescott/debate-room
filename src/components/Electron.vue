<script setup lang="ts">
// The person marker (docs/design/components/Electron.md): an ink-outlined disc
// with initials and the name on one line beside or below it. Styled by
// styles/components/electron.css. A plain <span>, or a <button> when the
// screen gives it an action (`actionable`), whose accessible name says it all.
import { computed } from "vue";
import { initials, type Pole } from "../lib/electron";
import { MOODS, type Mood } from "../room/mood";

const props = defineProps<{
  name: string;
  /** Where they stand, as a fill. Omit for neutral (Unsure), and always while positions are hidden. */
  pole?: Pole | null;
  mood?: Mood | null;
  /** Their place in the raised-hand queue, from 1. */
  hand?: number | null;
  /** Has the Floor. */
  speaking?: boolean;
  /** The YOU badge, for where nothing else says it's you. */
  you?: boolean;
  locked?: boolean;
  /** Before the reveal, for someone whose position this viewer may not see: "?" for initials. */
  hidden?: boolean;
  /** A Host or Co-Host who isn't Playing, previewing a position before the reveal. */
  peek?: boolean;
  away?: boolean;
  spectator?: boolean;
  /** The Host or a Co-Host. */
  role?: boolean;
  size?: "sm" | "lg";
  /** "row" puts the name beside the disc, for lists. */
  layout?: "row";
  actionable?: boolean;
}>();
defineEmits<{ click: [event: MouseEvent] }>();

const mood = computed(() => MOODS.find((m) => m.id === props.mood) ?? null);

/** What the disc's badges say, for screen readers: the disc itself is hidden from them. */
const extras = computed(() => {
  const parts: string[] = [];
  if (props.speaking) parts.push("has the Floor");
  if (props.hand) parts.push(`hand up, number ${props.hand}`);
  if (mood.value) parts.push(`feeling ${mood.value.label}`);
  return parts;
});
const label = computed(() => [props.name, ...extras.value].join(", "));
</script>

<template>
  <component
    :is="actionable ? 'button' : 'span'"
    :type="actionable ? 'button' : undefined"
    class="dr-electron"
    :class="[
      size && `dr-electron--${size}`,
      layout && `dr-electron--${layout}`,
      {
        'is-you': you,
        'is-speaking': speaking,
        'is-hidden': hidden,
        'is-locked': locked,
        'is-peek': peek,
        'is-away': away,
        'is-spectator': spectator,
      },
    ]"
    :data-pole="pole ?? undefined"
    :title="name"
    :aria-label="actionable ? label : undefined"
    @click="$emit('click', $event)"
  >
    <span class="dr-electron__dot" aria-hidden="true">
      {{ hidden ? "?" : initials(name) }}
      <span v-if="mood" class="dr-electron__mood">{{ mood.emoji }}</span>
      <span v-if="hand" class="dr-electron__hand"><span>{{ hand }}</span></span>
      <span v-if="role" class="dr-electron__role" />
    </span>
    <span class="dr-electron__name">{{ name }}</span>
    <span v-if="!actionable && extras.length" class="sr-only">, {{ extras.join(", ") }}</span>
  </component>
</template>
