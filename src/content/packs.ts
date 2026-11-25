// Dummy Packs for checking the look and feel of Lineup planning. The real
// Featured Packs replace these later (issue #19); keep the shape.
import { type Format, FORMATS } from "../room/lineup";

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

const ALL = [...FORMATS];

export const PACKS: Pack[] = [
  {
    id: "dummy-food",
    title: "Kitchen Table Wars (dummy)",
    topic: "Food",
    intensity: "chill",
    sides: ["Sweet tooth", "Savoury fan"],
    prompts: [
      { text: "Pineapple belongs on pizza", formats: ALL },
      { text: "Breakfast is the best meal of the day", formats: ["spectrum", "middle-ground"] },
      { text: "Cereal is a soup", formats: ["spectrum", "surrounded"] },
      { text: "Tipping culture has gone too far", formats: ALL },
      { text: "A hot dog is a sandwich", formats: ["spectrum", "surrounded"] },
    ],
  },
  {
    id: "dummy-pop",
    title: "Screen Time (dummy)",
    topic: "Pop culture",
    intensity: "chill",
    sides: ["Book first", "Movie first"],
    prompts: [
      { text: "The book is always better than the film", formats: ALL },
      { text: "Spoilers don't ruin anything", formats: ["spectrum", "surrounded"] },
      { text: "Reality TV is an art form", formats: ["spectrum", "middle-ground"] },
      { text: "Sequels should be banned", formats: ["surrounded"] },
    ],
  },
  {
    id: "dummy-relationships",
    title: "Situationships (dummy)",
    topic: "Relationships",
    intensity: "chill",
    sides: ["Romantics", "Realists"],
    prompts: [
      { text: "You should split the bill on a first date", formats: ALL },
      { text: "Exes can be friends", formats: ["spectrum", "middle-ground"] },
      { text: "Sharing phone passwords is a red flag", formats: ["spectrum", "surrounded"] },
      { text: "Love at first sight is real", formats: ALL },
    ],
  },
  {
    id: "dummy-tech",
    title: "Logged In (dummy)",
    topic: "Technology",
    intensity: "spicy",
    sides: ["Early adopters", "Late adopters"],
    prompts: [
      { text: "Social media does more harm than good", formats: ALL },
      { text: "Kids under 13 shouldn't have smartphones", formats: ["spectrum", "middle-ground"] },
      { text: "AI art is real art", formats: ALL },
      { text: "Remote work is better than the office", formats: ["spectrum", "surrounded"] },
    ],
  },
];
