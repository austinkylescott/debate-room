<script setup lang="ts">
import { computed } from "vue";
import { useCountdown } from "../lib/serverClock";
import { MOODS } from "../room/mood";
import type { Intent, StageView } from "../room/room";
import type { ExchangeEnd, Yielder } from "../room/surrounded";
import MoodPanel from "./MoodPanel.vue";

const props = defineProps<{
  stage: Extract<StageView, { format: "surrounded" }>;
  isHost: boolean;
  personId: string;
  isSpectator?: boolean;
}>();
const emit = defineEmits<{ send: [intent: Intent] }>();

const surrounded = computed(() => props.stage.surrounded);
const chair = computed(() => surrounded.value.chair);
const playing = computed(() => props.stage.playing);
const isCenter = computed(() => surrounded.value.center?.personId === props.personId);
const inChair = computed(() => chair.value?.challenger.personId === props.personId);
const onCooldown = computed(() => surrounded.value.cooldown?.personId === props.personId);
const youVoted = computed(
  () => chair.value?.votes.some((v) => v.personId === props.personId) ?? false,
);
const canVote = computed(
  () => playing.value && chair.value !== null && !isCenter.value && !inChair.value,
);
const over = computed(() => surrounded.value.step === "summary");
const checkInOpen = computed(() => props.stage.checkIn?.status === "open");

// The exchange countdown runs on the server's clock, only while someone is in the chair.
const secondsLeft = useCountdown(() => chair.value !== null);

const timeLeft = computed(() => {
  if (!chair.value) return "";
  const seconds = secondsLeft(chair.value.endsAt);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
});

const ENDED_BY: Record<ExchangeEnd, string> = {
  timer: "Time ran out",
  vote: "Voted out",
  yield: "Yielded",
  host: "Ended by the Host",
  left: "Left the Room",
};

const YIELDED_BY: Record<Yielder, string> = { center: "the Center", challenger: "the Challenger" };

function endedLabel(endedBy: ExchangeEnd, yieldedBy?: Yielder): string {
  return endedBy === "yield" && yieldedBy
    ? `${ENDED_BY.yield} by ${YIELDED_BY[yieldedBy]}`
    : ENDED_BY[endedBy];
}

/** The emoji for someone's current Mood, shown next to their name. Empty if they have none. */
function moodOf(personId: string): string {
  const mood = props.stage.moods[personId];
  return MOODS.find((m) => m.id === mood)?.emoji ?? "";
}

function send(intent: Intent) {
  emit("send", intent);
}

const advanceLabel = computed(() => {
  if (!over.value) return "End this Prompt";
  return props.stage.promptNumber < props.stage.promptCount
    ? "Next Prompt"
    : "Back to the Waiting Room";
});
</script>

