// Whether the person asked for less motion (hard rule 6). Read at setup, so SMIL
// animations are never added for them, not even for a frame.
import { onBeforeUnmount, ref, type Ref } from "vue";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): Ref<boolean> {
  const query = typeof window === "undefined" ? undefined : window.matchMedia?.(QUERY);
  const reduce = ref(query?.matches ?? false);
  const update = () => (reduce.value = query?.matches ?? false);
  query?.addEventListener("change", update);
  onBeforeUnmount(() => query?.removeEventListener("change", update));
  return reduce;
}
