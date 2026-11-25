<script setup lang="ts">
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "../room/room";

withDefaults(defineProps<{ label?: string }>(), { label: "Host PIN" });
const pin = defineModel<string>({ required: true });
</script>

<template>
  <label class="field">
    <span>{{ label }}</span>
    <input
      v-model="pin"
      type="password"
      inputmode="numeric"
      autocomplete="off"
      :pattern="`[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}`"
      :minlength="PIN_MIN_LENGTH"
      :maxlength="PIN_MAX_LENGTH"
      :title="`${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`"
      required
    />
  </label>
</template>
