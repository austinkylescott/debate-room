<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Intent, StageView } from "../room/room";
import { MOODS } from "../room/mood";
import { SPECTRUM_MAX, SPECTRUM_MIN, SPECTRUM_NOTCHES } from "../room/spectrum";
import MoodPanel from "./MoodPanel.vue";
import SpectrumSummary from "./SpectrumSummary.vue";

const props = defineProps<{ stage: StageView; isHost: boolean; personId: string }>();
const emit = defineEmits<{ send: [intent: Intent] }>();

/** How often slider moves go to the Room while dragging. */
const MOVE_INTERVAL_MS = 120;

const spectrum = computed(() => props.stage.spectrum);
const yours = computed(() => spectrum.value.yours);
const lockedIn = computed(() => yours.value?.lockedPosition != null);
const canMove = computed(
  () =>
    yours.value !== null &&
    (spectrum.value.step === "revealed" ||
      (spectrum.value.step === "positioning" && !lockedIn.value)),
);
const lockedCount = computed(() => spectrum.value.people.filter((p) => p.lockedIn).length);

const midpoint = (SPECTRUM_MIN + SPECTRUM_MAX) / 2;
const draft = ref(yours.value?.position ?? midpoint);

// A new Prompt (or a reconnect) starts the slider from where the Room has it.
watch(
  () => [props.stage.prompt.id, spectrum.value.step] as const,
  () => {
    draft.value = yours.value?.position ?? midpoint;
  },
);

let lastSent = 0;
let pending: ReturnType<typeof setTimeout> | undefined;

function onSlide() {
  clearTimeout(pending);
  const wait = lastSent + MOVE_INTERVAL_MS - Date.now();
  if (wait <= 0) sendMove();
  else pending = setTimeout(sendMove, wait);
}

function sendMove() {
  lastSent = Date.now();
  emit("send", { type: "move-position", position: draft.value });
}

function lock() {
  clearTimeout(pending);
  emit("send", { type: "lock-in", position: draft.value });
}

onBeforeUnmount(() => clearTimeout(pending));

/** The emoji for someone's current Mood, shown next to their name. Empty if they have none. */
function moodOf(personId: string): string {
  const mood = props.stage.moods[personId];
  return MOODS.find((m) => m.id === mood)?.emoji ?? "";
}

const checkInOpen = computed(() => props.stage.checkIn?.status === "open");

const advanceLabel = computed(() => {
  if (spectrum.value.step === "revealed") return "End this Prompt";
  return props.stage.promptNumber < props.stage.promptCount
    ? "Next Prompt"
    : "Back to the Waiting Room";
});

/** Ids of the two people furthest apart, highlighted for the Host. */
const furthestIds = computed(() => {
  const apart = spectrum.value.callingAids?.furthestApart;
  return apart ? [apart.low, apart.high] : [];
});

/** Who the Host might call on, and why: changed their mind, or furthest apart. */
const callOn = computed(() => {
  const aids = spectrum.value.callingAids;
  if (!aids) return null;
  return spectrum.value.people
    .map((person) => ({
      ...person,
      changedMind: aids.changedMind.includes(person.personId),
      furthestApart: furthestIds.value.includes(person.personId),
    }))
    .filter((person) => person.changedMind || person.furthestApart);
});

function percent(position: number) {
  return `${((position - SPECTRUM_MIN) / (SPECTRUM_MAX - SPECTRUM_MIN)) * 100}%`;
}
</script>

