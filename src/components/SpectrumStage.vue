<script setup lang="ts">
import { Field, FieldLabel } from "@ui-sdk/vue/field";
import {
  Slider,
  SliderControl,
  SliderThumb,
  SliderTrack,
  type SliderValueChangeDetails,
} from "@ui-sdk/vue/slider";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSpectrumDraft } from "../lib/spectrumDraft";
import { describePosition, nextNotch, stackLabels } from "../lib/spectrumTrack";
import type { Intent, StageView } from "../room/room";
import { MOODS } from "../room/mood";
import { notchesCrossed, SPECTRUM_MAX, SPECTRUM_MIN, SPECTRUM_NOTCHES } from "../room/spectrum";
import MoodPanel from "./MoodPanel.vue";
import Notice from "./Notice.vue";
import SpectrumSummary from "./SpectrumSummary.vue";

const props = defineProps<{
  stage: Extract<StageView, { format: "spectrum" }>;
  isHost: boolean;
  personId: string;
  isSpectator?: boolean;
}>();
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

const draft = useSpectrumDraft(() => props.stage);

let lastSent = 0;
let pending: ReturnType<typeof setTimeout> | undefined;

/** Page Up, Page Down and Shift with an arrow jump to the next notch, instead of UI SDK's fixed large step. */
function onSlide(value: number | number[], details: SliderValueChangeDetails) {
  const next = value as number;
  const event = details.reason === "step-key" ? details.event : undefined;
  const largeStep = event && (event.key === "PageUp" || event.key === "PageDown" || event.shiftKey);
  draft.value = largeStep ? nextNotch(draft.value, next > draft.value ? 1 : -1) : next;
  clearTimeout(pending);
  const wait = lastSent + MOVE_INTERVAL_MS - Date.now();
  if (wait <= 0) sendMove();
  else pending = setTimeout(sendMove, wait);
}

function sendMove() {
  lastSent = Date.now();
  emit("send", { type: "move-position", position: draft.value });
}

/** The slider was let go: the Room records where it settled (after the reveal). */
function onSettle() {
  clearTimeout(pending);
  lastSent = Date.now();
  emit("send", { type: "move-position", position: draft.value, settled: true });
}

// After the reveal, a marker or notch label briefly lights up when a position
// crosses a notch, so everyone can see people moving. See `.crossed` in style.css.
const CROSSED_MS = 600;
const crossedPeople = ref<string[]>([]);
const crossedNotch = ref<number | null>(null);
const flashTimers: ReturnType<typeof setTimeout>[] = [];

function flash(apply: () => void, clear: () => void) {
  apply();
  flashTimers.push(setTimeout(clear, CROSSED_MS));
}

watch(
  () =>
    spectrum.value.step === "revealed"
      ? spectrum.value.people.map((p) => [p.personId, p.position] as const)
      : [],
  (positions, before) => {
    const was = new Map(before);
    for (const [personId, position] of positions) {
      const from = was.get(personId);
      if (from == null || position === null || notchesCrossed(from, position).length === 0) {
        continue;
      }
      flash(
        () => (crossedPeople.value = [...crossedPeople.value, personId]),
        () => (crossedPeople.value = crossedPeople.value.filter((id) => id !== personId)),
      );
    }
  },
);

watch(draft, (to, from) => {
  if (spectrum.value.step !== "revealed") return;
  const notch = notchesCrossed(from, to).at(-1);
  if (notch === undefined) return;
  flash(
    () => (crossedNotch.value = notch),
    () => {
      if (crossedNotch.value === notch) crossedNotch.value = null;
    },
  );
});

function lock() {
  clearTimeout(pending);
  emit("send", { type: "lock-in", position: draft.value });
}

onBeforeUnmount(() => {
  clearTimeout(pending);
  flashTimers.forEach(clearTimeout);
});

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

/** Everyone this viewer may see on the track. Your own label follows your slider, not the Room's echo. */
const markers = computed(() => {
  if (!spectrum.value.positionsVisible || spectrum.value.step === "summary") return [];
  return spectrum.value.people.flatMap((person) => {
    if (person.position === null) return [];
    const own = person.personId === props.personId && canMove.value;
    return [
      {
        ...person,
        position: own ? draft.value : person.position,
        hovering: spectrum.value.step === "positioning" && !person.lockedIn,
      },
    ];
  });
});

// Label widths, measured in percent of the track, so they can be stacked into rows.
const labelsEl = ref<HTMLElement | null>(null);
const labelWidths = ref<Record<string, number>>({});

