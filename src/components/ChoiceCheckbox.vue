<script setup lang="ts">
// A checkbox choice row (docs/design/components/Field.md): the whole row is the target and
// the box sits right beside its label. Attributes (v-model:checked, value, disabled) go to
// UI SDK's Checkbox; the hint describes it instead of joining its name.
import { Checkbox, CheckboxIndicator } from "@ui-sdk/vue/checkbox";
import { useId } from "vue";

defineOptions({ inheritAttrs: false });
defineProps<{ inline?: boolean }>();
defineSlots<{ default(): unknown; hint?(): unknown }>();

const id = useId();
</script>

<template>
  <label class="choice" :class="{ 'choice--inline': inline }">
    <Checkbox
      v-bind="$attrs"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="$slots.hint ? `${id}-hint` : undefined"
    >
      <CheckboxIndicator>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" /></svg>
      </CheckboxIndicator>
    </Checkbox>
    <span class="choice__text">
      <span :id="`${id}-label`"><slot /></span>
      <span v-if="$slots.hint" :id="`${id}-hint`" class="choice__hint"><slot name="hint" /></span>
    </span>
  </label>
</template>
