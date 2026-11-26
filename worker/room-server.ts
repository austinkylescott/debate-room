// The Durable Object adapter for one Room (docs/adr/0002). It holds no Room
// rules: it maps connections to actors, persists state and the Recap, sends
// each connection its own view, and maps the Room's timers to an alarm. All
// Room rules live in src/room/room.ts.
import { type Connection, type ConnectionContext, Server, type WSMessage } from "partyserver";
import {
  type Actor,
  apply,
  type ApplyResult,
  createRoom,
  type CreateRoomInput,
  parseIntent,
  type RecapEvent,
  type Rejection,
  type RoomState,
  tick,
  upgradeState,
  viewFor,
} from "../src/room/room";
import type { ServerMessage } from "../src/room/protocol";

const STATE_KEY = "room";
const RECAP_KEY = "recap";

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState | null = null;

  async onStart() {
    const stored = await this.ctx.storage.get<RoomState>(STATE_KEY);
    this.#state = stored ? upgradeState(stored) : null;
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
    sendView(connection, this.#state, { token });
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
    await this.#settle(result);
  }

  /** A timer the Room asked for is due. */
  async onAlarm() {
    if (!this.#state) return;
    await this.#settle(tick(this.#state, Date.now()));
  }

  /** Saves and broadcasts a change, and points the alarm at the Room's next timer. */
  async #settle(result: ApplyResult) {
    if (result.state !== this.#state) {
      await this.#save(result.state, result.recapEvents);
      this.#broadcastViews();
    }
    if (result.scheduled === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(result.scheduled);
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
      if (connection.state) sendView(connection, state, connection.state);
    }
  }
}

/** Sends the connection its view. A device the Host removed is told, then disconnected. */
function sendView(connection: Connection, state: RoomState, actor: Actor) {
  const view = viewFor(state, actor);
  send(connection, { type: "view", view });
  if (view.you.role === "removed") connection.close(4403, "Removed by the Host");
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
