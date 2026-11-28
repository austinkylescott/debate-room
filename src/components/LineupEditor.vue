<script setup lang="ts">
import { ask } from "../lib/ask";
import { ref } from "vue";
import { PACKS, packsByTopic } from "../content/packs";
import { packOptions } from "../lib/selectOptions";
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
import SelectField from "./SelectField.vue";

const props = defineProps<{ rounds: Round[]; people: WaitingRoomPerson[] }>();
const emit = defineEmits<{ send: [intent: LineupIntent] }>();

const newFormat = ref<Format>("spectrum");
const shortcutFormat = ref<Format>("middle-ground");
const shortcutPack = ref(PACKS[0]?.id);
const formatOptions = FORMATS.map((f) => ({ value: f, label: FORMAT_NAMES[f] }));
const packChoices = packOptions(packsByTopic(PACKS));
const isFormat = (value: string | null): value is Format =>
  (FORMATS as readonly string[]).includes(value ?? "");

function addRound() {
  emit("send", { type: "add-round", setup: defaultSetup(newFormat.value), prompts: [] });
}

/** "A whole night of one Format": one Round with every suitable Prompt from a Pack. */
async function planWholeNight() {
  const pack = PACKS.find((p) => p.id === shortcutPack.value);
  if (!pack) return;
  if (
    props.rounds.length > 0 &&
    !(await ask({
      title: "Replace your whole Lineup?",
      description: "This one Round takes the place of your current Rounds.",
      confirmLabel: "Replace the Lineup",
    }))
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
      <SelectField
        label="New Round"
        :options="formatOptions"
        :model-value="newFormat"
        @update:model-value="(f) => isFormat(f) && (newFormat = f)"
      />
      <button type="submit" :disabled="rounds.length >= MAX_ROUNDS">Add Round</button>
    </form>

    <details class="shortcut">
      <summary>Or plan a whole night of one Format</summary>
      <form class="stack" @submit.prevent="planWholeNight">
        <div class="pair">
          <SelectField
            label="Format"
            :options="formatOptions"
            :model-value="shortcutFormat"
            @update:model-value="(f) => isFormat(f) && (shortcutFormat = f)"
          />
          <SelectField
            label="Pack"
            :options="packChoices"
            :model-value="shortcutPack ?? null"
            @update:model-value="(id) => id && (shortcutPack = id)"
          />
        </div>
        <button type="submit">Plan the night</button>
      </form>
    </details>
  </section>
</template>
