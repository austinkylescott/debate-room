<script setup lang="ts">
import { computed, ref } from "vue";
import { rememberPrompt } from "../../lib/customPrompts";
import {
  defaultSetup,
  EXCHANGE_SECONDS_MAX,
  EXCHANGE_SECONDS_MIN,
  type Format,
  FORMAT_NAMES,
  FORMATS,
  PROMPT_MAX_LENGTH,
  type Prompt,
  type Round,
  SIDE_NAME_MAX_LENGTH,
} from "../../room/lineup";
import type { Intent, WaitingRoomPerson } from "../../room/room";
import PromptPicker from "./PromptPicker.vue";

const props = defineProps<{
  round: Round;
  index: number;
  roundCount: number;
  people: WaitingRoomPerson[];
  send: (intent: Intent) => void;
}>();

const roundId = computed(() => props.round.id);
const newPrompt = ref("");
const editingId = ref<string | null>(null);
const editText = ref("");

function changeFormat(format: Format) {
  props.send({ type: "set-round-setup", roundId: roundId.value, setup: defaultSetup(format) });
}

function setSide(which: 0 | 1, name: string) {
  const setup = props.round.setup;
  if (setup.format !== "middle-ground") return;
  const sides: [string, string] = [...setup.sides];
  sides[which] = name;
  props.send({ type: "set-round-setup", roundId: roundId.value, setup: { ...setup, sides } });
}

function setCenter(value: string) {
  const setup = props.round.setup;
  if (setup.format !== "surrounded") return;
  const center =
    value === "volunteer"
      ? ({ mode: "volunteer" } as const)
      : ({ mode: "chosen", personId: value } as const);
  props.send({ type: "set-round-setup", roundId: roundId.value, setup: { ...setup, center } });
}

function setExchangeSeconds(value: string) {
  const setup = props.round.setup;
  if (setup.format !== "surrounded") return;
  props.send({
    type: "set-round-setup",
    roundId: roundId.value,
    setup: { ...setup, exchangeSeconds: Number(value) },
  });
}

function addCustomPrompt() {
  const text = newPrompt.value.trim();
  if (!text) return;
  rememberPrompt(text);
  props.send({ type: "add-prompts", roundId: roundId.value, prompts: [{ text, surprise: false }] });
  newPrompt.value = "";
}

function addPrompts(texts: string[]) {
  props.send({
    type: "add-prompts",
    roundId: roundId.value,
    prompts: texts.map((text) => ({ text, surprise: false })),
  });
}

function startEditing(prompt: Prompt) {
  editingId.value = prompt.id;
  editText.value = prompt.text;
}

function saveEdit(prompt: Prompt) {
  const text = editText.value.trim();
  editingId.value = null;
  if (!text || text === prompt.text) return;
  props.send({
    type: "edit-prompt",
    roundId: roundId.value,
    promptId: prompt.id,
    text,
    surprise: prompt.surprise,
  });
}

function toggleSurprise(prompt: Prompt) {
  props.send({
    type: "edit-prompt",
    roundId: roundId.value,
    promptId: prompt.id,
    text: prompt.text,
    surprise: !prompt.surprise,
  });
}

function movePrompt(prompt: Prompt, toIndex: number) {
  props.send({ type: "move-prompt", roundId: roundId.value, promptId: prompt.id, toIndex });
}

function removePrompt(prompt: Prompt) {
  props.send({ type: "remove-prompt", roundId: roundId.value, promptId: prompt.id });
}

function moveRound(toIndex: number) {
  props.send({ type: "move-round", roundId: roundId.value, toIndex });
}

function removeRound() {
  if (props.round.prompts.length > 0 && !confirm("Remove this Round and its Prompts?")) return;
  props.send({ type: "remove-round", roundId: roundId.value });
}
</script>

