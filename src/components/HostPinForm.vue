<script setup lang="ts">
// Taking back Host control from the public invite link with the Host PIN.
import { computed, ref } from "vue";
import { rejectedField } from "../lib/rejectedField";
import type { Rejection } from "../room/room";
import PinField from "./PinField.vue";

const props = defineProps<{ rejection: Rejection | null }>();
const emit = defineEmits<{ submit: [pin: string]; back: [] }>();

const pin = ref("");
const onPin = computed(() => rejectedField(props.rejection?.code) === "pin");

function submit() {
  emit("submit", pin.value);
  pin.value = "";
}
</script>

<template>
  <form class="stack" @submit.prevent="submit">
    <PinField v-model="pin" label="Your Host PIN" :error="onPin ? rejection?.message : null" />
    <p v-if="rejection && !onPin" class="error" role="alert">{{ rejection.message }}</p>
    <button class="primary" type="submit">Continue as the Host</button>
    <button type="button" @click="emit('back')">Back</button>
  </form>
</template>
