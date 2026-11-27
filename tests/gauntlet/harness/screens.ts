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
  type Bot,
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

/** Every name on the screen is an Electron or one-line label now (#61); old controls remain. */
const OLD_CONTROLS: CheckName[] = ["targets"];

/** A Waiting Room with a few people in it and a Round planned. */
async function waitingRoom(baseURL: string) {
  const room = await createRoom(baseURL, { hostNickname: "Robin" });
  await join(room, ["Ada", "Grace Hopper", "Linus"]);
  await join(room, ["Margaret"], "spectator");
  await planRound(room, { format: "spectrum" }, ["Pineapple belongs on pizza"]);
  return room;
}
const WAITING_ROOM_NAMES = ["Robin", "Ada", "Grace Hopper", "Linus", "Margaret"];

/** Positions spread over every notch, so a crowd shows both poles and Neutral. */
const SPREAD = [0, 10, 25, 40, 50, 50, 60, 75, 90, 100];

/** The crowd, each locked in at the next spread position (only some, with `count`). */
async function lockInSpread(people: Bot[], count = people.length) {
  await Promise.all(
    people
      .slice(0, count)
      .map((bot, i) =>
        bot.act({ type: "lock-in", position: SPREAD[i % SPREAD.length] }, (view) =>
          Boolean(
            view.stage?.format === "spectrum" &&
            view.stage.spectrum.people.find((p) => p.personId === bot.personId)?.lockedIn,
          ),
        ),
      ),
  );
}

/**
 * The Floor in a crowd: the first person has it (unless `give` is false, when the
 * Round has already given it), the next three have hands up, and two people have
 * Moods, so electrons show the ring, diamonds and Moods.
 */
