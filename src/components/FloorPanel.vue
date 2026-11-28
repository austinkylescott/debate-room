<script setup lang="ts">
import { computed } from "vue";
import { initials } from "../lib/electron";
import { MOODS, type Mood } from "../room/mood";
import type { FloorView, Intent, WaitingRoomPerson } from "../room/room";
import Electron from "./Electron.vue";
import ShapeZone from "./ShapeZone.vue";
import Timer from "./Timer.vue";

const props = defineProps<{
  floor: FloorView;
  people: WaitingRoomPerson[];
  youId: string;
  isHost: boolean;
  isSpectator?: boolean;
  /** Each Playing person's Mood, shown beside the speaker's name. */
  moods?: Record<string, Mood>;
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

/** Who the kidney features: the first person with the Floor. */
const speaker = computed(() => props.floor.holders[0] ?? null);
const speakerMood = computed(
  () => MOODS.find((m) => m.id === props.moods?.[speaker.value?.personId ?? ""]) ?? null,
);
/** "Next: Dev, then Kiki": the first two raised hands. */
const next = computed(() => {
  const [first, second] = props.floor.raisedHands;
  if (!first) return null;
  return second ? `Next: ${first.nickname}, then ${second.nickname}` : `Next: ${first.nickname}`;
});
/** The raised-hand queue riding the timer's outer orbit, up to three, from the upper left. */
const QUEUE_ANGLES = [-150, -115, -80];
const queue = computed(() =>
  props.floor.raisedHands.slice(0, QUEUE_ANGLES.length).map((hand, i) => {
    const angle = (QUEUE_ANGLES[i] * Math.PI) / 180;
    return {
      ...hand,
      initials: initials(hand.nickname),
      left: `${50 + Math.cos(angle) * 46.5}%`,
      top: `${50 + Math.sin(angle) * 46.5}%`,
    };
  }),
);
const canRaise = computed(
  () => !props.isHost && !props.isSpectator && !youHaveFloor.value && yourHand.value === null,
);

function setTimer(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  emit("send", { type: "set-floor-timer", seconds: value === "" ? null : Number(value) });
}
</script>

<template>
  <section class="card floor">
    <h2>The Floor</h2>

    <ShapeZone variant="floor">
      <div class="dr-floor">
        <span class="dr-floor__dial">
          <Timer
            v-if="speaker && speaker.endsAt !== null"
            :ends-at="speaker.endsAt"
            :total-seconds="speaker.durationSeconds ?? 0"
            :time-up="speaker.timeUp"
            :label="
              speaker.personId === youId
                ? 'Your speaking time'
                : `${speaker.nickname}'s speaking time`
            "
          />
          <svg v-else class="dr-floor__atom" viewBox="0 0 86 86" aria-hidden="true">
            <ellipse
              v-for="angle in [0, 60, 120]"
              :key="angle"
              cx="43"
              cy="43"
              rx="42"
              ry="15.12"
              :transform="`rotate(${angle} 43 43)`"
            />
            <circle cx="43" cy="43" r="5" />
          </svg>
          <span
            v-for="hand in queue"
            :key="hand.personId"
            class="dr-floor__queued"
            :style="{ left: hand.left, top: hand.top }"
            aria-hidden="true"
            >{{ hand.initials }}</span
          >
        </span>
        <div class="dr-floor__who">
          <small>On the Floor</small>
          <b v-if="speaker" class="dr-floor__speaker">
            <span class="dr-floor__name" :title="speaker.nickname">{{ speaker.nickname }}</span>
            <span v-if="speakerMood" role="img" :aria-label="speakerMood.label">{{
              speakerMood.emoji
            }}</span>
          </b>
          <b v-else class="dr-floor__speaker">No one yet</b>
          <small v-if="floor.holders.length > 1">and {{ floor.holders.length - 1 }} more</small>
          <small v-if="next" class="dr-floor__next" :title="next">{{ next }}</small>
        </div>
        <button
          v-if="canRaise"
          class="primary dr-floor__raise"
          type="button"
          aria-label="Raise your hand"
          @click="emit('send', { type: 'raise-hand' })"
        >
          ✋ Raise
        </button>
      </div>
    </ShapeZone>

    <ul v-if="isHost && floor.holders.length" class="people">
      <li
        v-for="holder in floor.holders"
        :key="holder.personId"
        :class="{ you: holder.personId === youId }"
      >
        <Electron :name="holder.nickname" layout="row" speaking />
        <button
          type="button"
          class="link"
          @click="emit('send', { type: 'take-floor', personId: holder.personId })"
        >
          Take back
        </button>
      </li>
    </ul>

    <!-- Participants ask for the Floor; Spectators only watch -->
    <template v-if="!isHost">
      <p v-if="isSpectator" class="muted small">Spectators watch: they don't raise hands.</p>
      <p v-else-if="youHaveFloor" class="muted">You have the Floor.</p>
      <div v-else-if="yourHand !== null" class="inline-form">
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
          <Electron :name="person.nickname" layout="row" :hand="person.hand" />
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
