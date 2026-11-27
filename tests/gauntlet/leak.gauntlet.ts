// The leak test (gauntlet 2, hard rule 4): before a reveal, someone Playing
// can't tell where anyone else is from the DOM or the accessibility tree.
import { expect, test } from "@playwright/test";
import { openRoom } from "./harness/browser.ts";
import { expectClean, leak, perceivable, sameView } from "./harness/checks.ts";
import { createRoom, join, startRound, type Bot } from "./harness/room.ts";

const OTHERS = ["Linus", "Grace", "Margaret"];

/**
 * A Round with Ada (whose view the test reads) and three others Playing. The
 * others make their hidden choices with `choose`; Ada makes none, so the
 * Prompt stays before the reveal.
 */
async function beforeTheReveal(
  baseURL: string,
  format: "spectrum" | "middle-ground",
  choose: (others: Bot[]) => Promise<void>,
) {
  const room = await createRoom(baseURL, { hostNickname: "Robin" });
  const [ada, ...others] = await join(room, ["Ada", ...OTHERS]);
  await startRound(room, { format });
  await choose(others);
  return { room, ada };
}

/** Each of `others` locks in at the matching position. */
const lockIn = (positions: number[]) => async (others: Bot[]) => {
  await Promise.all(
    others.map((bot, i) =>
      bot.act({ type: "lock-in", position: positions[i] }, (view) =>
        Boolean(
          view.stage?.format === "spectrum" &&
          view.stage.spectrum.people.find((p) => p.personId === bot.personId)?.lockedIn,
        ),
      ),
    ),
  );
};

/** Each of `others` picks Side 0, then steps into the middle or stays as `stepIn` says. */
const chooseMiddle = (stepIn: boolean[]) => async (others: Bot[]) => {
  for (const [i, bot] of others.entries()) {
    const mine = (view: Bot["view"]) =>
      view?.stage?.format === "middle-ground" ? view.stage.middleGround.yours : null;
    await bot.act({ type: "pick-side", side: 0 }, (view) => mine(view)?.side === 0);
    await bot.act(
      { type: "choose-middle", stepIn: stepIn[i] },
      (view) => mine(view)?.inMiddle === stepIn[i],
    );
  }
};

test("Spectrum: no one else's position before the reveal", async ({ browser, baseURL }) => {
  const a = await beforeTheReveal(baseURL!, "spectrum", lockIn([13, 37, 87]));
  const b = await beforeTheReveal(baseURL!, "spectrum", lockIn([87, 13, 62]));
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  try {
    await openRoom(pageA, a.room, a.ada);
    await openRoom(pageB, b.room, b.ada);
    const secrets = OTHERS.map((name, i) => ({ name, values: [String([13, 37, 87][i])] }));
    expectClean("Hidden positions in the page", await leak(pageA, secrets));
    expectClean(
      "The view changes with other people's hidden positions",
      sameView(await perceivable(pageA, a.room.id), await perceivable(pageB, b.room.id)),
    );
  } finally {
    a.room.close();
    b.room.close();
  }
});

// The control: the Host, not Playing, does see positions before the reveal
// (with "Only you can see this"), so the same probes must find them there.
// If this fails, the leak test above has gone blind.
test("Spectrum: the leak probes see what a Host who isn't Playing sees", async ({
  browser,
  baseURL,
}) => {
  const a = await beforeTheReveal(baseURL!, "spectrum", lockIn([13, 37, 87]));
  const b = await beforeTheReveal(baseURL!, "spectrum", lockIn([87, 13, 62]));
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  try {
    await openRoom(pageA, a.room, "host");
    await openRoom(pageB, b.room, "host");
    const secrets = OTHERS.map((name, i) => ({ name, values: [String([13, 37, 87][i])] }));
    expect(await leak(pageA, secrets)).not.toEqual([]);
    expect(
      sameView(await perceivable(pageA, a.room.id), await perceivable(pageB, b.room.id)),
    ).not.toEqual([]);
  } finally {
    a.room.close();
    b.room.close();
  }
});

test("Middle Ground: no one else's choice before the reveal", async ({ browser, baseURL }) => {
  const a = await beforeTheReveal(baseURL!, "middle-ground", chooseMiddle([true, false, true]));
  const b = await beforeTheReveal(baseURL!, "middle-ground", chooseMiddle([false, true, false]));
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  try {
    await openRoom(pageA, a.room, a.ada);
    await openRoom(pageB, b.room, b.ada);
    expectClean(
      "The view changes with other people's hidden choices",
      sameView(await perceivable(pageA, a.room.id), await perceivable(pageB, b.room.id)),
    );
  } finally {
    a.room.close();
    b.room.close();
  }
});
