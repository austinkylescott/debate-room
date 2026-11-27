// Opening the app in a page as a given person, and the page conditions the
// gauntlet varies: theme and reduced motion.
import { expect, type Page } from "@playwright/test";
import type { Bot, TestRoom } from "./room.ts";

export type Theme = "light" | "dark";
export const THEMES: Theme[] = ["light", "dark"];

/** Phone and laptop, the two widths the handoff designs for. */
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  laptop: { width: 1280, height: 800 },
} as const;

/**
 * Sets the theme the way the app's own override does (`data-theme` on `<html>`,
 * saved as the theme toggle saves it), and the OS preference to match. Call
 * before or after navigating: it sticks across navigations and applies to the page now.
 */
export async function setTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => {
    localStorage.setItem("debate-room:theme", value);
    document.documentElement.dataset.theme = value;
  }, theme);
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

/** Turns `prefers-reduced-motion: reduce` on or off for the page. */
export async function setReducedMotion(page: Page, reduce: boolean) {
  await page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
}

/** Opens the Home page, ready to create a Room. */
export async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create a Room" })).toBeVisible();
  await settle(page);
}

/**
 * Opens the Room in `page` as `who`: the Host, one of the people who joined (a
 * {@link Bot}), or a visitor who hasn't joined yet. The page reuses the
 * person's device token, so the Room sees the same person on both connections.
 */
export async function openRoom(page: Page, room: TestRoom, who: "host" | "visitor" | Bot) {
  const token = who === "host" ? room.host.token : who === "visitor" ? null : who.token;
  const hostSecret = who === "host" ? room.hostSecret : null;
  await page.addInitScript(
    ({ roomId, token, hostSecret }) => {
      if (token) localStorage.setItem(`debate-room:${roomId}:token`, token);
      if (hostSecret) localStorage.setItem(`debate-room:${roomId}:host-secret`, hostSecret);
    },
    { roomId: room.id, token, hostSecret },
  );
  await page.goto(`/r/${room.id}`);
  await expect(page.getByText("Connecting to the Room…")).toHaveCount(0);
  if (who === "visitor") {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  } else {
    // Everyone in the Room sees the Waiting Room list, Rounds or not.
    await expect(page.getByRole("heading", { name: /^Waiting Room/, level: 2 })).toBeVisible();
  }
  await settle(page);
}

/** Waits for web fonts and a couple of frames, so layout and colours are final. */
export async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}
