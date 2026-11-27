<script setup lang="ts">
import { computed } from "vue";
import { floorMarks } from "../lib/electron";
import type { SideIndex } from "../room/middle-ground";
import type { FloorView, Intent, StageView } from "../room/room";
import Electron from "./Electron.vue";
import MoodPanel from "./MoodPanel.vue";

const props = defineProps<{
  stage: Extract<StageView, { format: "middle-ground" }>;
  isHost: boolean;
  personId: string;
  isSpectator?: boolean;
  /** Who has the Floor and whose hands are up, marked on their electrons. */
  floor?: FloorView | null;
}>();
const emit = defineEmits<{ send: [intent: Intent] }>();

const middle = computed(() => props.stage.middleGround);
const yours = computed(() => middle.value.yours);
const chosenCount = computed(() => middle.value.people.filter((p) => p.playing && p.chosen).length);
const playingCount = computed(() => middle.value.people.filter((p) => p.playing).length);

/** Where each person shows: on a Side, in the middle, or not on a Side yet. */
const columns = computed(() => {
  const sides: [typeof middle.value.people, typeof middle.value.people] = [[], []];
  const inMiddle: typeof middle.value.people = [];
  const unsided: typeof middle.value.people = [];
  for (const person of middle.value.people) {
    if (person.side === null) unsided.push(person);
    else if (person.inMiddle) inMiddle.push(person);
    else sides[person.side].push(person);
  }
  return { sides, inMiddle, unsided };
});

const canChoose = computed(
  () =>
    yours.value !== null &&
    yours.value.playing &&
    yours.value.side !== null &&
    (middle.value.step === "revealed" ||
      (middle.value.step === "choosing" && yours.value.inMiddle === null)),
);

function pick(side: SideIndex) {
  emit("send", { type: "pick-side", side });
}

function choose(stepIn: boolean) {
  emit("send", { type: "choose-middle", stepIn });
}

function moveToOtherSide(personId: string, side: SideIndex) {
  emit("send", { type: "move-to-side", personId, side: side === 0 ? 1 : 0 });
}

/** Someone's current Mood, shown on their electron. */
const moodOf = (personId: string) => props.stage.moods[personId] ?? null;

const marks = computed(() => floorMarks(props.floor ?? null));

/**
 * A Host or Co-Host who isn't Playing sees choices before the reveal: dimmed,
 * with "Only you can see this" (hard rule 4).
 */
const peeking = computed(() => middle.value.choicesVisible && middle.value.step === "choosing");

const checkInOpen = computed(() => props.stage.checkIn?.status === "open");

const advanceLabel = computed(() => {
  if (middle.value.step === "revealed") return "End this Prompt";
  return props.stage.promptNumber < props.stage.promptCount
    ? "Next Prompt"
    : "Back to the Waiting Room";
});
</script>

