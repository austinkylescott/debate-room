<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { type Intensity, INTENSITY_NAMES, type Pack, PACKS, packsByTopic } from "../content/packs";
import { customPrompts, forgetCustomPrompt, saveCustomPrompt } from "../lib/customPrompts";
import { type Format, FORMAT_NAMES, type NewPrompt, PROMPT_MAX_LENGTH } from "../room/lineup";

const props = defineProps<{ format: Format }>();
// The Pack is passed along so a Middle Ground Round can take its suggested Sides.
const emit = defineEmits<{ add: [prompts: NewPrompt[], pack?: Pack] }>();

const WRITE = "write";
const intensity = ref<Intensity | "any">("any");
const topics = computed(() => packsByTopic(PACKS, intensity.value));
const source = ref<string>(PACKS[0]?.id ?? WRITE);
const picked = ref<string[]>([]);
const draft = ref("");
const draftSurprise = ref(false);

const pack = computed(() => PACKS.find((p) => p.id === source.value));

// Filtering by Intensity can hide the chosen Pack: move to the first one left.
watch(topics, (groups) => {
  if (source.value === WRITE) return;
  if (groups.some((g) => g.packs.some((p) => p.id === source.value))) return;
  source.value = groups[0]?.packs[0]?.id ?? WRITE;
  picked.value = [];
});

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
    pack.value,
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
    <div class="pair">
      <label class="field">
        <span>Add Prompts from</span>
        <select v-model="source" @change="picked = []">
          <optgroup v-for="group in topics" :key="group.topic" :label="group.topic">
            <option v-for="p in group.packs" :key="p.id" :value="p.id">
              {{ p.title }} · {{ INTENSITY_NAMES[p.intensity] }}
            </option>
          </optgroup>
          <option :value="WRITE">Write your own</option>
        </select>
      </label>
      <label class="field">
        <span>Intensity</span>
        <select v-model="intensity">
          <option value="any">Chill or Spicy</option>
          <option v-for="(name, key) in INTENSITY_NAMES" :key="key" :value="key">
            {{ name }} only
          </option>
        </select>
      </label>
    </div>

    <form v-if="pack" class="stack" @submit.prevent="addPicked">
      <p class="muted small">
        {{ pack.topic }} ·
        <span class="dr-tag" :class="`dr-tag--${pack.intensity}`">
          {{ INTENSITY_NAMES[pack.intensity] }}
        </span>
        <template v-if="format === 'middle-ground' && pack.sides">
          · Suggested Sides: {{ pack.sides[0] }} / {{ pack.sides[1] }}
        </template>
      </p>
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
