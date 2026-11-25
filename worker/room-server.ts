// The Durable Object adapter for one Room (docs/adr/0002). It holds no Room
// rules: it maps connections to actors, persists state and the Recap, and sends
// each connection its own view. All Room rules live in src/room/room.ts.
import { type Connection, type ConnectionContext, Server, type WSMessage } from "partyserver";
import {
  type Actor,
  apply,
  createRoom,
  type CreateRoomInput,
  parseIntent,
  type RecapEvent,
  type Rejection,
  type RoomState,
  viewFor,
} from "../src/room/room";
import type { ServerMessage } from "../src/room/protocol";

const STATE_KEY = "room";
const RECAP_KEY = "recap";

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState | null = null;

  async onStart() {
    this.#state = (await this.ctx.storage.get<RoomState>(STATE_KEY)) ?? null;
  }

  /** Called once by the Worker when a Host creates the Room. */
  async create(input: CreateRoomInput): Promise<Rejection | null> {
    if (this.#state) throw new Error("Room already exists");
    const created = createRoom(input);
    if ("rejection" in created) return created.rejection;
    await this.#save(created.state, []);
    return null;
  }

  onConnect(connection: Connection<Actor>, ctx: ConnectionContext) {
    const token = new URL(ctx.request.url).searchParams.get("token");
    if (!this.#state || !token) {
      send(connection, { type: "missing" });
      connection.close(4404, "Room not found");
      return;
    }
    connection.setState({ token });
    send(connection, { type: "view", view: viewFor(this.#state, { token }) });
  }

  async onMessage(connection: Connection<Actor>, message: WSMessage) {
    const actor = connection.state;
    if (!this.#state || !actor || typeof message !== "string") return;
    const intent = parseIntent(safeJsonParse(message));
    if (!intent) return;

    const result = apply(this.#state, intent, { token: actor.token }, Date.now());
    if (result.rejection) {
      send(connection, { type: "rejected", rejection: result.rejection });
    }
    if (result.state !== this.#state) {
      await this.#save(result.state, result.recapEvents);
      this.#broadcastViews();
    }
  }

  async #save(state: RoomState, recapEvents: RecapEvent[]) {
    this.#state = state;
    await this.ctx.storage.put(STATE_KEY, state);
    if (recapEvents.length > 0) {
      const recap = (await this.ctx.storage.get<RecapEvent[]>(RECAP_KEY)) ?? [];
      await this.ctx.storage.put(RECAP_KEY, [...recap, ...recapEvents]);
    }
  }

  #broadcastViews() {
    const state = this.#state;
    if (!state) return;
    for (const connection of this.getConnections<Actor>()) {
      if (connection.state) {
        send(connection, { type: "view", view: viewFor(state, connection.state) });
      }
    }
  }
}

function send(connection: Connection, message: ServerMessage) {
  connection.send(JSON.stringify(message));
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
