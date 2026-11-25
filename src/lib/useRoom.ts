// Connects to one Room's Durable Object and keeps this device's view of it.
import PartySocket from "partysocket";
import { onBeforeUnmount, ref, shallowRef } from "vue";
import { PARTY_NAME, PARTY_PREFIX, type ServerMessage } from "../room/protocol";
import type { Intent, Rejection, View } from "../room/room";
import { deviceToken, forgetHostSecret, savedHostSecret } from "./device";

export type ConnectionStatus = "connecting" | "open" | "missing";

export function useRoom(roomId: string) {
  const view = shallowRef<View | null>(null);
  const rejection = shallowRef<Rejection | null>(null);
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
    if (status.value !== "missing") status.value = "connecting";
  });

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as ServerMessage;
    switch (message.type) {
      case "view":
        view.value = message.view;
        break;
      case "rejected":
        if (message.rejection.code === "wrong-host-secret") forgetHostSecret(roomId);
        rejection.value = message.rejection;
        break;
      case "missing":
        status.value = "missing";
        socket.close();
        break;
    }
  });

  onBeforeUnmount(() => socket.close());

  return { view, rejection, status, send };
}
