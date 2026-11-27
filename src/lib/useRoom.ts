// Connects to one Room's Durable Object and keeps this device's view of it.
import PartySocket from "partysocket";
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { PARTY_NAME, PARTY_PREFIX, type StampedServerMessage } from "../room/protocol";
import type { Intent, RecapEvent, Rejection, View } from "../room/room";
import { deviceToken, forgetHostSecret, savedHostSecret } from "./device";
import { serverClock } from "./serverClock";

/** "connecting" is the first connection; "reconnecting" follows a dropped one. */
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "missing" | "removed";

export function useRoom(roomId: string) {
  const view = shallowRef<View | null>(null);
  const rejection = shallowRef<Rejection | null>(null);
  /** The Recap's events, once this device may see it (see `View.seesRecap`). */
  const recap = shallowRef<RecapEvent[] | null>(null);
  const status = ref<ConnectionStatus>("connecting");

  const socket = new PartySocket({
    host: location.host,
    prefix: PARTY_PREFIX,
    party: PARTY_NAME,
    room: roomId,
    query: { token: deviceToken(roomId) },
  });

  function send(intent: Intent) {
    rejection.value = null;
    socket.send(JSON.stringify(intent));
  }

  socket.addEventListener("open", () => {
    status.value = "open";
    // Re-present the Host secret on every connect, so the Host is recognised
    // on this device even if its token was cleared.
    const hostSecret = savedHostSecret(roomId);
    if (hostSecret) socket.send(JSON.stringify({ type: "claim-host", hostSecret }));
  });

  socket.addEventListener("close", () => {
    if (status.value === "open") status.value = "reconnecting";
  });

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as StampedServerMessage;
    serverClock.observe(message.serverTime);
    switch (message.type) {
      case "view":
        view.value = message.view;
        if (!message.view.seesRecap) recap.value = null;
        // The Host removed this device: stop reconnecting.
        if (message.view.you.role === "removed") {
          status.value = "removed";
          socket.close();
        }
        break;
      case "rejected":
        if (message.rejection.code === "wrong-host-secret") forgetHostSecret(roomId);
        rejection.value = message.rejection;
        break;
      case "recap":
        recap.value = message.events;
        break;
      case "recap-added":
        recap.value = [...(recap.value ?? []), ...message.events];
        break;
      case "missing":
        status.value = "missing";
        socket.close();
        break;
    }
  });

  /** Tries again now, instead of waiting for the next automatic attempt. */
  function reconnect() {
    socket.reconnect();
  }

  onBeforeUnmount(() => socket.close());

  return { view, rejection, status, recap, send, reconnect };
}
