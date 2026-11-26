// The Durable Object adapter for one Room (docs/adr/0002). It holds no Room
// rules: it maps connections to actors, persists state and the Recap, sends
// each connection its own view and the Recap stream if it may see it, and maps
// the Room's timers (expiry included) to its single alarm. All Room rules live
// in src/room/room.ts.
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
import type { ServerMessage, StampedServerMessage } from "../src/room/protocol";

const STATE_KEY = "room";
const RECAP_KEY = "recap";

/** What the Room keeps per connection. */
interface ConnectionState extends Actor {
  /** Whether this connection has been sent the whole Recap, so only new events follow. */
  hasRecap?: boolean;
}

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState | null = null;
  #recap: RecapEvent[] = [];

  async onStart() {
    const stored = await this.ctx.storage.get<RoomState>(STATE_KEY);
    if (!stored) return;
    this.#state = upgradeState(stored, Date.now());
    this.#recap = (await this.ctx.storage.get<RecapEvent[]>(RECAP_KEY)) ?? [];
    // A Room stored before expiry existed has no alarm yet: start its clock.
    if ((await this.ctx.storage.getAlarm()) === null)
      await this.#settle(tick(this.#state, Date.now()));
  }

  /** Called once by the Worker when a Host creates the Room. */
  async create(input: CreateRoomInput): Promise<Rejection | null> {
    if (this.#state) throw new Error("Room already exists");
    const created = createRoom(input, Date.now());
    if ("rejection" in created) return created.rejection;
    await this.#save(created.state, []);
    await this.ctx.storage.setAlarm(created.scheduled);
    return null;
  }

  onConnect(connection: Connection<ConnectionState>, ctx: ConnectionContext) {
    const token = new URL(ctx.request.url).searchParams.get("token");
    if (!this.#state || !token) {
      send(connection, { type: "missing" });
      connection.close(4404, "Room not found");
      return;
    }
    connection.setState({ token });
    this.#update(connection, []);
  }

  async onMessage(connection: Connection<ConnectionState>, message: WSMessage) {
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

  /** A timer the Room asked for is due, or the Room has expired. */
  async onAlarm() {
    if (!this.#state) return;
    await this.#settle(tick(this.#state, Date.now()));
  }

  /** Saves and broadcasts a change, and points the alarm at the Room's next due time. */
  async #settle(result: ApplyResult) {
    if (result.gone) return this.#discard(result.gone);
    if (result.state !== this.#state) {
      await this.#save(result.state, result.recapEvents);
      for (const connection of this.getConnections<ConnectionState>()) {
        this.#update(connection, result.recapEvents);
      }
    }
    if (result.scheduled === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(result.scheduled);
  }

  /** The Room is gone (expired or cancelled), Recap and all: everyone connected is told so. */
  async #discard(why: "expired" | "cancelled") {
    this.#state = null;
    this.#recap = [];
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const connection of this.getConnections()) {
      send(connection, { type: "missing" });
      connection.close(4404, why === "expired" ? "Room expired" : "Room cancelled");
    }
  }

  async #save(state: RoomState, recapEvents: RecapEvent[]) {
    this.#state = state;
    await this.ctx.storage.put(STATE_KEY, state);
    if (recapEvents.length > 0) {
      this.#recap = [...this.#recap, ...recapEvents];
      await this.ctx.storage.put(RECAP_KEY, this.#recap);
    }
  }

  /**
   * Sends a connection its view and, if it may see the Recap, the Recap: the
   * whole of it the first time, then only `added` events.
   */
  #update(connection: Connection<ConnectionState>, added: RecapEvent[]) {
    const state = this.#state;
    const actor = connection.state;
    if (!state || !actor) return;
    const view = viewFor(state, actor);
    send(connection, { type: "view", view });
    if (view.you.role === "removed") {
      connection.close(4403, "Removed by the Host");
      return;
    }
    if (!view.seesRecap) {
      if (actor.hasRecap) connection.setState({ token: actor.token });
    } else if (!actor.hasRecap) {
      send(connection, { type: "recap", events: this.#recap });
      connection.setState({ token: actor.token, hasRecap: true });
    } else if (added.length > 0) {
      send(connection, { type: "recap-added", events: added });
    }
  }
}

/** Every message carries the server's time, which devices draw countdowns from. */
function send(connection: Connection, message: ServerMessage) {
  const stamped: StampedServerMessage = { ...message, serverTime: Date.now() };
  connection.send(JSON.stringify(stamped));
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
