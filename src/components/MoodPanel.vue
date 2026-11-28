<script setup lang="ts">
import { computed } from "vue";
import { CHECK_IN_MS, type Mood, MOODS } from "../room/mood";
import type { Intent, StageView } from "../room/room";
import MoodPicker from "./MoodPicker.vue";
import Timer from "./Timer.vue";

const props = defineProps<{ stage: StageView; personId: string }>();
const emit = defineEmits<{ send: [intent: Intent] }>();

const checkIn = computed(() => props.stage.checkIn);
const yours = computed<Mood | null>(() => props.stage.moods[props.personId] ?? null);
const yoursMood = computed(() => MOODS.find((m) => m.id === yours.value));
const youAnswered = computed(
  () => checkIn.value?.status === "open" && checkIn.value.answered.includes(props.personId),
);
const promptOver = computed(() => {
  const { stage } = props;
  const step =
    stage.format === "spectrum"
      ? stage.spectrum.step
      : stage.format === "middle-ground"
        ? stage.middleGround.step
        : stage.surrounded.step;
  return step === "summary";
});
/** Playing people pick a Mood during the Prompt and while the Check-in is open. */
const canPick = computed(
  () => props.stage.playing && (!promptOver.value || checkIn.value?.status === "open"),
);

const tally = computed(() => (checkIn.value?.status === "closed" ? checkIn.value.tally : null));
const tallyMax = computed(() =>
  tally.value ? Math.max(1, tally.value.noMood, ...Object.values(tally.value.moods)) : 1,
);

function pick(mood: Mood) {
  emit("send", { type: "set-mood", mood });
}
</script>

<template>
  <!-- The Check-in, when the Prompt has ended -->
  <section
    v-if="checkIn?.status === 'open'"
    class="dr-card dr-card--raised mood-check-in"
    :class="{ 'is-your-move': stage.playing && !youAnswered }"
    aria-labelledby="mood-check-in-title"
  >
    <h2 id="mood-check-in-title" class="dr-card__title">Mood Check-in</h2>
    <Timer
      variant="bar"
      :ends-at="checkIn.closesAt"
      :total-seconds="CHECK_IN_MS / 1000"
      label="Mood Check-in"
    />
    <p class="muted">
      <template v-if="stage.playing && !youAnswered">
        How did that Prompt leave you? Confirm your Mood or pick another.
      </template>
      <template v-else-if="stage.playing">Thanks! Waiting for everyone else…</template>
      <template v-else>Everyone Playing is picking a Mood for that Prompt.</template>
      {{ checkIn.answered.length }} answered.
    </p>
    <MoodPicker v-if="canPick" :mood="yours" @pick="pick" />
    <button
      v-if="stage.playing && !youAnswered && yoursMood"
      type="button"
      @click="pick(yoursMood.id)"
    >
      Keep {{ yoursMood.emoji }} {{ yoursMood.label }}
    </button>
  </section>

  <!-- Your Mood, during the Prompt -->
  <MoodPicker v-else-if="canPick" :mood="yours" @pick="pick" />

  <!-- The Check-in tally, on the summary card -->
  <template v-if="tally">
    <h2>How it landed</h2>
    <table class="summary">
      <tbody>
        <tr v-for="mood in MOODS" :key="mood.id">
          <th scope="row">{{ mood.emoji }} {{ mood.label }}</th>
          <td>
            <span class="bar" :style="{ width: `${(tally.moods[mood.id] / tallyMax) * 75}%` }" />
            {{ tally.moods[mood.id] }}
          </td>
        </tr>
        <tr>
          <th scope="row">No Mood</th>
          <td>
            <span class="bar after" :style="{ width: `${(tally.noMood / tallyMax) * 75}%` }" />
            {{ tally.noMood }}
          </td>
        </tr>
      </tbody>
    </table>
  </template>
</template>