async function busyFloor(room: TestRoom, people: Bot[], { give = true } = {}) {
  if (give) {
    await room.host.act({ type: "give-floor", personId: people[0].personId }, (view) =>
      Boolean(view.floor?.holders.length),
    );
  }
  for (const bot of people.slice(2, 5)) {
    await bot.act({ type: "raise-hand" }, (view) =>
      Boolean(view.floor?.raisedHands.some((h) => h.personId === bot.personId)),
    );
  }
  for (const [bot, mood] of [
    [people[0], "thinking"],
    [people[2], "amused"],
  ] as const) {
    await bot.act({ type: "set-mood", mood }, (view) => view.stage?.moods[bot.personId] === mood);
  }
}

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
    name: "Join, nickname taken",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      await join(room, ["Ada"]);
      await openRoom(page, room, "visitor");
      await page.getByRole("textbox", { name: "Your nickname" }).fill("Ada");
      await page.getByRole("button", { name: "Join" }).click();
      await expect(page.getByRole("textbox", { name: "Your nickname" })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      return { room, names: [] };
    },
    redesignedOnly: [],
  },
  {
    name: "Take back Host control, wrong PIN",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin" });
      await openRoom(page, room, "visitor");
      await page.getByRole("button", { name: "I'm the Host" }).click();
      await page.getByLabel("Your Host PIN").fill("9999");
      await page.getByRole("button", { name: "Continue as the Host" }).click();
      await expect(page.getByLabel("Your Host PIN")).toHaveAttribute("aria-invalid", "true");
      return { room, names: [] };
    },
    redesignedOnly: [],
  },
  {
    name: "Planning, picking Prompts (Host)",
    async open(page, baseURL) {
      const room = await createRoom(baseURL, { hostNickname: "Robin", open: false });
      await planRound(room, { format: "spectrum" }, []);
      await openRoom(page, room, "host");
      await expect(page.getByRole("checkbox").first()).toBeVisible();
      return { room, names: ["Robin"] };
    },
    redesignedOnly: NOT_YET,
  },
  {
    name: "Waiting Room (Host)",
    async open(page, baseURL) {
      const room = await waitingRoom(baseURL);
      await openRoom(page, room, "host");
      return { room, names: WAITING_ROOM_NAMES };
    },
    redesignedOnly: OLD_CONTROLS,
  },
  {
    name: "Waiting Room (Participant)",
    async open(page, baseURL) {
      const room = await waitingRoom(baseURL);
      await openRoom(page, room, room.people.get("Ada")!);
      return { room, names: WAITING_ROOM_NAMES };
    },
    redesignedOnly: OLD_CONTROLS,
  },
  {
    name: "Waiting Room (Spectator)",
    async open(page, baseURL) {
      const room = await waitingRoom(baseURL);
      await openRoom(page, room, room.people.get("Margaret")!);
      return { room, names: WAITING_ROOM_NAMES };
    },
    redesignedOnly: OLD_CONTROLS,
  },
  {
    name: "Crowd: Waiting Room (Host)",
    async open(page, baseURL) {
      const { room, names } = await crowd(baseURL);
      await openRoom(page, room, "host");
      return { room, names };
    },
    redesignedOnly: OLD_CONTROLS,
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
    redesignedOnly: [...OLD_CONTROLS, "flat"],
  },
  {
    name: "Crowd: Spectrum Stage, everyone on one notch (Participant)",
    async open(page, baseURL) {
      const { room, names, people } = await crowdOnOneNotch(baseURL);
      await openRoom(page, room, people[0]);
      return { room, names };
    },
    redesignedOnly: [...OLD_CONTROLS, "flat"],
  },
  {
    name: "Crowd: Spectrum Stage, before the reveal (Host, not Playing)",
    async open(page, baseURL) {
      const { room, names, people } = await crowd(baseURL);
      await startRound(room, { format: "spectrum" });
      // Some locked in, the rest still deciding: the Host peeks at both.
      await lockInSpread(people, 10);
      await Promise.all(
        people
          .slice(10)
          .map((bot) =>
            bot.act({ type: "move-position", position: 70 }, (view) =>
              Boolean(view.stage?.format === "spectrum"),
            ),
          ),
      );
      await openRoom(page, room, "host");
      return { room, names: ["Robin", ...names] };
    },
    redesignedOnly: [...OLD_CONTROLS, "flat"],
  },
  {
    name: "Crowd: Spectrum Stage, revealed, with the Floor (Participant)",
    async open(page, baseURL) {
      const { room, names, people } = await crowd(baseURL);
      await startRound(room, { format: "spectrum" });
      await lockInSpread(people);
      await busyFloor(room, people);
      await openRoom(page, room, people[4]);
      return { room, names: ["Robin", ...names] };
    },
    redesignedOnly: [...OLD_CONTROLS, "flat"],
  },
  {
    name: "Crowd: Spectrum Stage, who to call on (Host)",
    async open(page, baseURL) {
      const { room, names, people } = await crowd(baseURL);
      await startRound(room, { format: "spectrum" });
      await lockInSpread(people);
      // Two people cross notches after the reveal: they've changed their minds.
      for (const bot of people.slice(0, 2)) {
        bot.send({ type: "move-position", position: 95, settled: true });
        await room.host.until(
          (view) =>
            view.stage?.format === "spectrum" &&
            Boolean(view.stage.spectrum.callingAids?.changedMind.includes(bot.personId)),
          "a changed mind",
        );
      }
      await busyFloor(room, people);
      await openRoom(page, room, "host");
      return { room, names: ["Robin", ...names] };
    },
    redesignedOnly: [...OLD_CONTROLS, "flat"],
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
    redesignedOnly: OLD_CONTROLS,
  },
  {
    name: "Crowd: Middle Ground Stage, before the reveal (Host, not Playing)",
    async open(page, baseURL) {
      const { room, names, people } = await crowd(baseURL);
      await startRound(room, { format: "middle-ground" });
      for (const [i, bot] of people.entries()) {
        const side = i < 12 ? 0 : 1;
        await bot.act({ type: "pick-side", side }, (view) =>
          Boolean(
            view.stage?.format === "middle-ground" && view.stage.middleGround.yours?.side === side,
          ),
        );
      }
      // Half step in, half stay; the Host sees both before the reveal.
      for (const [i, bot] of people.slice(0, 8).entries()) {
        await bot.act({ type: "choose-middle", stepIn: i % 2 === 0 }, (view) =>
          Boolean(
            view.stage?.format === "middle-ground" &&
            view.stage.middleGround.yours?.inMiddle === (i % 2 === 0),
          ),
        );
      }
      await openRoom(page, room, "host");
      return { room, names: ["Robin", ...names] };
    },
    redesignedOnly: OLD_CONTROLS,
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
    redesignedOnly: OLD_CONTROLS,
  },
  {
    name: "Crowd: Surrounded Stage, an Exchange (Participant)",
    async open(page, baseURL) {
      const { room, names, people } = await crowd(baseURL);
      const [center, challenger] = people;
      await startRound(room, { format: "surrounded", centerId: center.personId });
      await challenger.act({ type: "take-chair" }, (view) =>
        Boolean(
          view.stage?.format === "surrounded" &&
          view.stage.surrounded.chair?.challenger.personId === challenger.personId,
        ),
      );
      // The Center and the Challenger have the Floor for the Exchange.
      await busyFloor(room, people, { give: false });
      await openRoom(page, room, people[5]);
      return { room, names: ["Robin", ...names] };
    },
    redesignedOnly: OLD_CONTROLS,
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