function measureLabels() {
  const el = labelsEl.value;
  if (!el?.clientWidth) return;
  const widths: Record<string, number> = {};
  for (const label of el.querySelectorAll<HTMLElement>("[data-person]")) {
    widths[label.dataset.person!] = Math.round((label.offsetWidth / el.clientWidth) * 1000) / 10;
  }
  const before = labelWidths.value;
  const changed =
    Object.keys(widths).length !== Object.keys(before).length ||
    Object.entries(widths).some(([id, width]) => before[id] !== width);
  if (changed) labelWidths.value = widths;
}

let resize: ResizeObserver | undefined;
onMounted(() => {
  // Measured a frame later: re-stacking changes the rows' height inside the observer's
  // own callback otherwise, which browsers report as a ResizeObserver loop error.
  resize = new ResizeObserver(() => requestAnimationFrame(measureLabels));
  watch(
    labelsEl,
    (el, old) => {
      if (old) resize?.unobserve(old);
      if (el) resize?.observe(el);
    },
    { immediate: true },
  );
});
// A label's width changes only with its text and styling, not as it moves.
watch(
  () =>
    markers.value
      .map((m) => [m.personId, m.nickname, moodOf(m.personId), m.hovering].join())
      .join("|"),
  measureLabels,
  { flush: "post" },
);
onBeforeUnmount(() => resize?.disconnect());

const rows = computed(() =>
  stackLabels(
    markers.value.map((m) => ({
      id: m.personId,
      position: m.position,
      width: labelWidths.value[m.personId] ?? 0,
    })),
  ),
);
const rowCount = computed(() => Math.max(0, ...Object.values(rows.value).map((r) => r + 1)));
</script>

<template>
  <section class="card stage">
    <p class="eyebrow">Spectrum · Prompt {{ stage.promptNumber }} of {{ stage.promptCount }}</p>
    <h1>{{ stage.prompt.text }}</h1>
    <Notice
      v-if="spectrum.step === 'positioning' && spectrum.positionsVisible"
      tone="host"
      glyph="👁"
    >
      <b>Only you can see this.</b> You aren't Playing, so positions show before the reveal.
    </Notice>

    <component :is="yours ? Field : 'div'" v-if="spectrum.step !== 'summary'" class="spectrum">
      <FieldLabel v-if="yours" class="spectrum-label">Your position</FieldLabel>
      <!-- Where everyone stands, once this viewer may see it: names stacked in rows, each with a stem down to its spot -->
      <div
        v-if="markers.length"
        ref="labelsEl"
        class="track-labels"
        :style="{ '--rows': rowCount }"
      >
        <span
          v-for="person in markers"
          :key="person.personId"
          :data-person="person.personId"
          class="marker"
          :class="{
            hover: person.hovering,
            you: person.personId === personId,
            apart: furthestIds.includes(person.personId),
            crossed: crossedPeople.includes(person.personId),
          }"
          :style="{ '--at': percent(person.position), '--row': rows[person.personId] ?? 0 }"
          :title="person.hovering ? `${person.nickname} (hovering)` : person.nickname"
        >
          <span class="marker-name">{{ moodOf(person.personId) }} {{ person.nickname }}</span>
        </span>
      </div>

      <!-- Your own position: the track with your thumb on it -->
      <Slider
        v-if="yours"
        :value="draft"
        :min="SPECTRUM_MIN"
        :max="SPECTRUM_MAX"
        :step="1"
        :large-step="25"
        :format="describePosition"
        :disabled="!canMove"
        @value-change="onSlide"
        @value-commit="onSettle"
      >
        <SliderControl>
          <SliderTrack>
            <span
              v-for="notch in SPECTRUM_NOTCHES"
              :key="notch.value"
              class="notch-tick"
              :style="{ left: percent(notch.value) }"
            />
            <SliderThumb />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <div v-else class="track-line" aria-hidden="true">
        <span
          v-for="notch in SPECTRUM_NOTCHES"
          :key="notch.value"
          class="notch-tick"
          :style="{ left: percent(notch.value) }"
        />
      </div>

      <div class="notch-labels" aria-hidden="true">
        <span
          v-for="notch in SPECTRUM_NOTCHES"
          :key="notch.value"
          :class="{ crossed: crossedNotch === notch.value }"
        >
          {{ notch.label }}
        </span>
      </div>
    </component>

    <div v-if="yours && spectrum.step !== 'summary'" class="stack">
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
    <p v-else-if="isSpectator" class="muted">
      You're a Spectator: you see what the people Playing see.
    </p>
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
