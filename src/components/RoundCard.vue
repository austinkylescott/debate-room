<script setup lang="ts">
import { ref } from "vue";
import {
  defaultSetup,
  type Format,
  FORMAT_NAMES,
  FORMATS,
  type LineupIntent,
  MAX_EXCHANGE_SECONDS,
  MIN_EXCHANGE_SECONDS,
  type Prompt,
  PROMPT_MAX_LENGTH,
  type Round,
  SIDE_MAX_LENGTH,
} from "../room/lineup";
import type { WaitingRoomPerson } from "../room/room";
import PromptPicker from "./PromptPicker.vue";

const props = defineProps<{
  round: Round;
  index: number;
  count: number;
  /** Who can be picked as a Surrounded Center. */
  people: WaitingRoomPerson[];
}>();
const emit = defineEmits<{ send: [intent: LineupIntent] }>();

const pickerOpen = ref(props.round.prompts.length === 0);
const editingId = ref<string | null>(null);
const draft = ref("");

const roundId = () => props.round.id;

function changeFormat(format: Format) {
  emit("send", { type: "set-round-setup", roundId: roundId(), setup: defaultSetup(format) });
}

function changeSide(which: 0 | 1, name: string) {
  if (props.round.setup.format !== "middle-ground") return;
  const sides: [string, string] = [...props.round.setup.sides];
  sides[which] = name;
  emit("send", {
    type: "set-round-setup",
    roundId: roundId(),
    setup: { ...props.round.setup, sides },
  });
}

function changeSurrounded(change: { centerId?: string | null; exchangeSeconds?: number }) {
  if (props.round.setup.format !== "surrounded") return;
  emit("send", {
    type: "set-round-setup",
    roundId: roundId(),
    setup: { ...props.round.setup, ...change },
  });
}

function startEdit(prompt: Prompt) {
  editingId.value = prompt.id;
  draft.value = prompt.text;
}

function saveEdit(prompt: Prompt) {
  emit("send", {
    type: "edit-prompt",
    roundId: roundId(),
    promptId: prompt.id,
    text: draft.value,
    surprise: prompt.surprise,
  });
  editingId.value = null;
}

function confirmRemoveRound() {
  const label = `Round ${props.index + 1} (${FORMAT_NAMES[props.round.setup.format]})`;
  if (props.round.prompts.length === 0 || confirm(`Remove ${label} and its Prompts?`)) {
    emit("send", { type: "remove-round", roundId: roundId() });
  }
}

const value = (event: Event) => (event.target as HTMLInputElement).value;
</script>

<template>
  <article class="round stack">
    <header class="round-head">
      <h3>Round {{ index + 1 }}</h3>
      <span class="actions">
        <button
          type="button"
          class="link"
          :disabled="index === 0"
          :aria-label="`Move Round ${index + 1} up`"
          @click="emit('send', { type: 'move-round', roundId: round.id, toIndex: index - 1 })"
        >
          ↑
        </button>
        <button
          type="button"
          class="link"
          :disabled="index === count - 1"
          :aria-label="`Move Round ${index + 1} down`"
          @click="emit('send', { type: 'move-round', roundId: round.id, toIndex: index + 1 })"
        >
          ↓
        </button>
        <button type="button" class="link danger" @click="confirmRemoveRound">Remove</button>
      </span>
    </header>

    <label class="field">
      <span>Format</span>
      <select :value="round.setup.format" @change="changeFormat(value($event) as Format)">
        <option v-for="f in FORMATS" :key="f" :value="f">{{ FORMAT_NAMES[f] }}</option>
      </select>
    </label>

    <div v-if="round.setup.format === 'middle-ground'" class="pair">
      <label class="field">
        <span>Side 1</span>
        <input
          :value="round.setup.sides[0]"
          :maxlength="SIDE_MAX_LENGTH"
          required
          @change="changeSide(0, value($event))"
        />
      </label>
      <label class="field">
        <span>Side 2</span>
        <input
          :value="round.setup.sides[1]"
          :maxlength="SIDE_MAX_LENGTH"
          required
          @change="changeSide(1, value($event))"
        />
      </label>
    </div>

    <div v-else-if="round.setup.format === 'surrounded'" class="pair">
      <label class="field">
        <span>Center</span>
        <select
          :value="round.setup.centerId ?? ''"
          @change="changeSurrounded({ centerId: value($event) || null })"
        >
          <option value="">A volunteer steps up</option>
          <option v-for="person in people" :key="person.id" :value="person.id">
            {{ person.nickname }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>Exchange timer (seconds)</span>
        <input
          type="number"
          inputmode="numeric"
          :value="round.setup.exchangeSeconds"
          :min="MIN_EXCHANGE_SECONDS"
          :max="MAX_EXCHANGE_SECONDS"
          step="5"
          required
          @change="changeSurrounded({ exchangeSeconds: Number(value($event)) })"
        />
      </label>
    </div>

    <ol v-if="round.prompts.length > 0" class="prompts">
      <li v-for="(prompt, i) in round.prompts" :key="prompt.id">
        <form v-if="editingId === prompt.id" class="rename-row" @submit.prevent="saveEdit(prompt)">
          <input v-model="draft" aria-label="Prompt text" :maxlength="PROMPT_MAX_LENGTH" required />
          <button type="submit">Save</button>
          <button type="button" @click="editingId = null">Cancel</button>
        </form>
        <template v-else>
          <span class="name">{{ prompt.text }}</span>
          <label class="check small">
            <input
              type="checkbox"
              :checked="prompt.surprise"
              @change="
                emit('send', {
                  type: 'edit-prompt',
                  roundId: round.id,
                  promptId: prompt.id,
                  text: prompt.text,
                  surprise: !prompt.surprise,
                })
              "
            />
            Surprise
          </label>
          <span class="actions">
            <button
              type="button"
              class="link"
              :disabled="i === 0"
              aria-label="Move Prompt up"
              @click="
                emit('send', {
                  type: 'move-prompt',
                  roundId: round.id,
                  promptId: prompt.id,
                  toIndex: i - 1,
                })
              "
            >
              ↑
            </button>
            <button
              type="button"
              class="link"
              :disabled="i === round.prompts.length - 1"
              aria-label="Move Prompt down"
              @click="
                emit('send', {
                  type: 'move-prompt',
                  roundId: round.id,
                  promptId: prompt.id,
                  toIndex: i + 1,
                })
              "
            >
              ↓
            </button>
            <button type="button" class="link" @click="startEdit(prompt)">Edit</button>
            <button
              type="button"
              class="link danger"
              @click="
                emit('send', { type: 'remove-prompt', roundId: round.id, promptId: prompt.id })
              "
            >
              Remove
            </button>
          </span>
        </template>
      </li>
    </ol>
    <p v-else class="muted">No Prompts yet.</p>

    <PromptPicker
      v-if="pickerOpen"
      :format="round.setup.format"
      @add="(prompts) => emit('send', { type: 'add-prompts', roundId: round.id, prompts })"
    />
    <button type="button" class="link" @click="pickerOpen = !pickerOpen">
      {{ pickerOpen ? "Done adding Prompts" : "Add Prompts" }}
    </button>
  </article>
</template>
