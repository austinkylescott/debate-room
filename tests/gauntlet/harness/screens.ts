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
];
