<script setup lang="ts">
// A labelled text input with help or an error under it (docs/design/components/Field.md).
// Attributes go to the <input>; the default slot sits beside it (CopyField's button).
import { computed, useId } from "vue";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  label: string;
  help?: string;
  counter?: string;
  /** What went wrong and what to do next. Replaces the help while it's shown. */
  error?: string | null;
}>();
const model = defineModel<string | number>();

const id = useId();
const helpId = `${id}-help`;
const errorId = `${id}-error`;
const hasHelp = computed(() => Boolean(props.help || props.counter));
const describedBy = computed(() => (props.error ? errorId : hasHelp.value ? helpId : undefined));
</script>

<template>
  <div class="field">
    <label class="field__label" :for="id">{{ label }}</label>
    <div class="field__control">
      <input
        :id="id"
        v-model="model"
        v-bind="$attrs"
        class="field__input"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
      />
      <slot />
    </div>
    <p v-if="error" :id="errorId" class="field__error" role="alert">{{ error }}</p>
    <p v-else-if="hasHelp" :id="helpId" class="field__help">
      <span>{{ help }}</span>
      <span v-if="counter" class="field__counter">{{ counter }}</span>
    </p>
  </div>
</template>
