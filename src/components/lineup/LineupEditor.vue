<script setup lang="ts">
import { computed, ref } from "vue";
import { DUMMY_PACKS } from "../../content/dummy-packs";
import { defaultSetup, type Format, FORMAT_NAMES, FORMATS, type Round } from "../../room/lineup";
import type { Intent, WaitingRoomPerson } from "../../room/room";
import RoundCard from "./RoundCard.vue";

const props = defineProps<{
  lineup: Round[];
  people: WaitingRoomPerson[];
  send: (intent: Intent) => void;
}>();

const shortcutFormat = ref<Format>("middle-ground");
const shortcutPackId = ref(DUMMY_PACKS[0]?.id ?? "");
const shortcutPack = computed(() => DUMMY_PACKS.find((p) => p.id === shortcutPackId.value));

function addRound(format: Format) {
  props.send({ type: "add-round", setup: defaultSetup(format) });
}

function useSingleRound() {
  const pack = shortcutPack.value;
  if (!pack) return;
  const replacing = props.lineup.length > 0;
  if (replacing && !confirm("Replace your whole Lineup with this one Round?")) return;
  props.send({
    type: "use-single-round",
    setup: defaultSetup(shortcutFormat.value),
    prompts: pack.prompts.map((text) => ({ text, surprise: false })),
  });
}
</script>

<template>
  <section class="card stack">
    <h2>
      Lineup
      <span class="count">{{ lineup.length }} {{ lineup.length === 1 ? "Round" : "Rounds" }}</span>
    </h2>

    <p v-if="lineup.length === 0" class="muted">
      Plan the night: add Rounds, then pick or write the Prompts for each one.
    </p>

    <RoundCard
      v-for="(round, index) in lineup"
      :key="round.id"
      :round="round"
      :index="index"
      :round-count="lineup.length"
      :people="people"
      :send="send"
    />

    <div class="stack">
      <span class="label">Add a Round</span>
      <div class="button-row">
        <button v-for="format in FORMATS" :key="format" type="button" @click="addRound(format)">
          + {{ FORMAT_NAMES[format] }}
        </button>
      </div>
    </div>

    <details class="shortcut">
      <summary>Or run a whole night of one Format</summary>
      <div class="stack">
        <label class="field">
          <span>Format</span>
          <select v-model="shortcutFormat">
            <option v-for="format in FORMATS" :key="format" :value="format">
              {{ FORMAT_NAMES[format] }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>Pack</span>
          <select v-model="shortcutPackId">
            <option v-for="pack in DUMMY_PACKS" :key="pack.id" :value="pack.id">
              {{ pack.topic }}: {{ pack.name }} ({{ pack.prompts.length }})
            </option>
          </select>
        </label>
        <button type="button" @click="useSingleRound">Build a one-Round Lineup</button>
      </div>
    </details>
  </section>
</template>
