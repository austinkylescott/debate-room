// Every per-screen check, on every screen, in both themes, at phone and laptop width.
import { test } from "@playwright/test";
import { setReducedMotion, setTheme, settle, THEMES, VIEWPORTS } from "./harness/browser.ts";
import { runChecks } from "./harness/gauntlet.ts";
import { SCREENS } from "./harness/screens.ts";

for (const screen of SCREENS) {
  for (const [width, viewport] of Object.entries(VIEWPORTS)) {
    for (const theme of THEMES) {
      test(`${screen.name} · ${width} · ${theme}`, async ({ page, baseURL }) => {
        await page.setViewportSize(viewport);
        await setReducedMotion(page, true);
        await setTheme(page, theme);
        const { room, names } = await screen.open(page, baseURL!);
        try {
          await settle(page);
          await runChecks(page, { names, redesignedOnly: screen.redesignedOnly });
        } finally {
          room?.close();
        }
      });
    }
  }
}
