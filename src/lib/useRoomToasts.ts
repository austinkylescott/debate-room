// Shows the Room's toasts as its views and connection change. Returns the
// Room's `send`, wrapped so a change you make is confirmed once it lands.
import { onBeforeUnmount, watch } from "vue";
import { isLineupIntent } from "../room/lineup";
import type { Intent } from "../room/room";
import { changeToasts, connectionToast, savedToast } from "./roomToasts";
import { showToast, toaster } from "./toasts";
import type { useRoom } from "./useRoom";

export function useRoomToasts(room: ReturnType<typeof useRoom>) {
  let saving: "lineup" | "settings" | null = null;

  watch(room.view, (after, before) => {
    if (!after) return;
    for (const toast of changeToasts(before, after)) showToast(toast);
    const saved = saving && before ? savedToast(saving, before, after) : null;
    if (saved) {
      showToast(saved);
      saving = null;
    }
  });

  watch(room.rejection, (rejection) => {
    if (rejection) saving = null;
  });

  watch(room.status, (after, before) => {
    const toast = connectionToast(before, after);
    if (toast) showToast(toast, { retry: room.reconnect });
  });

  onBeforeUnmount(() => toaster.dismiss());

  return function send(intent: Intent) {
    if (isLineupIntent(intent)) saving = "lineup";
    else if (intent.type === "set-participant-limit") saving = "settings";
    room.send(intent);
  };
}
