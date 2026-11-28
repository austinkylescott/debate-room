// Whether the person asked for less motion (hard rule 6). Read at setup, so SMIL
// animations are never added for them, not even for a frame.
import type { Ref } from "vue";
import { useMediaQuery } from "./mediaQuery";

export function usePrefersReducedMotion(): Ref<boolean> {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
