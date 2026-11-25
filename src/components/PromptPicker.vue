<script setup lang="ts">
import { computed, ref } from "vue";
import { INTENSITY_NAMES, PACKS } from "../content/packs";
import { customPrompts, forgetCustomPrompt, saveCustomPrompt } from "../lib/customPrompts";
import { type Format, FORMAT_NAMES, type NewPrompt, PROMPT_MAX_LENGTH } from "../room/lineup";

const props = defineProps<{ format: Format }>();
const emit = defineEmits<{ add: [prompts: NewPrompt[]] }>();

const WRITE = "write";
const source = ref<string>(PACKS[0].id);
const picked = ref<string[]>([]);
const draft = ref("");
const draftSurprise = ref(false);

const pack = computed(() => PACKS.find((p) => p.id === source.value));
// Prompts that suit this Round's Format come first.
const packPrompts = computed(() => {
  const all = pack.value?.prompts ?? [];
  return [
    ...all.filter((p) => p.formats.includes(props.format)),
    ...all.filter((p) => !p.formats.includes(props.format)),
  ];
});

function addPicked() {
  emit(
    "add",
    picked.value.map((text) => ({ text, surprise: false })),
  );
  picked.value = [];
}

function addWritten() {
  saveCustomPrompt(draft.value);
  emit("add", [{ text: draft.value, surprise: draftSurprise.value }]);
  draft.value = "";
  draftSurprise.value = false;
}
</script>

<template>
  <div class="picker stack">
    <label class="field">
      <span>Add Prompts from</span>
      <select v-model="source" @change="picked = []">
        <option v-for="p in PACKS" :key="p.id" :value="p.id">
          {{ p.title }} · {{ p.topic }} · {{ INTENSITY_NAMES[p.intensity] }}
        </option>
        <option :value="WRITE">Write your own</option>
      </select>
    </label>

    <form v-if="pack" class="stack" @submit.prevent="addPicked">
      <ul class="choices">
        <li v-for="prompt in packPrompts" :key="prompt.text">
          <label>
            <input v-model="picked" type="checkbox" :value="prompt.text" />
            <span>
              {{ prompt.text }}
              <span class="muted small">
                Suits {{ prompt.formats.map((f) => FORMAT_NAMES[f]).join(", ") }}
              </span>
            </span>
          </label>
        </li>
      </ul>
      <button type="submit" :disabled="picked.length === 0">
        Add {{ picked.length || "" }} {{ picked.length === 1 ? "Prompt" : "Prompts" }}
      </button>
    </form>

    <template v-else>
      <form class="stack" @submit.prevent="addWritten">
        <label class="field">
          <span>Your Prompt</span>
          <input
            v-model="draft"
            :maxlength="PROMPT_MAX_LENGTH"
            placeholder="e.g. Group chats should have a mute-all button"
            required
          />
        </label>
        <label class="check">
          <input v-model="draftSurprise" type="checkbox" />
          Surprise Prompt (hidden in the Preview)
        </label>
        <button type="submit">Add Prompt</button>
      </form>
      <div v-if="customPrompts.length > 0">
        <p class="muted small">Saved in this browser for your future Rooms</p>
        <ul class="choices">
          <li v-for="text in customPrompts" :key="text" class="saved">
            <span>{{ text }}</span>
            <button type="button" class="link" @click="emit('add', [{ text, surprise: false }])">
              Add
            </button>
            <button type="button" class="link danger" @click="forgetCustomPrompt(text)">
              Forget
            </button>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
