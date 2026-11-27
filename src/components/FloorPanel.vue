<script setup lang="ts">
import { computed } from "vue";
import type { FloorView, Intent, WaitingRoomPerson } from "../room/room";
import Timer from "./Timer.vue";

const props = defineProps<{
  floor: FloorView;
  people: WaitingRoomPerson[];
  youId: string;
  isHost: boolean;
  isSpectator?: boolean;
}>();
const emit = defineEmits<{ send: [intent: Intent] }>();

/** Speaking timer choices, in seconds. Null is off. */
const TIMER_CHOICES: { seconds: number | null; label: string }[] = [
  { seconds: null, label: "Off" },
  { seconds: 30, label: "30 seconds" },
  { seconds: 60, label: "1 minute" },
  { seconds: 120, label: "2 minutes" },
  { seconds: 180, label: "3 minutes" },
  { seconds: 300, label: "5 minutes" },
];

const holderIds = computed(() => props.floor.holders.map((h) => h.personId));
const youHaveFloor = computed(() => holderIds.value.includes(props.youId));
const yourHand = computed(() => {
  const index = props.floor.raisedHands.findIndex((h) => h.personId === props.youId);
  return index === -1 ? null : index + 1;
});

/** Everyone the Host might give the Floor to: raised hands first, in order, then the rest. */
const candidates = computed(() => {
  const handOrder = new Map(props.floor.raisedHands.map((h, i) => [h.personId, i + 1]));
  return props.people
    .filter((p) => !holderIds.value.includes(p.id))
    .map((p) => ({ ...p, hand: handOrder.get(p.id) ?? null }))
    .sort((a, b) => (a.hand ?? Infinity) - (b.hand ?? Infinity));
});

function setTimer(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("send", { type: "set-floor-timer", seconds: value === "" ? null : Number(value) });
}
</script>

<template>
  <section class="card floor">
    <h2>The Floor</h2>

    <ul v-if="floor.holders.length" class="people">
      <li
        v-for="holder in floor.holders"
        :key="holder.personId"
        :class="{ you: holder.personId === youId }"
      >
        <span class="name">{{ holder.nickname }}</span>
        <Timer
          v-if="holder.endsAt !== null"
          :ends-at="holder.endsAt"
          :total-seconds="holder.durationSeconds ?? 0"
          :time-up="holder.timeUp"
          :label="
            holder.personId === youId ? 'Your speaking time' : `${holder.nickname}'s speaking time`
          "
        />
        <button
          v-if="isHost"
          type="button"
          class="link"
          @click="emit('send', { type: 'take-floor', personId: holder.personId })"
        >
          Take back
        </button>
      </li>
    </ul>
    <p v-else class="muted">No one has the Floor.</p>

    <!-- Participants ask for the Floor; Spectators only watch -->
    <template v-if="!isHost">
      <p v-if="isSpectator" class="muted small">Spectators watch: they don't raise hands.</p>
      <p v-else-if="youHaveFloor" class="muted">You have the Floor.</p>
      <button
        v-else-if="yourHand === null"
        class="primary"
        type="button"
        @click="emit('send', { type: 'raise-hand' })"
      >
        Raise your hand
      </button>
      <div v-else class="inline-form">
        <p class="muted grow">Your hand is up (number {{ yourHand }}).</p>
        <button type="button" @click="emit('send', { type: 'lower-hand' })">Lower your hand</button>
      </div>
      <p v-if="floor.raisedHands.length" class="muted small">
        Hands up: {{ floor.raisedHands.map((h) => h.nickname).join(", ") }}
      </p>
    </template>

    <!-- The Host gives the Floor -->
    <template v-else>
      <h3>Give the Floor</h3>
      <ul class="people">
        <li v-for="person in candidates" :key="person.id">
          <span class="name">{{ person.nickname }}</span>
          <span v-if="person.hand !== null" class="tag">Hand up · {{ person.hand }}</span>
          <button
            type="button"
            class="link"
            @click="emit('send', { type: 'give-floor', personId: person.id })"
          >
            Give the Floor
          </button>
        </li>
      </ul>
      <div class="inline-form">
        <label class="field">
          <span>Speaking timer</span>
          <select :value="floor.timerSeconds ?? ''" @change="setTimer">
            <option
              v-for="choice in TIMER_CHOICES"
              :key="choice.label"
              :value="choice.seconds ?? ''"
            >
              {{ choice.label }}
            </option>
          </select>
        </label>
        <button
          v-if="floor.holders.length > 1"
          type="button"
          @click="emit('send', { type: 'clear-floor' })"
        >
          Take it back from everyone
        </button>
      </div>
    </template>
  </section>
</template>
