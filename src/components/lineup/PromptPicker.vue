<script setup lang="ts">
import { computed, ref } from "vue";
import { DUMMY_PACKS } from "../../content/dummy-packs";
import { forgetPrompt, savedPrompts } from "../../lib/customPrompts";

const emit = defineEmits<{ add: [texts: string[]] }>();

const SAVED = "saved";
const source = ref(DUMMY_PACKS[0]?.id ?? SAVED);
const prompts = computed(() =>
  source.value === SAVED
    ? savedPrompts.value
    : (DUMMY_PACKS.find((p) => p.id === source.value)?.prompts ?? []),
);
</script>

<template>
  <details class="picker">
    <summary>Pick from a Pack or your saved Prompts</summary>
    <div class="stack">
      <select v-model="source" aria-label="Where to pick Prompts from">
        <option v-for="pack in DUMMY_PACKS" :key="pack.id" :value="pack.id">
          {{ pack.topic }}: {{ pack.name }}
        </option>
        <option :value="SAVED">Your saved Prompts ({{ savedPrompts.length }})</option>
      </select>
      <p v-if="prompts.length === 0" class="muted">
        Prompts you write are saved in this browser and show up here in later Rooms.
      </p>
      <ul v-else class="pick-list">
        <li v-for="text in prompts" :key="text">
          <span>{{ text }}</span>
          <span class="icon-buttons">
            <button type="button" @click="emit('add', [text])">Add</button>
            <button
              v-if="source === SAVED"
              type="button"
              aria-label="Forget this saved Prompt"
              @click="forgetPrompt(text)"
            >
              ✕
            </button>
          </span>
        </li>
      </ul>
      <button
        v-if="source !== SAVED && prompts.length > 1"
        type="button"
        @click="emit('add', prompts)"
      >
        Add all {{ prompts.length }}
      </button>
    </div>
  </details>
</template>
