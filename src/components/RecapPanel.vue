<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { FORMAT_NAMES } from "../room/lineup";
import { summarizeRecap } from "../room/recap";
import type { RecapEvent } from "../room/room";
import { SPECTRUM_NOTCHES } from "../room/spectrum";
import SpectrumSummary from "./SpectrumSummary.vue";

const props = defineProps<{ roomId: string; events: RecapEvent[] }>();

// Floor turns still running count up to now, so keep now moving while the Room is Live.
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(clock));

const recap = computed(() => summarizeRecap(props.events, now.value));
const floorMax = computed(() => Math.max(1, ...recap.value.floorTime.map((p) => p.ms)));

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function notchLabel(position: number | null): string {
  if (position === null) return "no position";
  const nearest = SPECTRUM_NOTCHES.reduce((best, notch) =>
    Math.abs(notch.value - position) < Math.abs(best.value - position) ? notch : best,
  );
  return nearest.label;
}

function download() {
  const file = {
    roomId: props.roomId,
    downloadedAt: new Date().toISOString(),
    summary: recap.value,
    events: props.events,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `debate-room-${props.roomId}-recap.json`;
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <section class="card recap">
    <div class="recap-head">
      <h2>Recap</h2>
      <button type="button" @click="download">Download JSON</button>
    </div>

    <h3>Floor time</h3>
    <p v-if="recap.floorTime.length === 0" class="muted small">Nobody has had the Floor yet.</p>
    <ul v-else class="floor-time">
      <li v-for="person in recap.floorTime" :key="person.personId">
        <span class="name">{{ person.nickname }}</span>
        <span class="bar" :style="{ width: `${(person.ms / floorMax) * 60}%` }" />
        <span class="small">{{ duration(person.ms) }}</span>
      </li>
    </ul>

    <p v-if="recap.rounds.length === 0" class="muted small">No Rounds have been played yet.</p>
    <article v-for="(round, r) in recap.rounds" :key="round.roundId" class="recap-round">
      <h3>Round {{ r + 1 }} · {{ FORMAT_NAMES[round.format] }}</h3>
      <div v-for="prompt in round.prompts" :key="prompt.promptId" class="recap-prompt">
        <p class="eyebrow">Prompt {{ prompt.promptNumber }}</p>
        <p class="prompt-text">{{ prompt.text }}</p>
        <p v-if="!prompt.revealed" class="muted small">
          {{ prompt.endedAt === null ? "Positions not revealed yet." : "Ended before the reveal." }}
        </p>
        <template v-else>
          <p class="small">
            Revealed
            {{ prompt.revealed.by === "host" ? "by the Host" : "once everyone locked in" }}:
            <template v-for="(p, i) in prompt.revealed.positions" :key="p.personId">
              {{ i > 0 ? ", " : "" }}{{ p.nickname }} ({{ notchLabel(p.position) }})
            </template>
          </p>
          <ul v-if="prompt.moves.length > 0" class="moves small">
            <li v-for="(m, i) in prompt.moves" :key="i">
              {{ m.nickname }} moved {{ notchLabel(m.from) }} → {{ notchLabel(m.to) }}
            </li>
          </ul>
        </template>
        <SpectrumSummary
          v-if="prompt.summary"
          :before="prompt.summary.before"
          :after="prompt.summary.after"
        />
      </div>
    </article>
  </section>
</template>
