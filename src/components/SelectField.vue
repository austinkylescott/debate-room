<script setup lang="ts" generic="T extends string">
import {
  type ListData,
  Select,
  SelectContent,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/vue/select";

// A labelled choice from a popup list, always holding one of its items.
defineProps<{ label: string; items: ListData<T>; value: T }>();
const emit = defineEmits<{ change: [value: T] }>();

// The list reports null for "nothing chosen", which this field never is.
function change(value: T | null) {
  if (value !== null) emit("change", value);
}
</script>

<template>
  <div class="field">
    <Select :items="items" :value="value" @value-change="change">
      <SelectLabel>{{ label }}</SelectLabel>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent />
    </Select>
  </div>
</template>