<template>
  <section class="card stage">
    <p class="eyebrow">Spectrum · Prompt {{ stage.promptNumber }} of {{ stage.promptCount }}</p>
    <h1>{{ stage.prompt.text }}</h1>

    <!-- Where everyone stands, once this viewer may see it -->
    <div v-if="spectrum.positionsVisible && spectrum.step !== 'summary'" class="track">
      <div class="track-line" />
      <template v-for="person in spectrum.people" :key="person.personId">
        <span
          v-if="spectrum.step === 'positioning' && person.position !== null && !person.lockedIn"
          class="marker hover"
          :style="{ left: percent(person.position) }"
          :title="`${person.nickname} (hovering)`"
        >
          {{ moodOf(person.personId) }} {{ person.nickname }}
        </span>
        <span
          v-else-if="person.position !== null"
          class="marker"
          :class="{ apart: furthestIds.includes(person.personId) }"
          :style="{ left: percent(person.position) }"
        >
          {{ moodOf(person.personId) }} {{ person.nickname }}
        </span>
      </template>
    </div>
    <div v-if="spectrum.step !== 'summary'" class="notch-labels" aria-hidden="true">
      <span v-for="notch in SPECTRUM_NOTCHES" :key="notch.value">{{ notch.label }}</span>
    </div>

    <!-- Your own slider -->
    <div v-if="yours && spectrum.step !== 'summary'" class="stack">
      <label class="field">
        <span>Your position</span>
        <input
          v-model.number="draft"
          type="range"
          list="spectrum-notches"
          :min="SPECTRUM_MIN"
          :max="SPECTRUM_MAX"
          step="1"
          :disabled="!canMove"
          @input="onSlide"
        />
      </label>
      <datalist id="spectrum-notches">
        <option
          v-for="notch in SPECTRUM_NOTCHES"
          :key="notch.value"
          :value="notch.value"
          :label="notch.label"
        />
      </datalist>
      <button
        v-if="spectrum.step === 'positioning' && !lockedIn"
        class="primary"
        type="button"
        @click="lock"
      >
        Lock in
      </button>
      <p v-else-if="spectrum.step === 'positioning'" class="muted">
        Locked in. Waiting for everyone else…
      </p>
      <p v-else class="muted">Positions are out. Move if you've changed your mind.</p>
    </div>
    <p v-else-if="!stage.playing && !isHost" class="muted">
      You joined mid-Prompt: you'll be in from the next one.
    </p>

    <MoodPanel :stage="stage" :person-id="personId" @send="emit('send', $event)" />

    <!-- Who has locked in, before the reveal -->
    <template v-if="spectrum.step === 'positioning'">
      <h2>
        Locked in
        <span class="count">{{ lockedCount }} of {{ spectrum.people.length }}</span>
      </h2>
      <ul class="people">
        <li v-for="person in spectrum.people" :key="person.personId">
          <span class="name">{{ moodOf(person.personId) }} {{ person.nickname }}</span>
          <span v-if="person.lockedIn" class="tag">Locked in</span>
          <span v-else class="tag subtle">Deciding</span>
        </li>
      </ul>
    </template>

    <!-- Who the Host might call on, once positions are out -->
    <template v-if="callOn">
      <h2>Who to call on</h2>
      <ul v-if="callOn.length" class="people">
        <li v-for="person in callOn" :key="person.personId">
          <span class="name">{{ person.nickname }}</span>
          <span v-if="person.changedMind" class="tag">Changed their mind</span>
          <span v-if="person.furthestApart" class="tag subtle">Furthest apart</span>
        </li>
      </ul>
      <p v-else class="muted">No one has changed their mind, and no one stands apart yet.</p>
    </template>

    <!-- Summary card -->
    <template v-if="spectrum.summary">
      <h2>How it moved</h2>
      <SpectrumSummary :before="spectrum.summary.before" :after="spectrum.summary.after" />
    </template>

    <!-- Host controls -->
    <div v-if="isHost" class="host-controls">
      <button
        v-if="spectrum.step === 'positioning'"
        type="button"
        @click="emit('send', { type: 'reveal-positions' })"
      >
        Reveal now
      </button>
      <button
        v-else-if="!checkInOpen"
        class="primary"
        type="button"
        @click="emit('send', { type: 'advance' })"
      >
        {{ advanceLabel }}
      </button>
    </div>
  </section>
</template>
