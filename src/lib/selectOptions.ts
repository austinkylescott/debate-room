// What SelectField.vue lists: options, optionally grouped, and the Pack lists two
// screens share (the Prompt picker and "a whole night of one Format").
import { INTENSITY_NAMES, type TopicPacks } from "../content/packs";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectOptionGroup {
  group: string;
  options: SelectOption[];
}

/** Packs under their topic, each as "Food Fights · Chill". */
export function packOptions(topics: TopicPacks[]): SelectOptionGroup[] {
  return topics.map(({ topic, packs }) => ({
    group: topic,
    options: packs.map((pack) => ({
      value: pack.id,
      label: `${pack.title} · ${INTENSITY_NAMES[pack.intensity]}`,
    })),
  }));
}
