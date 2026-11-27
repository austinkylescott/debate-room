// The design gauntlet (docs/design/HANDOFF.md, "Acceptance: the design gauntlet").
// Run with `vp run gauntlet`. See tests/gauntlet/README.md.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The dev server's port: its own range (5180-5279), picked from the checkout's
 * path, so two checkouts (e.g. worktrees) running the gauntlet at once never
 * reuse each other's server. Set GAUNTLET_PORT to reuse a `vp dev` you started.
 */
const port = Number(
  process.env.GAUNTLET_PORT ??
    5180 + (parseInt(createHash("sha1").update(root).digest("hex").slice(0, 8), 16) % 100),
);
const baseURL = `http://localhost:${port}`;

/**
 * The Chromium that ships with the installed Playwright. `@playwright/test` is
 * pinned to that Playwright's version, so this is only a fallback for machines
 * where the browsers live elsewhere (set GAUNTLET_CHROMIUM to override).
 */
const chromium = process.env.GAUNTLET_CHROMIUM ?? "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.gauntlet.ts",
  // Out of the working tree: the suite writes no traces, screenshots or videos.
  outputDir: "../../node_modules/.tmp/gauntlet-results",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  forbidOnly: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // CI also writes an HTML report, uploaded when the job fails.
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { open: "never", outputFolder: "../../node_modules/.tmp/gauntlet-report" }],
      ]
    : [["list"]],
  use: {
    baseURL,
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
    launchOptions: existsSync(chromium) ? { executablePath: chromium } : {},
  },
  webServer: {
    // Starts the app's own dev server (the Worker and its Durable Objects included).
    command: `vp dev --port ${port} --strictPort`,
    cwd: root,
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
