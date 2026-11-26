<script setup lang="ts">
// A Spectrum Prompt's summary card: how many people were nearest each notch
// when they locked in, and at the end. Shown on the Stage and in the Recap.
import { computed } from "vue";
import { type Distribution, SPECTRUM_NOTCHES } from "../room/spectrum";

const props = defineProps<{ before: Distribution; after: Distribution }>();

const max = computed(() => Math.max(1, ...props.before, ...props.after));
const width = (count: number) => `${(count / max.value) * 75}%`;
</script>

<template>
  <table class="summary">
    <thead>
      <tr>
        <th scope="col" />
        <th scope="col">Locked in</th>
        <th scope="col">At the end</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(notch, i) in SPECTRUM_NOTCHES" :key="notch.value">
        <th scope="row">{{ notch.label }}</th>
        <td>
          <span class="bar" :style="{ width: width(before[i]!) }" />
          {{ before[i] }}
        </td>
        <td>
          <span class="bar after" :style="{ width: width(after[i]!) }" />
          {{ after[i] }}
        </td>
      </tr>
    </tbody>
  </table>
</template>
