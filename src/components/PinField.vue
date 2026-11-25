<script setup lang="ts">
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
      pattern="[0-9]{4,6}"
      minlength="4"
      maxlength="6"
      title="4 to 6 digits"
      required
    />
  </label>
</template>
