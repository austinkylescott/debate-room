<script setup lang="ts">
import { FORMAT_NAMES, type PreviewRound } from "../room/lineup";

defineProps<{ rounds: PreviewRound[] }>();
</script>

<template>
  <div class="stack">
    <h2>
      The Lineup
      <span class="count">{{ rounds.length }} {{ rounds.length === 1 ? "Round" : "Rounds" }}</span>
    </h2>
    <p v-if="rounds.length === 0" class="muted">The Host hasn't planned any Rounds yet.</p>
    <article v-for="(round, index) in rounds" :key="round.id" class="round stack">
      <header class="round-head">
        <h3>Round {{ index + 1 }}: {{ FORMAT_NAMES[round.setup.format] }}</h3>
      </header>
      <p v-if="round.setup.format === 'middle-ground'" class="muted">
        {{ round.setup.sides[0] }} vs {{ round.setup.sides[1] }}
      </p>
      <p v-if="round.prompts.length === 0" class="muted small">No Prompts yet.</p>
      <ol v-else class="prompts">
        <li v-for="prompt in round.prompts" :key="prompt.id">
          <span v-if="'text' in prompt" class="name">{{ prompt.text }}</span>
          <span v-else class="name muted">Surprise Prompt, revealed when it's played</span>
        </li>
      </ol>
    </article>
  </div>
</template>
