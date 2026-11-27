// The Packs a Host can browse when choosing Prompts: the Featured Packs that
// ship with the app, plus dummy Packs in development.
import type { Format } from "../room/lineup";
import { DUMMY_PACKS } from "./dummy-packs";
import { FEATURED_PACKS } from "./featured-packs";

export type Intensity = "chill" | "spicy";

export const INTENSITY_NAMES: Record<Intensity, string> = { chill: "Chill", spicy: "Spicy" };

export interface PackPrompt {
  text: string;
  /** The Formats this Prompt works well in. */
  formats: Format[];
}

export interface Pack {
  id: string;
  title: string;
  topic: string;
  intensity: Intensity;
  /** Suggested Sides for a Middle Ground Round built from this Pack. */
  sides?: [string, string];
  prompts: PackPrompt[];
}

/** The Packs on offer: the Featured Packs, followed in development by the dummy Packs. */
export function packsFor({ dev }: { dev: boolean }): Pack[] {
  return dev ? [...FEATURED_PACKS, ...DUMMY_PACKS] : FEATURED_PACKS;
}

export interface TopicPacks {
  topic: string;
  packs: Pack[];
}

/**
 * Packs grouped by Topic, Topics in the order they first appear, keeping only
 * the Packs of one Intensity unless it is "any".
 */
export function packsByTopic(packs: Pack[], intensity: Intensity | "any" = "any"): TopicPacks[] {
  const groups = new Map<string, Pack[]>();
  for (const pack of packs) {
    if (intensity !== "any" && pack.intensity !== intensity) continue;
    groups.set(pack.topic, [...(groups.get(pack.topic) ?? []), pack]);
  }
  return [...groups].map(([topic, packs]) => ({ topic, packs }));
}

export interface PackChoiceGroup {
  type: "group";
  label: string;
  items: { value: string; label: string }[];
}

/** Packs grouped by Topic as choices for a list, each named with its Intensity. */
export function packChoices(groups: TopicPacks[]): PackChoiceGroup[] {
  return groups.map(({ topic, packs }) => ({
    type: "group",
    label: topic,
    items: packs.map((p) => ({
      value: p.id,
      label: `${p.title} · ${INTENSITY_NAMES[p.intensity]}`,
    })),
  }));
}

// Spelled out so a production build drops the dummy Packs entirely.
export const PACKS: Pack[] = import.meta.env.DEV ? packsFor({ dev: true }) : FEATURED_PACKS;
