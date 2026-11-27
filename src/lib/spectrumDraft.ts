import { type Ref, ref, watch } from "vue";
import { SPECTRUM_MAX, SPECTRUM_MIN, type SpectrumView } from "../room/spectrum";

/** The parts of a Spectrum Stage view your own slider starts from. */
export interface SpectrumDraftSource {
  prompt: { id: string };
  spectrum: Pick<SpectrumView, "step" | "yours">;
}

const MIDPOINT = (SPECTRUM_MIN + SPECTRUM_MAX) / 2;

/**
 * Where your own slider is, which runs ahead of the Room's copy while you drag.
 * A new Prompt (or step) starts it again from where the Room has you.
 */
export function useSpectrumDraft(stage: () => SpectrumDraftSource): Ref<number> {
  const fromRoom = () => stage().spectrum.yours?.position ?? MIDPOINT;
  const draft = ref(fromRoom());
  // Two sources compared by value, not one getter returning a fresh array:
  // that would fire on every view, so on anyone's move, snapping the slider back.
  watch([() => stage().prompt.id, () => stage().spectrum.step], () => {
    draft.value = fromRoom();
  });
  return draft;
}
