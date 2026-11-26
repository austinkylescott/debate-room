<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { type Mood, MOODS } from "../room/mood";
import type { Intent, StageView } from "../room/room";

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

// A clock for the Check-in countdown, running only while it's open.
const now = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => checkIn.value?.status === "open",
  (open) => {
    clearInterval(timer);
    if (open) {
      now.value = Date.now();
      timer = setInterval(() => (now.value = Date.now()), 250);
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));

const secondsLeft = computed(() => {
  const open = checkIn.value;
  if (open?.status !== "open") return 0;
  return Math.max(0, Math.ceil((open.closesAt - now.value) / 1000));
});

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
  <template v-if="checkIn?.status === 'open'">
    <h2>
      Mood Check-in
      <span class="count">{{ secondsLeft }}s</span>
    </h2>
    <p class="muted">
      <template v-if="stage.playing && !youAnswered">
        How did that Prompt leave you? Confirm your Mood or pick another.
      </template>
      <template v-else-if="stage.playing">Thanks! Waiting for everyone else…</template>
      <template v-else>Everyone Playing is picking a Mood for that Prompt.</template>
      {{ checkIn.answered.length }} answered.
    </p>
    <button
      v-if="stage.playing && !youAnswered && yoursMood"
      class="primary"
      type="button"
      @click="pick(yoursMood.id)"
    >
      Keep {{ yoursMood.emoji }} {{ yoursMood.label }}
    </button>
  </template>

  <!-- Your Mood -->
  <div v-if="canPick" class="moods" role="group" aria-label="Your Mood">
    <button
      v-for="mood in MOODS"
      :key="mood.id"
      type="button"
      class="mood"
      :class="{ picked: yours === mood.id }"
      :aria-pressed="yours === mood.id"
      :title="mood.label"
      @click="pick(mood.id)"
    >
      <span aria-hidden="true">{{ mood.emoji }}</span>
      <span class="sr-only">{{ mood.label }}</span>
    </button>
  </div>

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
