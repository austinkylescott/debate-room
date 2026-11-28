// Whether a media query matches, kept up to date. Read at setup, so the first render
// already uses it: no SMIL for a frame under reduced motion, no popover flash on a phone.
import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref } from "vue";

export function useMediaQuery(query: string): Ref<boolean> {
  const list = typeof window === "undefined" ? undefined : window.matchMedia?.(query);
  const matches = ref(list?.matches ?? false);
  const update = () => (matches.value = list?.matches ?? false);
  list?.addEventListener("change", update);
  onBeforeUnmount(() => list?.removeEventListener("change", update));
  return matches;
}

/** Menu.md: menus open as a popover, and as a bottom sheet under 420px. */
export function useMenuPresentation(): ComputedRef<"sheet" | "popover"> {
  const narrow = useMediaQuery("(max-width: 419.98px)");
  return computed(() => (narrow.value ? "sheet" : "popover"));
}
