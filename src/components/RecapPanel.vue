<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { FORMAT_NAMES } from "../room/lineup";
import { summarizeRecap } from "../room/recap";
import type { RecapEvent } from "../room/room";
import type { RevealCause } from "../room/round";
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

const REVEALED_BY: Record<RevealCause, string> = {
  host: "by the Host or a Co-Host",
  "everyone-locked-in": "once everyone locked in",
  "everyone-chose": "once everyone chose",
};

function inTheMiddle(
  choices: { nickname: string; side: string | null; steppedIn: boolean | null }[],
) {
  return choices
    .filter((c) => c.steppedIn)
    .map((c) => (c.side ? `${c.nickname} (${c.side})` : c.nickname))
    .join(", ");
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
      <ul v-if="round.sides.length > 0" class="moves small">
        <li v-for="(pick, i) in round.sides" :key="i">
          {{ pick.nickname }}
          {{
            pick.from === null ? `picked ${pick.side}` : `moved from ${pick.from} to ${pick.side}`
          }}
        </li>
      </ul>
      <div v-for="prompt in round.prompts" :key="prompt.promptId" class="recap-prompt">
        <p class="eyebrow">Prompt {{ prompt.promptNumber }}</p>
        <p class="prompt-text">{{ prompt.text }}</p>
        <template v-if="prompt.spectrum">
          <p v-if="!prompt.spectrum.revealed" class="muted small">
            {{ prompt.endedAt === null ? "Not revealed yet." : "Ended before the reveal." }}
          </p>
          <template v-else>
            <p class="small">
              Revealed {{ REVEALED_BY[prompt.spectrum.revealed.by] }}:
              <template v-for="(p, i) in prompt.spectrum.revealed.positions" :key="p.personId">
                {{ i > 0 ? ", " : "" }}{{ p.nickname }} ({{ notchLabel(p.position) }})
              </template>
            </p>
            <ul v-if="prompt.spectrum.moves.length > 0" class="moves small">
              <li v-for="(m, i) in prompt.spectrum.moves" :key="i">
                {{ m.nickname }}
                {{ m.reason === "notch" ? "reached" : "settled near" }}
                {{ notchLabel(m.to) }}
              </li>
            </ul>
          </template>
          <SpectrumSummary
            v-if="prompt.spectrum.summary"
            :before="prompt.spectrum.summary.before"
            :after="prompt.spectrum.summary.after"
          />
        </template>
        <template v-if="prompt.middleGround">
          <p v-if="!prompt.middleGround.revealed" class="muted small">
            {{ prompt.endedAt === null ? "Not revealed yet." : "Ended before the reveal." }}
          </p>
          <template v-else>
            <p class="small">
              Revealed {{ REVEALED_BY[prompt.middleGround.revealed.by] }}. In the middle:
              {{ inTheMiddle(prompt.middleGround.revealed.choices) || "nobody" }}.
            </p>
            <ul v-if="prompt.middleGround.steps.length > 0" class="moves small">
              <li v-for="(step, i) in prompt.middleGround.steps" :key="i">
                {{ step.nickname }} ({{ step.side }})
                {{ step.steppedIn ? "stepped in" : "stepped back" }}
              </li>
            </ul>
          </template>
          <ul v-if="prompt.middleGround.summary" class="moves small">
            <li v-for="side in prompt.middleGround.summary.sides" :key="side.name">
              {{ side.name }}: {{ side.steppedIn }} of {{ side.onSide }} stepped in
            </li>
          </ul>
        </template>
      </div>
    </article>
  </section>
</template>
