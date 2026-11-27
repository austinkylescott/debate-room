// The theme toggle (#67): System, Dark or Light, chosen once per device, applied
// before the first paint, and in the same spot on every screen. The generic checks
// (targets, focus, contrast, spark) run on it in screens.gauntlet.ts.
import { inflateSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { openHome, openRoom, VIEWPORTS } from "./harness/browser.ts";
import { createRoom } from "./harness/room.ts";

/** `--ground` in each theme, from docs/design/tokens.json. */
const GROUND = { dark: [0x13, 0x22, 0x29], light: [0xf5, 0xe8, 0xcf] } as const;

/** The colour of one pixel of a PNG screenshot (8-bit RGB or RGBA, 1×1 clip). */
function pixel(png: Buffer): number[] {
  const channels = png[25] === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") {
      chunks.push(png.subarray(at + 8, at + 8 + length));
    }
    at += length + 12;
  }
  return [...inflateSync(Buffer.concat(chunks)).subarray(1, 1 + channels)].slice(0, 3);
}

/** The page's background, as painted. */
async function painted(page: Page) {
  return pixel(await page.screenshot({ clip: { x: 2, y: 2, width: 1, height: 1 } }));
}

const toggle = (page: Page) => page.getByRole("radiogroup", { name: "Theme" });

for (const theme of ["light", "dark"] as const) {
  test(`no flash: a saved ${theme} theme is the first thing painted, whatever the OS prefers`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await page.addInitScript((value) => localStorage.setItem("debate-room:theme", value), theme);
    await page.goto("/", { waitUntil: "commit" });
    // The first frame with the stylesheet in: what someone sees first.
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue("--ground") !== "",
      null,
      { polling: "raf" },
    );
    expect(await painted(page)).toEqual(GROUND[theme]);
  });
}

test("switching the theme repaints at once, survives a reload, and System follows the OS live", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openHome(page);
  await expect(toggle(page).getByRole("radio", { name: "System" })).toBeChecked();
  expect(await painted(page)).toEqual(GROUND.dark);

  await toggle(page).getByRole("radio", { name: "Light" }).click();
  expect(await painted(page)).toEqual(GROUND.light);

  await openHome(page);
  await expect(toggle(page).getByRole("radio", { name: "Light" })).toBeChecked();
  expect(await painted(page)).toEqual(GROUND.light);

  await toggle(page).getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(toggle(page).getByRole("radio", { name: "Dark" })).toBeChecked();
  expect(await painted(page)).toEqual(GROUND.dark);

  await toggle(page).getByRole("radio", { name: "System" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  expect(await painted(page)).toEqual(GROUND.light);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await painted(page)).toEqual(GROUND.dark);
});

for (const [width, viewport] of Object.entries(VIEWPORTS)) {
  test(`the toggle sits in the same spot, top right, on Home and in a Room · ${width}`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize(viewport);
    await openHome(page);
    const home = await toggle(page).boundingBox();
    const room = await createRoom(baseURL!, { hostNickname: "Robin" });
    try {
      await openRoom(page, room, "host");
      const inRoom = await toggle(page).boundingBox();
      expect(inRoom).toEqual(home);
      const main = await page.locator("main").boundingBox();
      expect(home!.y + home!.height).toBeLessThanOrEqual(main!.y);
      expect(home!.x + home!.width).toBeGreaterThan(viewport.width / 2);
    } finally {
      room.close();
    }
  });
}
