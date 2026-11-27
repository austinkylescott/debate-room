// The screens the gauntlet runs every per-screen check on (screens.gauntlet.ts).
// Each one sets up a Room if it needs one and opens the page as the person whose
// view it is. A component issue that brings a new screen adds it here.
import { expect, type Page } from "@playwright/test";
import { openHome, openRoom } from "./browser.ts";
import type { CheckName } from "./gauntlet.ts";
import {
  createRoom,
  crowd,
  crowdOnOneNotch,
  join,
  planRound,
  startRound,
  type TestRoom,
} from "./room.ts";

export interface Opened {
  /** The Room to close afterwards, if the screen made one. */
  room: TestRoom | null;
  /** The person names on the screen, for the names check. */
  names: string[];
}

export interface Screen {
  name: string;
  open(page: Page, baseURL: string): Promise<Opened>;
  /**
   * Checks this screen's not-yet-redesigned parts still fail. They look only at
   * the redesigned elements (../redesigned.ts) until the whole screen passes;
   * then the issue that got it there deletes the entry. Never add one to make
   * a redesigned element pass.
   */
  redesignedOnly: CheckName[];
}

/** Checks no screen passes as a whole yet: every control and name label is still the old one. */
const NOT_YET: CheckName[] = ["targets", "names"];

/** A Waiting Room with a few people in it and a Round planned. */
async function waitingRoom(baseURL: string) {
  const room = await createRoom(baseURL, { hostNickname: "Robin" });
  await join(room, ["Ada", "Grace Hopper", "Linus"]);
  await join(room, ["Margaret"], "spectator");
  await planRound(room, { format: "spectrum" }, ["Pineapple belongs on pizza"]);
  return room;
}
const WAITING_ROOM_NAMES = ["Robin", "Ada", "Grace Hopper", "Linus", "Margaret"];

/**
 * Lets the page's WebSocket to the Room be dropped on cue, and kept down, so
 * the page shows itself reconnecting. Call before opening the page.
 */
async function droppableConnection(page: Page) {
  let online = true;
  const sockets: { close(): Promise<void> }[] = [];
  await page.routeWebSocket(/\/api\/parties\//, (ws) => {
    if (!online) return void ws.close();
    ws.connectToServer();
    sockets.push(ws);
  });
  return async function drop() {
    online = false;
    for (const ws of sockets) await ws.close();
  };
}

