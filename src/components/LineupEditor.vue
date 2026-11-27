<script setup lang="ts">
import { ref } from "vue";
import { INTENSITY_NAMES, PACKS, packsByTopic } from "../content/packs";
import {
  defaultSetup,
  type Format,
  FORMAT_NAMES,
  FORMATS,
  type LineupIntent,
  MAX_ROUNDS,
  type Round,
} from "../room/lineup";
import type { WaitingRoomPerson } from "../room/room";
import RoundCard from "./RoundCard.vue";

const props = defineProps<{ rounds: Round[]; people: WaitingRoomPerson[] }>();
const emit = defineEmits<{ send: [intent: LineupIntent] }>();

const newFormat = ref<Format>("spectrum");
const shortcutFormat = ref<Format>("middle-ground");
const shortcutPack = ref(PACKS[0]?.id);
const topics = packsByTopic(PACKS);

function addRound() {
  emit("send", { type: "add-round", setup: defaultSetup(newFormat.value), prompts: [] });
}

/** "A whole night of one Format": one Round with every suitable Prompt from a Pack. */
function planWholeNight() {
  const pack = PACKS.find((p) => p.id === shortcutPack.value);
  if (!pack) return;
  if (
    props.rounds.length > 0 &&
    !confirm("Replace your whole Lineup with this one Round? Your current Rounds will be removed.")
  ) {
    return;
  }
  const format = shortcutFormat.value;
  emit("send", {
    type: "plan-single-round",
    setup: defaultSetup(format, pack.sides),
    prompts: pack.prompts
      .filter((p) => p.formats.includes(format))
      .map((p) => ({ text: p.text, surprise: false })),
  });
}
</script>

<template>
  <section class="dr-card stack">
    <h2>
      Lineup
      <span class="count">{{ rounds.length }} {{ rounds.length === 1 ? "Round" : "Rounds" }}</span>
    </h2>

    <p v-if="rounds.length === 0" class="muted">
      Plan the night: add Rounds, pick a Format for each and choose its Prompts.
    </p>

    <RoundCard
      v-for="(round, i) in rounds"
      :key="round.id"
      :round="round"
      :index="i"
      :count="rounds.length"
      :people="people"
      @send="(intent) => emit('send', intent)"
    />

    <form class="inline-form" @submit.prevent="addRound">
      <label class="field">
        <span>New Round</span>
        <select v-model="newFormat">
          <option v-for="f in FORMATS" :key="f" :value="f">{{ FORMAT_NAMES[f] }}</option>
        </select>
      </label>
      <button type="submit" :disabled="rounds.length >= MAX_ROUNDS">Add Round</button>
    </form>

    <details class="shortcut">
      <summary>Or plan a whole night of one Format</summary>
      <form class="stack" @submit.prevent="planWholeNight">
        <div class="pair">
          <label class="field">
            <span>Format</span>
            <select v-model="shortcutFormat">
              <option v-for="f in FORMATS" :key="f" :value="f">{{ FORMAT_NAMES[f] }}</option>
            </select>
          </label>
          <label class="field">
            <span>Pack</span>
            <select v-model="shortcutPack">
              <optgroup v-for="group in topics" :key="group.topic" :label="group.topic">
                <option v-for="p in group.packs" :key="p.id" :value="p.id">
                  {{ p.title }} · {{ INTENSITY_NAMES[p.intensity] }}
                </option>
              </optgroup>
            </select>
          </label>
        </div>
        <button type="submit">Plan the night</button>
      </form>
    </details>
  </section>
</template>
