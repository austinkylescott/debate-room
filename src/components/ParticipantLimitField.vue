<script setup lang="ts">
import { MAX_PARTICIPANT_LIMIT } from "../room/room";

const limit = defineModel<number>({ required: true });
</script>

<template>
  <label class="field">
    <span>Participant limit (1 to {{ MAX_PARTICIPANT_LIMIT }})</span>
    <input
      v-model.number="limit"
      type="number"
      inputmode="numeric"
      min="1"
      :max="MAX_PARTICIPANT_LIMIT"
      step="1"
      required
    />
  </label>
</template>
