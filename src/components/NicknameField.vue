<script setup lang="ts">
import { NICKNAME_MAX_LENGTH } from "../room/room";

const nickname = defineModel<string>({ required: true });
</script>

<template>
  <label class="field">
    <span>Your nickname</span>
    <input v-model="nickname" autocomplete="nickname" :maxlength="NICKNAME_MAX_LENGTH" required />
  </label>
</template>
