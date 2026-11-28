<script setup lang="ts">
// A labelled select (docs/design/components/Menu.md): a .dr-select button that opens a
// .dr-menu listbox, the chosen option marked with a small ink sparkle. UI SDK's Select
// does the behaviour; it flips to stay in view, and opens as a bottom sheet under 420px.
// For a select that only triggers an action (pick someone, then it resets), bind
// `:model-value="null"` and handle `@update:model-value`.
import { Field, FieldLabel } from "@ui-sdk/vue/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/vue/select";
import { computed } from "vue";
import { SHAPES } from "../design/shapes";
import { useMenuPresentation } from "../lib/mediaQuery";
import type { SelectOption, SelectOptionGroup } from "../lib/selectOptions";

const props = defineProps<{
  label: string;
  options: (SelectOption | SelectOptionGroup)[];
  placeholder?: string;
}>();
const model = defineModel<string | null>({ required: true });

const presentation = useMenuPresentation();
const isGroup = (entry: SelectOption | SelectOptionGroup): entry is SelectOptionGroup =>
  "group" in entry;
// On the root too, so the trigger shows the chosen label while the list is closed.
const items = computed(() =>
  props.options.map((entry) =>
    isGroup(entry)
      ? {
          type: "group" as const,
          label: entry.group,
          items: entry.options.map(({ value, label, disabled }) => ({ value, label, disabled })),
        }
      : { value: entry.value, label: entry.label, disabled: entry.disabled },
  ),
);

function onChange(value: unknown) {
  model.value = typeof value === "string" ? value : null;
}
</script>

<template>
  <Field class="field">
    <FieldLabel class="field__label">{{ label }}</FieldLabel>
    <Select
      :value="model"
      :items="items"
      :placeholder="placeholder"
      :presentation="presentation"
      @value-change="onChange"
    >
      <SelectTrigger class="dr-select">
        <SelectValue class="dr-select__value" />
        <svg class="dr-select__chevron" viewBox="0 0 18 18" aria-hidden="true">
          <path d="M4,7 L9,12 L14,7" />
        </svg>
      </SelectTrigger>
      <SelectContent class="dr-menu">
        <template v-for="entry in options" :key="isGroup(entry) ? `g:${entry.group}` : entry.value">
          <SelectGroup v-if="isGroup(entry)" class="dr-menu__group">
            <SelectGroupLabel class="dr-menu__group-label">{{ entry.group }}</SelectGroupLabel>
            <SelectItem
              v-for="option in entry.options"
              :key="option.value"
              class="dr-menu__item"
              :value="option.value"
              :disabled="option.disabled"
            >
              <SelectItemText>{{ option.label }}</SelectItemText>
              <SelectItemIndicator class="dr-menu__check">
                <svg viewBox="-50 -50 100 100" aria-hidden="true"><path :d="SHAPES.sparkle" /></svg>
              </SelectItemIndicator>
            </SelectItem>
          </SelectGroup>
          <SelectItem v-else class="dr-menu__item" :value="entry.value" :disabled="entry.disabled">
            <SelectItemText>{{ entry.label }}</SelectItemText>
            <SelectItemIndicator class="dr-menu__check">
              <svg viewBox="-50 -50 100 100" aria-hidden="true"><path :d="SHAPES.sparkle" /></svg>
            </SelectItemIndicator>
          </SelectItem>
        </template>
      </SelectContent>
    </Select>
  </Field>
</template>
