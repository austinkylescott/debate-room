<script setup lang="ts">
import { ref } from "vue";
import TextField from "./TextField.vue";

const props = defineProps<{ label: string; value: string }>();
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    copied.value = false;
  }
}
</script>

<template>
  <TextField
    :model-value="value"
    :label="label"
    readonly
    @focus="($event.target as HTMLInputElement).select()"
  >
    <button type="button" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
  </TextField>
</template>
