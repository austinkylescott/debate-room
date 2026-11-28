<script setup lang="ts">
import { CheckboxGroup } from "@ui-sdk/vue/checkbox";
import { computed, ref, useId, watch } from "vue";
import { type Intensity, INTENSITY_NAMES, type Pack, PACKS, packsByTopic } from "../content/packs";
import { customPrompts, forgetCustomPrompt, saveCustomPrompt } from "../lib/customPrompts";
import { packOptions } from "../lib/selectOptions";
import { type Format, FORMAT_NAMES, type NewPrompt, PROMPT_MAX_LENGTH } from "../room/lineup";
import ChoiceCheckbox from "./ChoiceCheckbox.vue";
import SelectField from "./SelectField.vue";

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

const sourceOptions = computed(() => [
  ...packOptions(topics.value),
  { value: WRITE, label: "Write your own" },
]);
const INTENSITIES = Object.keys(INTENSITY_NAMES) as Intensity[];
const intensityOptions = [
  { value: "any", label: "Chill or Spicy" },
  ...INTENSITIES.map((key) => ({ value: key, label: `${INTENSITY_NAMES[key]} only` })),
];

function pickSource(id: string | null) {
  if (id === null || id === source.value) return;
  source.value = id;
  picked.value = [];
}

function pickIntensity(value: string | null) {
  if (value === "any" || INTENSITIES.includes(value as Intensity)) {
    intensity.value = value as Intensity | "any";
  }
}
const packLine = useId();

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
      <SelectField
        label="Add Prompts from"
        :options="sourceOptions"
        :model-value="source"
        @update:model-value="pickSource"
      />
      <SelectField
        label="Intensity"
        :options="intensityOptions"
        :model-value="intensity"
        @update:model-value="pickIntensity"
      />
    </div>

    <form v-if="pack" class="stack" @submit.prevent="addPicked">
      <div class="dr-card pack">
        <h4 :id="packLine" class="dr-card__title">{{ pack.title }}</h4>
        <p class="dr-card__meta">
          {{ pack.topic }} · {{ pack.prompts.length }}
          {{ pack.prompts.length === 1 ? "Prompt" : "Prompts" }} ·
          <span class="dr-tag" :class="`dr-tag--${pack.intensity}`">
            {{ INTENSITY_NAMES[pack.intensity] }}
          </span>
        </p>
        <p v-if="format === 'middle-ground' && pack.sides" class="dr-card__meta">
          Suggested Sides: {{ pack.sides[0] }} / {{ pack.sides[1] }}
        </p>
      </div>
      <CheckboxGroup v-model:value="picked" class="choices" :aria-labelledby="packLine">
        <ChoiceCheckbox v-for="prompt in packPrompts" :key="prompt.text" :value="prompt.text">
          {{ prompt.text }}
          <template #hint>
            Suits {{ prompt.formats.map((f) => FORMAT_NAMES[f]).join(", ") }}
          </template>
        </ChoiceCheckbox>
      </CheckboxGroup>
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
        <ChoiceCheckbox v-model:checked="draftSurprise">
          Surprise Prompt (hidden in the Preview)
        </ChoiceCheckbox>
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
