// Your own Spectrum slider, as the Room's views arrive. Each view the server
// sends is built afresh, so these tests hand over a new object every time.
import { describe, expect, it } from "vite-plus/test";
import { nextTick, shallowRef } from "vue";
import type { SpectrumStep } from "../room/spectrum";
import { type SpectrumDraftSource, useSpectrumDraft } from "./spectrumDraft";

/** A freshly built view of the Stage, as the server would send it. */
function view(promptId: string, step: SpectrumStep, position: number | null): SpectrumDraftSource {
  return {
    prompt: { id: promptId },
    spectrum: { step, yours: { position, lockedPosition: null } },
  };
}

function slider(first: SpectrumDraftSource) {
  const stage = shallowRef(first);
  const draft = useSpectrumDraft(() => stage.value);
  return {
    draft,
    receive: async (next: SpectrumDraftSource) => {
      stage.value = next;
      await nextTick();
    },
  };
}

describe("your Spectrum slider", () => {
  it("starts from where the Room has you, or the middle", () => {
    expect(slider(view("p1", "positioning", 30)).draft.value).toBe(30);
    expect(slider(view("p1", "positioning", null)).draft.value).toBe(50);
  });

  it("stays where you're dragging it when someone else moves", async () => {
    const { draft, receive } = slider(view("p1", "positioning", null));
    draft.value = 80;

    // Someone else moved: a new view of the same Prompt, still with the Room's older copy of you.
    await receive(view("p1", "positioning", null));
    await receive(view("p1", "positioning", 62));

    expect(draft.value).toBe(80);
  });

  it("starts again from the Room's copy on a new Prompt", async () => {
    const { draft, receive } = slider(view("p1", "revealed", 70));
    draft.value = 90;

    await receive(view("p2", "positioning", null));

    expect(draft.value).toBe(50);
  });

  it("picks up the Room's copy when the step changes", async () => {
    const { draft, receive } = slider(view("p1", "positioning", 40));
    draft.value = 45;

    await receive(view("p1", "revealed", 42));

    expect(draft.value).toBe(42);
  });
});
