<script setup lang="ts">
import { ref } from "vue";

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
  <label class="field">
    <span>{{ label }}</span>
    <span class="copy-row">
      <input :value="value" readonly @focus="($event.target as HTMLInputElement).select()" />
      <button type="button" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
    </span>
  </label>
</template>
