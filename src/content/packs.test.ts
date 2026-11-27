// The shape of the Featured Pack data. The content itself is curated by hand;
// these tests only make sure every Pack can be browsed and played as the
// Lineup expects.
import { describe, expect, it } from "vite-plus/test";
import { FORMATS, PROMPT_MAX_LENGTH, SIDE_MAX_LENGTH } from "../room/lineup";
import { FEATURED_PACKS } from "./featured-packs";
import { type Pack, packChoices, packsByTopic, packsFor } from "./packs";

describe("Featured Packs", () => {
  it("covers six to eight Topics, each with one or two Packs", () => {
    const perTopic = new Map<string, number>();
    for (const pack of FEATURED_PACKS)
      perTopic.set(pack.topic, (perTopic.get(pack.topic) ?? 0) + 1);

    expect(perTopic.size).toBeGreaterThanOrEqual(6);
    expect(perTopic.size).toBeLessThanOrEqual(8);
    for (const count of perTopic.values()) expect([1, 2]).toContain(count);
  });

  it("mixes Chill and Spicy Packs, and tags every Pack with an Intensity", () => {
    const intensities = FEATURED_PACKS.map((pack) => pack.intensity);
    expect(new Set(intensities)).toEqual(new Set(["chill", "spicy"]));
  });

  it("gives every Pack about ten Prompts", () => {
    for (const pack of FEATURED_PACKS) {
      expect(pack.prompts.length, pack.id).toBeGreaterThanOrEqual(8);
      expect(pack.prompts.length, pack.id).toBeLessThanOrEqual(12);
    }
  });

  it("tags every Prompt with at least one Format it suits", () => {
    for (const prompt of FEATURED_PACKS.flatMap((pack) => pack.prompts)) {
      expect(prompt.formats.length, prompt.text).toBeGreaterThan(0);
      for (const format of prompt.formats) expect(FORMATS, prompt.text).toContain(format);
    }
  });

  it("phrases every Prompt as a statement that fits in a Round", () => {
    for (const { text } of FEATURED_PACKS.flatMap((pack) => pack.prompts)) {
      expect(text.trim(), text).toBe(text);
      expect(text.length, text).toBeGreaterThan(0);
      expect(text.length, text).toBeLessThanOrEqual(PROMPT_MAX_LENGTH);
      expect(text, text).not.toMatch(/[?.!]$/);
    }
  });

  it("suggests two distinct Sides for every Pack with Middle Ground Prompts", () => {
    for (const pack of FEATURED_PACKS) {
      if (!pack.prompts.some((p) => p.formats.includes("middle-ground"))) continue;
      expect(pack.sides, pack.id).toBeDefined();
      const [a, b] = pack.sides ?? ["", ""];
      expect(a, pack.id).not.toBe(b);
      for (const side of [a, b]) {
        expect(side.length, pack.id).toBeGreaterThan(0);
        expect(side.length, pack.id).toBeLessThanOrEqual(SIDE_MAX_LENGTH);
      }
    }
  });

  it("never repeats a Pack id or a Prompt within a Pack", () => {
    const ids = FEATURED_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const pack of FEATURED_PACKS) {
      const texts = pack.prompts.map((p) => p.text.toLowerCase());
      expect(new Set(texts).size, pack.id).toBe(texts.length);
    }
  });
});

describe("the Packs a Host can browse", () => {
  it("are only the Featured Packs outside development", () => {
    expect(packsFor({ dev: false })).toEqual(FEATURED_PACKS);
  });

  it("add the dummy Packs after the Featured Packs in development", () => {
    const packs = packsFor({ dev: true });
    expect(packs.slice(0, FEATURED_PACKS.length)).toEqual(FEATURED_PACKS);
    expect(packs.length).toBeGreaterThan(FEATURED_PACKS.length);
    for (const dummy of packs.slice(FEATURED_PACKS.length)) expect(dummy.title).toMatch(/dummy/);
  });
});

describe("the Pack choices, grouped by Topic", () => {
  const pack = (id: string, title: string, topic: string, intensity: Pack["intensity"]): Pack => ({
    id,
    title,
    topic,
    intensity,
    prompts: [],
  });
  const packs = [
    pack("pizza", "Kitchen Table Wars", "Food", "chill"),
    pack("ai", "Robots at Work", "Technology", "spicy"),
    pack("brunch", "Brunch Debates", "Food", "spicy"),
  ];

  it("names each Pack with its Intensity, under its Topic", () => {
    expect(packChoices(packsByTopic(packs))).toEqual([
      {
        type: "group",
        label: "Food",
        items: [
          { value: "pizza", label: "Kitchen Table Wars · Chill" },
          { value: "brunch", label: "Brunch Debates · Spicy" },
        ],
      },
      {
        type: "group",
        label: "Technology",
        items: [{ value: "ai", label: "Robots at Work · Spicy" }],
      },
    ]);
  });

  it("leaves out Topics the Intensity filter empties", () => {
    expect(packChoices(packsByTopic(packs, "chill")).map((group) => group.label)).toEqual(["Food"]);
  });
});
