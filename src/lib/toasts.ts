// The app's one toast queue, shown by ToastStack in App.vue (docs/design/components/Toast.md).
import { createToaster } from "@ui-sdk/vue/toast";
import type { RoomToast } from "./roomToasts";

/** What a toast's own rendering needs beyond its title. */
export interface ToastExtras {
  /** A person's name the title starts with: shown on one line, cut with an ellipsis. */
  name?: string;
  /** The close button's label. */
  close: string;
}

const SHOWS_FOR_MS = 5000;

export const toaster = createToaster({ duration: SHOWS_FOR_MS });

export function showToast(toast: RoomToast, { retry }: { retry?: () => void } = {}) {
  const extras: ToastExtras = { name: toast.name, close: toast.close ?? "Dismiss" };
  const retrying = toast.action === "retry" && retry;
  return toaster({
    id: toast.id,
    type: toast.type,
    title: toast.title,
    // Explicit, so a toast that replaces one that stayed (an error) gets its own timer.
    duration: toast.duration ?? SHOWS_FOR_MS,
    priority: toast.type === "error" ? "assertive" : "polite",
    // An error stays until it's resolved: only coming back replaces it.
    dismissible: toast.type !== "error",
    action: retrying ? { label: "Retry", onAction: retry, dismiss: false } : undefined,
    data: extras,
  });
}
