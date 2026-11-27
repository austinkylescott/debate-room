<script setup lang="ts">
import { NICKNAME_MAX_LENGTH } from "../room/room";
import TextField from "./TextField.vue";

defineProps<{ error?: string | null }>();
const nickname = defineModel<string>({ required: true });
</script>

<template>
  <TextField
    v-model="nickname"
    label="Your nickname"
    :counter="`${nickname.length}/${NICKNAME_MAX_LENGTH}`"
    :error="error"
    autocomplete="nickname"
    :maxlength="NICKNAME_MAX_LENGTH"
    required
  />
</template>