<template>
  <article class="round">
    <header class="round-header">
      <span class="round-number">Round {{ index + 1 }}</span>
      <select
        :value="round.setup.format"
        aria-label="Format"
        @change="changeFormat(($event.target as HTMLSelectElement).value as Format)"
      >
        <option v-for="format in FORMATS" :key="format" :value="format">
          {{ FORMAT_NAMES[format] }}
        </option>
      </select>
      <span class="icon-buttons">
        <button
          type="button"
          :disabled="index === 0"
          aria-label="Move Round up"
          @click="moveRound(index - 1)"
        >
          ↑
        </button>
        <button
          type="button"
          :disabled="index === roundCount - 1"
          aria-label="Move Round down"
          @click="moveRound(index + 1)"
        >
          ↓
        </button>
        <button type="button" aria-label="Remove Round" @click="removeRound">✕</button>
      </span>
    </header>

    <div v-if="round.setup.format === 'middle-ground'" class="setup two-up">
      <label v-for="which in [0, 1] as const" :key="which" class="field">
        <span>Side {{ which + 1 }}</span>
        <input
          :value="round.setup.sides[which]"
          :maxlength="SIDE_NAME_MAX_LENGTH"
          @change="setSide(which, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <div v-else-if="round.setup.format === 'surrounded'" class="setup two-up">
      <label class="field">
        <span>Center</span>
        <select
          :value="round.setup.center.mode === 'chosen' ? round.setup.center.personId : 'volunteer'"
          @change="setCenter(($event.target as HTMLSelectElement).value)"
        >
          <option value="volunteer">Open to volunteers</option>
          <option v-for="person in people" :key="person.id" :value="person.id">
            {{ person.nickname }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Exchange timer (seconds)</span>
        <input
          type="number"
          :value="round.setup.exchangeSeconds"
          :min="EXCHANGE_SECONDS_MIN"
          :max="EXCHANGE_SECONDS_MAX"
          step="5"
          @change="setExchangeSeconds(($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>

    <ol v-if="round.prompts.length > 0" class="prompts">
      <li
        v-for="(prompt, promptIndex) in round.prompts"
        :key="prompt.id"
        :class="{ surprise: prompt.surprise }"
      >
        <form v-if="editingId === prompt.id" class="copy-row" @submit.prevent="saveEdit(prompt)">
          <input v-model="editText" :maxlength="PROMPT_MAX_LENGTH" aria-label="Prompt text" />
          <button type="submit">Save</button>
        </form>
        <button
          v-else
          type="button"
          class="prompt-text"
          title="Edit Prompt"
          @click="startEditing(prompt)"
        >
          {{ prompt.text }}
        </button>
        <span class="prompt-actions">
          <button
            type="button"
            class="surprise-toggle"
            :aria-pressed="prompt.surprise"
            title="Surprise Prompts stay hidden in the Preview"
            @click="toggleSurprise(prompt)"
          >
            {{ prompt.surprise ? "★ Surprise" : "☆ Surprise" }}
          </button>
          <span class="icon-buttons">
            <button
              type="button"
              :disabled="promptIndex === 0"
              aria-label="Move Prompt up"
              @click="movePrompt(prompt, promptIndex - 1)"
            >
              ↑
            </button>
            <button
              type="button"
              :disabled="promptIndex === round.prompts.length - 1"
              aria-label="Move Prompt down"
              @click="movePrompt(prompt, promptIndex + 1)"
            >
              ↓
            </button>
            <button type="button" aria-label="Remove Prompt" @click="removePrompt(prompt)">
              ✕
            </button>
          </span>
        </span>
      </li>
    </ol>
    <p v-else class="muted">No Prompts yet.</p>

    <form class="copy-row" @submit.prevent="addCustomPrompt">
      <input
        v-model="newPrompt"
        :maxlength="PROMPT_MAX_LENGTH"
        placeholder="Write a Prompt, e.g. Cereal is a soup"
        aria-label="New Prompt"
      />
      <button type="submit">Add</button>
    </form>
    <PromptPicker @add="addPrompts" />
  </article>
</template>
