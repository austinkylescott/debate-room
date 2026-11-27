<script setup lang="ts">
import { Select, SelectContent, SelectLabel, SelectTrigger, SelectValue } from "@ui-sdk/vue/select";
import { computed } from "vue";
import { useCountdown } from "../lib/serverClock";
import { TIMER_CHOICES, timerChoice, timerSeconds } from "../lib/speakingTimer";
import type { FloorView, Intent, WaitingRoomPerson } from "../room/room";

const props = defineProps<{
  floor: FloorView;
  people: WaitingRoomPerson[];
  youId: string;
  isHost: boolean;
  isSpectator?: boolean;
}>();
const emit = defineEmits<{ send: [intent: Intent] }>();

// The countdowns, on the server's clock, running only while a speaking timer is.
const secondsLeft = useCountdown(() =>
  props.floor.holders.some((h) => h.endsAt !== null && !h.timeUp),
);

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

function timeLeft(endsAt: number): string {
  const seconds = secondsLeft(endsAt);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
}

function setTimer(choice: string | null) {
  if (choice !== null) emit("send", { type: "set-floor-timer", seconds: timerSeconds(choice) });
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
        <span v-if="holder.timeUp" class="tag time-up">Time's up</span>
        <span v-else-if="holder.endsAt !== null" class="tag subtle">{{
          timeLeft(holder.endsAt)
        }}</span>
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
      <div class="inline-form wrap">
        <div class="field timer">
          <Select
            :items="TIMER_CHOICES"
            :value="timerChoice(floor.timerSeconds)"
            @value-change="setTimer"
          >
            <SelectLabel>Speaking timer</SelectLabel>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent />
          </Select>
        </div>
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
