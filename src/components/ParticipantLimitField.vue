<script setup lang="ts">
import { MAX_PARTICIPANT_LIMIT } from "../room/room";
import TextField from "./TextField.vue";

defineProps<{ error?: string | null }>();
const limit = defineModel<number>({ required: true });
</script>

<template>
  <TextField
    v-model.number="limit"
    :label="`Participant limit (1 to ${MAX_PARTICIPANT_LIMIT})`"
    :error="error"
    type="number"
    inputmode="numeric"
    min="1"
    :max="MAX_PARTICIPANT_LIMIT"
    step="1"
    required
  />
</template>
