// Sets up Rooms for the gauntlet without clicking through the UI: the Host and
// everyone else are "bots", plain WebSocket clients that speak the Room protocol
// (src/room/protocol.ts) from the test process. A browser page then opens the
// Room as one of them (./browser.ts), so the page shows that person's real view.
import type { RoundSetup } from "../../../src/room/lineup.ts";
import type { CreateRoomResponse, StampedServerMessage } from "../../../src/room/protocol.ts";
import type { Intent, JoinRole, Rejection, View } from "../../../src/room/room.ts";

const WAIT_MS = 5_000;

/** One connection to a Room, as one device. */
export class Bot {
  view: View | null = null;
  rejections: Rejection[] = [];
  /** The device token: open a page with it to be this same person. */
  readonly token: string;
  private readonly socket: WebSocket;
  private listeners = new Set<() => void>();

  private constructor(socket: WebSocket, token: string) {
    this.socket = socket;
    this.token = token;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as StampedServerMessage;
      if (message.type === "view") this.view = message.view;
      if (message.type === "rejected") this.rejections.push(message.rejection);
      for (const listener of this.listeners) listener();
    });
  }

  static async connect(baseURL: string, roomId: string, hostSecret?: string): Promise<Bot> {
    const token = crypto.randomUUID();
    const url = new URL(`/api/parties/room/${roomId}`, baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Couldn't connect to ${url}`)), {
        once: true,
      });
    });
    const bot = new Bot(socket, token);
    if (hostSecret) bot.send({ type: "claim-host", hostSecret });
    await bot.until((view) => (hostSecret ? view.you.role === "host" : true));
    return bot;
  }

  get personId(): string {
    const you = this.view?.you;
    if (!you || !("personId" in you)) throw new Error("This bot hasn't joined the Room");
    return you.personId;
  }

  send(intent: Intent) {
    this.socket.send(JSON.stringify(intent));
  }

  /** Waits until this bot's view passes `ready`; fails on a rejection or after a few seconds. */
  until(ready: (view: View) => boolean, what = "the expected view"): Promise<View> {
    const rejectedBefore = this.rejections.length;
    return new Promise((resolve, reject) => {
      const check = () => {
        const rejection = this.rejections[rejectedBefore];
        if (rejection) {
          done();
          reject(new Error(`Rejected while waiting for ${what}: ${rejection.message}`));
        } else if (this.view && ready(this.view)) {
          done();
          resolve(this.view);
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`Timed out waiting for ${what}`));
      }, WAIT_MS);
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
      };
      this.listeners.add(check);
      check();
    });
  }

  /** Sends an intent and waits for the view it should lead to. */
  async act(intent: Intent, ready: (view: View) => boolean): Promise<View> {
    const next = this.until(ready, intent.type);
    this.send(intent);
    return next;
  }

  close() {
    this.socket.close();
  }
}

export interface TestRoom {
  id: string;
  hostSecret: string;
  baseURL: string;
  host: Bot;
  /** Everyone who joined through {@link join}, by nickname. */
  people: Map<string, Bot>;
  close(): void;
}

export interface CreateOptions {
  hostNickname?: string;
  participantLimit?: number;
  /** Open the Room (Live) straight away. Default true; false leaves it in Planning. */
  open?: boolean;
}

/** Creates a Room as its Host, through the same API the Home page uses. */
export async function createRoom(baseURL: string, options: CreateOptions = {}): Promise<TestRoom> {
  const response = await fetch(new URL("/api/rooms", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hostNickname: options.hostNickname ?? "Host",
      pin: "1234",
      participantLimit: options.participantLimit ?? 50,
    }),
  });
  const result = (await response.json()) as CreateRoomResponse;
  if (!result.ok) throw new Error(`Couldn't create a Room: ${result.message}`);
  const host = await Bot.connect(baseURL, result.roomId, result.hostSecret);
  if (options.open ?? true) {
    await host.act({ type: "open-room" }, (view) => view.phase === "live");
  }
  const people = new Map<string, Bot>();
  return {
    id: result.roomId,
    hostSecret: result.hostSecret,
    baseURL,
    host,
    people,
    close() {
      host.close();
      for (const bot of people.values()) bot.close();
    },
  };
}