<template>
  <section class="card stage">
    <p class="eyebrow">
      Middle Ground · Prompt {{ stage.promptNumber }} of {{ stage.promptCount }}
    </p>
    <h1>{{ stage.prompt.text }}</h1>

    <!-- The Sides and the middle -->
    <div v-if="middle.step !== 'summary'" class="middle-ground">
      <div v-for="side in [0, 1] as const" :key="side" class="side" :class="`side-${side}`">
        <h2>{{ middle.sides[side] }}</h2>
        <ul class="people">
          <li v-for="person in columns.sides[side]" :key="person.personId">
            <Electron
              :name="person.nickname"
              size="sm"
              layout="row"
              :mood="moodOf(person.personId)"
              :peek="peeking && person.chosen"
              v-bind="marks(person.personId)"
            />
            <template v-if="middle.step === 'choosing' && person.playing">
              <span v-if="person.chosen && middle.choicesVisible" class="tag subtle">Staying</span>
              <span v-else-if="person.chosen" class="tag">Chosen</span>
              <span v-else class="tag subtle">Deciding</span>
            </template>
            <button
              v-if="isHost"
              type="button"
              class="link"
              :title="`Move ${person.nickname} to ${middle.sides[side === 0 ? 1 : 0]}`"
              @click="moveToOtherSide(person.personId, side)"
            >
              Move
            </button>
          </li>
        </ul>
      </div>
      <div class="side middle">
        <h2>
          {{ middle.step === "choosing" && middle.choicesVisible ? "Stepping in" : "The middle" }}
        </h2>
        <ul class="people">
          <li v-for="person in columns.inMiddle" :key="person.personId">
            <Electron
              :name="person.nickname"
              size="sm"
              layout="row"
              :mood="moodOf(person.personId)"
              :peek="peeking"
              v-bind="marks(person.personId)"
            />
            <span v-if="person.side !== null" class="tag subtle">{{
              middle.sides[person.side]
            }}</span>
            <button
              v-if="isHost && person.side !== null"
              type="button"
              class="link"
              :title="`Move ${person.nickname} to ${middle.sides[person.side === 0 ? 1 : 0]}`"
              @click="moveToOtherSide(person.personId, person.side)"
            >
              Move
            </button>
          </li>
        </ul>
        <p v-if="middle.step === 'choosing' && !middle.choicesVisible" class="muted small">
          Choices stay hidden until the reveal.
        </p>
        <p v-else-if="peeking" class="muted small">Only you can see this.</p>
      </div>
    </div>
    <p v-if="columns.unsided.length && middle.step !== 'summary'" class="muted small">
      Picking a Side: {{ columns.unsided.map((p) => p.nickname).join(", ") }}
    </p>

    <!-- Your own place -->
    <div v-if="yours && middle.step !== 'summary'" class="stack">
      <template v-if="yours.side === null">
        <p>Pick your Side for this Round. Only the Host can move you after that.</p>
        <!-- Two equal choices, so neither is the spark; is-your-move still quiets Raise hand -->
        <div class="pair is-your-move">
          <button v-for="side in [0, 1] as const" :key="side" type="button" @click="pick(side)">
            {{ middle.sides[side] }}
          </button>
        </div>
      </template>
      <template v-else-if="!yours.playing">
        <p class="muted">You joined mid-Prompt: you'll be in from the next one.</p>
      </template>
      <template v-else-if="middle.step === 'choosing' && canChoose">
        <p>Do you step into the middle? Nobody sees your choice until the reveal.</p>
        <div class="pair">
          <button class="primary" type="button" @click="choose(true)">Step into the middle</button>
          <button type="button" @click="choose(false)">Stay</button>
        </div>
      </template>
      <p v-else-if="middle.step === 'choosing'" class="muted">
        You chose to {{ yours.inMiddle ? "step in" : "stay" }}. Waiting for everyone else…
      </p>
      <template v-else>
        <p class="muted">Choices are out. You can still move.</p>
        <button v-if="yours.inMiddle" type="button" @click="choose(false)">Step back</button>
        <button v-else type="button" @click="choose(true)">Step into the middle</button>
      </template>
    </div>
    <p v-else-if="isSpectator && middle.step !== 'summary'" class="muted">
      You're a Spectator: you see what the people Playing see.
    </p>
    <p v-else-if="!stage.playing && !isHost && middle.step !== 'summary'" class="muted">
      You joined mid-Prompt: you'll be in from the next one.
    </p>

    <MoodPanel :stage="stage" :person-id="personId" @send="emit('send', $event)" />

    <p v-if="middle.step === 'choosing'" class="muted">
      <span class="count">{{ chosenCount }} of {{ playingCount }} have chosen</span>
    </p>

    <!-- Summary card -->
    <template v-if="middle.summary">
      <h2>Who stepped in</h2>
      <table class="summary">
        <tbody>
          <tr v-for="side in [0, 1] as const" :key="side">
            <th scope="row">{{ middle.sides[side] }}</th>
            <td>
              {{ middle.summary.steppedIn[side] }} of {{ middle.summary.onSide[side] }} stepped in
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- Host controls -->
    <div v-if="isHost" class="host-controls">
      <button
        v-if="middle.step === 'choosing'"
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