<template>
  <section class="card stage">
    <p class="eyebrow">Surrounded · Prompt {{ stage.promptNumber }} of {{ stage.promptCount }}</p>
    <h1>{{ stage.prompt.text }}</h1>

    <template v-if="!over">
      <!-- The Center and the chair -->
      <div class="pair surrounded">
        <div class="seat">
          <p class="eyebrow">Center</p>
          <p v-if="surrounded.center" class="seat-name">
            {{ moodOf(surrounded.center.personId) }} {{ surrounded.center.nickname }}
          </p>
          <p v-else class="muted">Waiting for a Center to step up</p>
        </div>
        <div class="seat">
          <p class="eyebrow">The chair</p>
          <template v-if="chair">
            <p class="seat-name">
              {{ moodOf(chair.challenger.personId) }} {{ chair.challenger.nickname }}
            </p>
            <p class="countdown" role="timer" aria-live="off">{{ timeLeft }}</p>
            <p class="small">
              Votes to remove: {{ chair.votes.length }} of {{ chair.votesNeeded }} needed
              <template v-if="chair.votes.length">
                ({{ chair.votes.map((v) => v.nickname).join(", ") }})
              </template>
            </p>
          </template>
          <p v-else class="muted">Empty</p>
        </div>
      </div>

      <!-- Your part -->
      <div v-if="playing" class="stack">
        <template v-if="!surrounded.center">
          <button class="primary" type="button" @click="send({ type: 'volunteer-center' })">
            Step up as the Center
          </button>
        </template>
        <template v-else-if="isCenter">
          <p class="muted">You're the Center: defend the Prompt.</p>
          <button v-if="chair" type="button" @click="send({ type: 'yield-chair' })">
            Yield this exchange
          </button>
        </template>
        <template v-else-if="inChair">
          <p class="muted">You have the chair. Make your case.</p>
          <button type="button" @click="send({ type: 'yield-chair' })">Yield the chair</button>
        </template>
        <template v-else>
          <button
            v-if="!chair && !onCooldown"
            class="primary"
            type="button"
            @click="send({ type: 'take-chair' })"
          >
            Take the chair
          </button>
          <p v-else-if="!chair" class="muted">
            You just had the chair. Someone else needs a turn first.
          </p>
          <button
            v-if="canVote"
            type="button"
            :class="{ danger: !youVoted }"
            @click="send({ type: 'vote-remove', remove: !youVoted })"
          >
            {{ youVoted ? "Take back your vote" : "Vote to remove the Challenger" }}
          </button>
        </template>
      </div>
      <p v-else-if="isSpectator" class="muted">
        You're a Spectator: you watch the chair and the votes.
      </p>
      <p v-else-if="!isHost" class="muted">
        You joined mid-Prompt: you'll be in from the next one.
      </p>

      <p v-if="surrounded.cooldown && !onCooldown" class="muted small">
        {{ surrounded.cooldown.nickname }} just had the chair and waits for someone else's turn.
      </p>

      <ul v-if="surrounded.exchanges.length" class="moves small">
        <li v-for="(exchange, i) in surrounded.exchanges" :key="i">
          {{ exchange.nickname }}: {{ endedLabel(exchange.endedBy, exchange.yieldedBy) }}
        </li>
      </ul>
    </template>

    <MoodPanel :stage="stage" :person-id="personId" @send="send" />

    <!-- Summary card -->
    <template v-if="surrounded.summary">
      <h2>
        {{ surrounded.summary.exchanges }}
        {{ surrounded.summary.exchanges === 1 ? "exchange" : "exchanges" }}
      </h2>
      <table v-if="surrounded.exchanges.length" class="summary">
        <tbody>
          <tr v-for="(exchange, i) in surrounded.exchanges" :key="i">
            <th scope="row">{{ exchange.nickname }}</th>
            <td>{{ endedLabel(exchange.endedBy, exchange.yieldedBy) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">Nobody took the chair.</p>
    </template>

    <!-- Host controls -->
    <div v-if="isHost" class="host-controls stack">
      <template v-if="!over">
        <label class="field">
          <span>{{ surrounded.center ? "Replace the Center" : "Pick the Center" }}</span>
          <select
            @change="
              send({
                type: 'choose-center',
                personId: ($event.target as HTMLSelectElement).value,
              })
            "
          >
            <option value="" disabled selected>Choose someone</option>
            <option
              v-for="person in surrounded.challengers"
              :key="person.personId"
              :value="person.personId"
            >
              {{ person.nickname }}
            </option>
          </select>
        </label>
        <label v-if="surrounded.center" class="field">
          <span>Put in the chair</span>
          <select
            @change="
              send({
                type: 'seat-challenger',
                personId: ($event.target as HTMLSelectElement).value,
              })
            "
          >
            <option value="" disabled selected>Choose a Challenger</option>
            <option
              v-for="person in surrounded.challengers"
              :key="person.personId"
              :value="person.personId"
              :disabled="person.personId === chair?.challenger.personId"
            >
              {{ person.nickname }}
            </option>
          </select>
        </label>
        <button v-if="chair" type="button" @click="send({ type: 'end-exchange' })">
          End this exchange
        </button>
      </template>
      <button
        v-if="!checkInOpen"
        :class="{ primary: over }"
        type="button"
        @click="send({ type: 'advance' })"
      >
        {{ advanceLabel }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.surrounded .seat {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.75rem;
  text-align: center;
}
.seat-name {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0.25rem 0;
}
.countdown {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  margin: 0.25rem 0;
}
</style>