/** Joins one person per nickname, as Participants unless `as` says Spectators. */
export async function join(
  room: TestRoom,
  nicknames: string[],
  as: JoinRole = "participant",
): Promise<Bot[]> {
  const bots: Bot[] = [];
  // In order, so the Waiting Room lists them in the order given.
  for (const nickname of nicknames) {
    const bot = await Bot.connect(room.baseURL, room.id);
    await bot.act({ type: "join", nickname, as }, (view) => view.you.role === as);
    room.people.set(nickname, bot);
    bots.push(bot);
  }
  return bots;
}

/** Adds a Round to the end of the Lineup. */
export async function planRound(room: TestRoom, setup: RoundSetup, prompts: string[]) {
  const before = room.host.view?.lineup?.length ?? 0;
  await room.host.act(
    { type: "add-round", setup, prompts: prompts.map((text) => ({ text, surprise: false })) },
    (view) => (view.lineup?.length ?? 0) > before,
  );
}

export const DEFAULT_PROMPTS = ["Pineapple belongs on pizza", "Cats are better than dogs"];

export type RoundStart =
  | { format: "spectrum" }
  | { format: "middle-ground"; sides?: [string, string] }
  | { format: "surrounded"; centerId?: string | null; exchangeSeconds?: number };

/**
 * Plans a Round in the given Format and starts it, as the Host. Everyone who
 * joined as a Participant is Playing; the Host is Playing only if `hostPlaying`.
 */
export async function startRound(
  room: TestRoom,
  round: RoundStart,
  { hostPlaying = false, prompts = DEFAULT_PROMPTS } = {},
) {
  const setup: RoundSetup =
    round.format === "spectrum"
      ? { format: "spectrum" }
      : round.format === "middle-ground"
        ? { format: "middle-ground", sides: round.sides ?? ["Cat people", "Dog people"] }
        : {
            format: "surrounded",
            centerId: round.centerId ?? null,
            exchangeSeconds: round.exchangeSeconds ?? 90,
          };
  await planRound(room, setup, prompts);
  await room.host.act(
    { type: "start-round", hostPlaying },
    (view) => view.stage?.format === round.format,
  );
  // Let everyone else's view catch up, so a page opened next sees the Round.
  await Promise.all(
    [...room.people.values()].map((bot) =>
      bot.until((view) => view.stage?.format === round.format, "the Round to start"),
    ),
  );
}

/** `count` distinct nicknames of exactly 20 characters, the longest allowed. Some have no spaces. */
export function longNames(count: number): string[] {
  const stems = [
    "Bartholomew Fitzwick",
    "Maximilianaxolotlton",
    "Persephone Clearwate",
    "Konstantinopolitanus",
    "Guinevere Wollstonec",
    "Alexandria Montgomer",
    "Supercalifragilistic",
    "Christopher Pemberto",
    "Wilhelmina Thistlewo",
    "Abernathyquillfeathe",
    "Evangeline Rutherfor",
    "Octaviana Bellweathe",
    "Thelonious Archibald",
    "Cornelius Quillsbury",
    "Rumpelstiltskinsonne",
  ];
  return Array.from({ length: count }, (_, i) => {
    const stem = stems[i % stems.length];
    const name = i < stems.length ? stem : `${stem.slice(0, 17)} ${String(i).padStart(2, "0")}`;
    return name.slice(0, 20).padEnd(20, "x");
  });
}

/** The crowd test's Room (gauntlet 1): `count` Participants with 20-character names. */
export async function crowd(baseURL: string, count = 15) {
  const room = await createRoom(baseURL, { hostNickname: "Robin" });
  const names = longNames(count);
  const people = await join(room, names);
  return { room, names, people };
}

/**
 * The crowd test on the Spectrum: everyone in the crowd locks in on one notch,
 * which reveals the positions. The Host isn't Playing.
 */
export async function crowdOnOneNotch(baseURL: string, count = 15, notch = 50) {
  const { room, names, people } = await crowd(baseURL, count);
  await startRound(room, { format: "spectrum" });
  for (const bot of people) bot.send({ type: "lock-in", position: notch });
  await Promise.all(
    people.map((bot) =>
      bot.until(
        (view) => view.stage?.format === "spectrum" && view.stage.spectrum.step === "revealed",
        "the reveal",
      ),
    ),
  );
  return { room, names, people };
}
