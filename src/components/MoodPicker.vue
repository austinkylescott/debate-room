<script setup lang="ts">
import { Toggle, ToggleGroup } from "@ui-sdk/vue/toggle";
import { isMood, type Mood, MOODS } from "../room/mood";

const props = defineProps<{ mood: Mood | null }>();
const emit = defineEmits<{ pick: [mood: Mood] }>();

// The Room owns your Mood, so the group only reports presses. Pressing your current
// Mood sends it again: in the Check-in, that's how you confirm it.
function onPress(value: string[], details: { cancel(): void }) {
  details.cancel();
  const mood = value[0] ?? props.mood;
  if (isMood(mood)) emit("pick", mood);
}
</script>

<template>
  <ToggleGroup
    class="dr-moods"
    aria-label="Your Mood"
    :value="mood ? [mood] : []"
    @value-change="onPress"
  >
    <Toggle
      v-for="option in MOODS"
      :key="option.id"
      :value="option.id"
      class="dr-mood"
      :aria-label="option.label"
      :title="option.label"
    >
      {{ option.emoji }}
    </Toggle>
  </ToggleGroup>
</template>
