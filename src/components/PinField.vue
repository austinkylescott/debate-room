<script setup lang="ts">
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "../room/room";
import TextField from "./TextField.vue";

withDefaults(defineProps<{ label?: string; help?: string; error?: string | null }>(), {
  label: "Host PIN",
});
const pin = defineModel<string>({ required: true });
</script>

<template>
  <TextField
    v-model="pin"
    :label="label"
    :help="help"
    :error="error"
    type="password"
    inputmode="numeric"
    autocomplete="off"
    :pattern="`[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}`"
    :minlength="PIN_MIN_LENGTH"
    :maxlength="PIN_MAX_LENGTH"
    :title="`${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`"
    required
  />
</template>
