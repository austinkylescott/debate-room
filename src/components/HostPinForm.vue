<script setup lang="ts">
// Taking back Host control from the public invite link with the Host PIN.
import { ref } from "vue";
import PinField from "./PinField.vue";

defineProps<{ error: string | null }>();
const emit = defineEmits<{ submit: [pin: string]; back: [] }>();

const pin = ref("");

function submit() {
  emit("submit", pin.value);
  pin.value = "";
}
</script>

<template>
  <form class="stack" @submit.prevent="submit">
    <PinField v-model="pin" label="Your Host PIN" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button class="primary" type="submit">Continue as the Host</button>
    <button type="button" @click="emit('back')">Back</button>
  </form>
</template>
