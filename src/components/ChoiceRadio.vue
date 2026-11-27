<script setup lang="ts">
// A radio choice row (docs/design/components/Field.md), for inside UI SDK's RadioGroup: the
// whole row is the target and the radio sits right beside its label. The hint describes the
// radio instead of joining its name.
import { Radio, RadioIndicator } from "@ui-sdk/vue/radio";
import { useId } from "vue";

defineProps<{ value: string; disabled?: boolean }>();
defineSlots<{ default(): unknown; hint?(): unknown }>();

const id = useId();
</script>

<template>
  <label class="choice">
    <Radio
      :value="value"
      :disabled="disabled"
      :aria-labelledby="`${id}-label`"
      :aria-describedby="$slots.hint ? `${id}-hint` : undefined"
    >
      <RadioIndicator />
    </Radio>
    <span class="choice__text">
      <span :id="`${id}-label`"><slot /></span>
      <span v-if="$slots.hint" :id="`${id}-hint`" class="choice__hint"><slot name="hint" /></span>
    </span>
  </label>
</template>
