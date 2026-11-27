// Runs every per-screen check on the page as it is now.
import { test, type Page } from "@playwright/test";
import { REDESIGNED_SELECTORS } from "../redesigned.ts";
import * as checks from "./checks.ts";
import type { Scope, Violations } from "./checks.ts";

/** The per-screen checks, by the name a Screen's `redesignedOnly` uses. */
export const CHECKS = {
  contrast: (page, scope) => checks.contrast(page, scope),
  spark: (page, scope) => checks.spark(page, scope),
  focus: (page, scope) => checks.focus(page, scope),
  "reduced motion": (page, scope) => checks.reducedMotion(page, scope),
  flat: (page, scope) => checks.flat(page, scope),
  targets: (page, scope) => checks.targets(page, scope),
  names: (page, scope, names) => checks.names(page, names, scope),
  cards: (page, scope) => checks.cards(page, scope),
  tags: (page, scope) => checks.tags(page, scope),
} satisfies Record<string, (page: Page, scope: Scope, names: string[]) => Promise<Violations>>;

export type CheckName = keyof typeof CHECKS;

/**
 * Runs each check as a step, scoped to the redesigned elements where
 * `redesignedOnly` says so. Failures are soft, so one run lists all of them.
 * The page must have reduced motion on (the reduced-motion check needs it).
 */
export async function runChecks(
  page: Page,
  { names, redesignedOnly }: { names: string[]; redesignedOnly: CheckName[] },
) {
  for (const [name, check] of Object.entries(CHECKS) as [CheckName, (typeof CHECKS)[CheckName]][]) {
    const scoped = redesignedOnly.includes(name);
    const label = scoped ? `${name} (redesigned parts)` : name;
    await test.step(label, async () => {
      checks.expectClean(label, await check(page, scoped ? REDESIGNED_SELECTORS : null, names));
    });
  }
}
