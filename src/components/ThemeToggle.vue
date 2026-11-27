<script setup lang="ts">
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/vue/segmented-control";
import { ref } from "vue";
import { chooseTheme, isThemeChoice, savedTheme, THEME_CHOICES } from "../lib/theme";

function deviceStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const theme = ref(savedTheme(deviceStorage()));

function pick(value: string | null) {
  if (!isThemeChoice(value)) return;
  theme.value = value;
  chooseTheme(value, { storage: deviceStorage(), root: document.documentElement });
}
</script>

<template>
  <SegmentedControl class="theme-toggle" aria-label="Theme" :value="theme" @value-change="pick">
    <SegmentedControlIndicator />
    <SegmentedControlItem v-for="choice in THEME_CHOICES" :key="choice.value" :value="choice.value">
      {{ choice.label }}
    </SegmentedControlItem>
  </SegmentedControl>
</template>
