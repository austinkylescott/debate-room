// The Pack options the Prompt picker and the whole-night shortcut list.
import { describe, expect, it } from "vite-plus/test";
import type { Pack } from "../content/packs";
import { packOptions } from "./selectOptions";

const pack = (id: string, topic: string, intensity: Pack["intensity"]) =>
  ({ id, title: id.toUpperCase(), topic, intensity, prompts: [] }) as unknown as Pack;

describe("packOptions", () => {
  it("lists each topic's Packs under it, with their intensity", () => {
    expect(
      packOptions([
        { topic: "Food", packs: [pack("a", "Food", "chill"), pack("b", "Food", "spicy")] },
      ]),
    ).toEqual([
      {
        group: "Food",
        options: [
          { value: "a", label: "A · Chill" },
          { value: "b", label: "B · Spicy" },
        ],
      },
    ]);
  });
});