export const SCREENS: Screen[] = [
  {
    name: "Home",
    async open(page) {
      await openHome(page);
      return { room: null, names: [] };
    },
    redesignedOnly: [],
  },
  {
    name: "Planning (Host)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin", open: false });
      await planRound(room, { format: "spectrum" }, ["Pineapple belongs on pizza"]);
      await openRoom(page, room, "host");
      return { room, names: ["Robin"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    // Cards (#58): an empty Round opens the Prompt picker, with the chosen Pack as a card.
    name: "Planning (Host), adding Prompts",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin", open: false });
      await planRound(room, { format: "spectrum" }, ["Pineapple belongs on pizza"]);
      await planRound(room, { format: "middle-ground", sides: ["Cats", "Dogs"] }, []);
      await openRoom(page, room, "host");
      return { room, names: ["Robin"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    // Cards (#58): the Lineup Preview's Rounds, before the Room opens.
    name: "Planning (visitor)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin", open: false });
      await planRound(room, { format: "spectrum" }, ["Pineapple belongs on pizza"]);
      await planRound(room, { format: "middle-ground", sides: ["Cats", "Dogs"] }, [
        "Who makes the better pet",
      ]);
      await openRoom(page, room, "visitor");
      return { room, names: [] };
    },
    redesignedOnly: [],
  },
  {
    // Toasts (#60): someone joins, then the connection drops. The pointer rests on the
    // toasts, which pauses them, so they stay for the checks.
    name: "Waiting Room (Host), with toasts",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      await join(room, ["Ada"]);
      const drop = await droppableConnection(page);
      await openRoom(page, room, "host");
      await join(room, ["Marcus Okonkwo-Hale"]);
      await expect(page.getByText("joined the Room")).toBeVisible();
      await drop();
      await expect(page.getByText("Connection lost. Reconnecting…")).toBeVisible();
      await page.locator("[data-slot=toast]").first().hover();
      return { room, names: ["Robin", "Ada", "Marcus Okonkwo-Hale"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    // Notices (#60): a Host who isn't Playing sees positions, and is told only they can.
    name: "Spectrum Stage, before the reveal (Host, not Playing)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      await join(room, ["Ada", "Linus"]);
      await startRound(room, { format: "spectrum" });
      await openRoom(page, room, "host");
      await expect(page.getByText("Only you can see this.")).toBeVisible();
      return { room, names: ["Robin", "Ada", "Linus"] };
    },
    redesignedOnly: [...NOT_YET, "flat"],
  },
  {
    name: "Join",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      await join(room, ["Ada"]);
      await openRoom(page, room, "visitor");
      return { room, names: [] };
    },
    redesignedOnly: [],
  },
  {
    name: "Waiting Room (Host)",
    async open(page, baseURL) {
      const room = await waitingRoom(baseURL);
      await openRoom(page, room, "host");
      return { room, names: WAITING_ROOM_NAMES };
    },
    redesignedOnly: NOT_YET,
  },
  {
    name: "Waiting Room (Participant)",
    async open(page, baseURL) {
      const room = await waitingRoom(baseURL);
      await openRoom(page, room, room.people.get("Ada")!);
      return { room, names: WAITING_ROOM_NAMES };
    },
    redesignedOnly: NOT_YET,
  },
  {
    name: "Waiting Room (Spectator)",
    async open(page, baseURL) {
      const room = await waitingRoom(baseURL);
      await openRoom(page, room, room.people.get("Margaret")!);
      return { room, names: WAITING_ROOM_NAMES };
    },
    redesignedOnly: NOT_YET,
  },
  {
    name: "Crowd: Waiting Room (Host)",
    async open(page, baseURL) {
      const { room, names } = await crowd(baseURL);
      await openRoom(page, room, "host");
      return { room, names };
    },
    redesignedOnly: NOT_YET,
  },
  {
    name: "Spectrum Stage, before the reveal (Participant)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      const [ada] = await join(room, ["Ada", "Linus"]);
      await startRound(room, { format: "spectrum" });
      await openRoom(page, room, ada);
      return { room, names: ["Robin", "Ada", "Linus"] };
    },
    redesignedOnly: [...NOT_YET, "flat"],
  },
  {
    name: "Crowd: Spectrum Stage, everyone on one notch (Participant)",
    async open(page, baseURL) {
      const { room, names, people } = await crowdOnOneNotch(baseURL);
      await openRoom(page, room, people[0]);
      return { room, names };
    },
    redesignedOnly: [...NOT_YET, "flat"],
  },
  {
    name: "Middle Ground Stage (Participant)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      const [ada] = await join(room, ["Ada", "Linus"]);
      await startRound(room, { format: "middle-ground" });
      await openRoom(page, room, ada);
      return { room, names: ["Robin", "Ada", "Linus"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    name: "Surrounded Stage (Participant)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      const [ada, linus] = await join(room, ["Ada", "Linus", "Grace"]);
      await startRound(room, { format: "surrounded", centerId: linus.personId });
      await openRoom(page, room, ada);
      return { room, names: ["Robin", "Ada", "Linus", "Grace"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    // Timers (#63, registered in #74): the Floor's atom dial, counting down. On a
    // Middle Ground Stage, whose old parts pass flat, unlike the Spectrum's track.
    name: "The Floor, a speaking timer running (Participant)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      const [ada] = await join(room, ["Ada", "Linus"]);
      await startRound(room, { format: "middle-ground" });
      await room.host.act(
        { type: "set-floor-timer", seconds: 120 },
        (view) => view.floor?.timerSeconds === 120,
      );
      await room.host.act({ type: "give-floor", personId: ada.personId }, (view) =>
        Boolean(view.floor?.holders.some((h) => h.endsAt !== null)),
      );
      await openRoom(page, room, room.people.get("Linus")!);
      await expect(page.getByRole("timer")).toBeVisible();
      return { room, names: ["Robin", "Ada", "Linus"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    // Timers (#63, registered in #74): the Exchange's atom dial, as the Center sees it.
    name: "Surrounded Stage, an Exchange (Center)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      const [ada, linus] = await join(room, ["Ada", "Linus", "Grace"]);
      await startRound(room, { format: "surrounded", centerId: linus.personId });
      await ada.act({ type: "take-chair" }, (view) =>
        Boolean(
          view.stage?.format === "surrounded" &&
          view.stage.surrounded.chair?.challenger.personId === ada.personId,
        ),
      );
      await openRoom(page, room, linus);
      await expect(page.getByRole("timer")).toBeVisible();
      return { room, names: ["Robin", "Ada", "Linus", "Grace"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    // Timers (#63, registered in #74): the Mood Check-in's surfboard bar, open for
    // 15 seconds after a Prompt ends. Linus has answered; Ada hasn't, so it stays open.
    name: "Mood Check-in (Participant)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      const [ada, linus] = await join(room, ["Ada", "Linus"]);
      await startRound(room, { format: "spectrum" });
      for (const [bot, position] of [
        [ada, 20],
        [linus, 80],
      ] as const) {
        bot.send({ type: "lock-in", position });
      }
      await room.host.until(
        (view) => view.stage?.format === "spectrum" && view.stage.spectrum.step === "revealed",
        "the reveal",
      );
      await room.host.act({ type: "advance" }, (view) => view.stage?.checkIn?.status === "open");
      await linus.act(
        { type: "set-mood", mood: "thinking" },
        (view) => view.stage?.checkIn?.status === "open" && view.stage.checkIn.answered.length > 0,
      );
      await openRoom(page, room, ada);
      await expect(page.getByRole("timer")).toBeVisible();
      return { room, names: ["Robin", "Ada", "Linus"] };
    },
    redesignedOnly: NOT_YET,
  },
];
