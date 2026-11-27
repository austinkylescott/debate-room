// The checks, checked: each one must flag a planted violation and pass a good
// fixture, so a check that silently goes blind fails here. Fixtures are planted
// on the Home page, so they get the real tokens and base styles.
import { expect, test, type Page } from "@playwright/test";
import { openHome, setReducedMotion, setTheme } from "./harness/browser.ts";
import * as checks from "./harness/checks.ts";

const SCOPE = ["#fixture"];

async function plant(page: Page, html: string) {
  await page.evaluate((html) => {
    document.querySelector("#fixture")?.remove();
    const fixture = document.createElement("div");
    fixture.id = "fixture";
    fixture.innerHTML = html;
    document.body.prepend(fixture);
  }, html);
}

test.beforeEach(async ({ page }) => {
  await setReducedMotion(page, true);
  await setTheme(page, "dark");
  await openHome(page);
});

test("contrast flags low-contrast text", async ({ page }) => {
  await plant(page, `<p style="color: var(--line)">Barely there</p>`);
  expect(await checks.contrast(page, SCOPE)).toHaveLength(1);
  await plant(page, `<p style="color: var(--ink)">Easy to read</p>`);
  expect(await checks.contrast(page, SCOPE)).toEqual([]);
});

test("targets flags controls under 44×44px, counting a wrapping label", async ({ page }) => {
  await plant(
    page,
    `<button style="min-width: 0; padding: 0; width: 40px; height: 44px">Go</button>`,
  );
  expect(await checks.targets(page, SCOPE)).toEqual([expect.stringContaining("40×44px")]);
  await plant(
    page,
    `<button style="width: 44px; height: 44px">Go</button>
     <label style="display: flex; min-height: 44px; width: 120px"><input type="checkbox"> Mine</label>`,
  );
  expect(await checks.targets(page, SCOPE)).toEqual([]);
});

test("targets skips UI SDK's hidden form input, but not a small input that can be pressed", async ({
  page,
}) => {
  await plant(
    page,
    `<input type="radio" aria-hidden="true" style="width: 10px; height: 10px; margin: 0">`,
  );
  expect(await checks.targets(page, SCOPE)).toEqual([expect.stringContaining("10×10px")]);
  await plant(
    page,
    `<button role="radio" aria-checked="true" style="width: 44px; height: 44px">On</button>
     <input type="radio" aria-hidden="true" tabindex="-1"
       style="position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none">`,
  );
  expect(await checks.targets(page, SCOPE)).toEqual([]);
});

test("focus flags a missing ring and focus out of DOM order", async ({ page }) => {
  await plant(page, `<button style="outline: none !important">No ring</button>`);
  expect(await checks.focus(page, SCOPE)).toEqual([expect.stringContaining("No ring")]);
  await plant(page, `<button>Second</button><button tabindex="1">First</button>`);
  expect(await checks.focus(page, SCOPE)).toEqual([expect.stringContaining("out of DOM order")]);
  await plant(page, `<button>Fine</button>`);
  expect(await checks.focus(page, SCOPE)).toEqual([]);
});

test("reduced motion flags SMIL and running CSS animations", async ({ page }) => {
  await plant(
    page,
    `<style>@keyframes gauntlet-spin { to { rotate: 1turn } }</style>
     <svg width="10" height="10"><circle r="5"><animate attributeName="r" values="4;5" dur="1s" repeatCount="indefinite" /></circle></svg>
     <span style="display: inline-block; animation: gauntlet-spin 10s infinite">*</span>`,
  );
  expect(await checks.reducedMotion(page, SCOPE)).toEqual([
    expect.stringContaining("<animate>"),
    expect.stringContaining("gauntlet-spin"),
  ]);
  await plant(page, `<span>Still</span>`);
  expect(await checks.reducedMotion(page, SCOPE)).toEqual([]);
});

test("spark flags --primary outside the allowlist, in either theme", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await plant(
      page,
      `<p style="color: var(--primary)">Loud</p>
       <div style="width: 10px; height: 10px; border: 2px solid var(--primary)"></div>
       <svg width="10" height="10"><circle r="5" style="fill: var(--primary)" /></svg>
       <button class="primary">Allowed</button>`,
    );
    const found = await checks.spark(page, SCOPE);
    expect(found).toEqual([
      expect.stringContaining("for color"),
      expect.stringContaining("for border-top, border-right, border-bottom, border-left"),
      expect.stringContaining("for fill"),
    ]);
  }
});

test("flat flags gradients and blur", async ({ page }) => {
  await plant(
    page,
    `<div style="height: 4px; background: linear-gradient(red, blue)"></div>
     <div style="height: 4px; filter: blur(2px)">x</div>`,
  );
  expect(await checks.flat(page, SCOPE)).toEqual([
    expect.stringContaining("gradient"),
    expect.stringContaining("blurred"),
  ]);
  await plant(page, `<div style="height: 4px; background: var(--teal)"></div>`);
  expect(await checks.flat(page, SCOPE)).toEqual([]);
});

test("choices flags a radio or checkbox that sits away from its label", async ({ page }) => {
  await plant(
    page,
    `<label style="display: flex"><input type="radio" style="width: 200px"> Far away</label>
     <label style="display: block"><input type="checkbox" style="display: block"> Underneath</label>
     <span role="checkbox" aria-checked="false" aria-labelledby="fixture-off" tabindex="0" style="display: inline-block; width: 22px; height: 22px"></span>
     <span id="fixture-off" style="margin-left: 80px">Off to the side</span>`,
  );
  expect(await checks.choices(page, SCOPE)).toEqual([
    expect.stringMatching(/input sits \d+px from its label$/),
    expect.stringContaining("on another line"),
    expect.stringMatching(/span sits \d+px from its label$/),
  ]);
  await plant(
    page,
    `<label style="display: flex; gap: 12px; align-items: center"><input type="checkbox"> Right here</label>
     <label style="display: flex; gap: 12px; align-items: center">
       <span role="radio" aria-checked="true" aria-labelledby="fixture-near" tabindex="0" style="display: inline-block; width: 22px; height: 22px"><input type="radio" aria-hidden="true" style="position: absolute; opacity: 0"></span>
       <span id="fixture-near">Beside it</span>
     </label>
     <div role="radiogroup" aria-label="Theme">
       <button role="radio" aria-checked="true" aria-label="Light">☀</button>
       <button role="radio" aria-checked="false" aria-label="Dark">☾</button>
     </div>`,
  );
  expect(await checks.choices(page, SCOPE)).toEqual([]);
});

test("names flags names that wrap, break, lack a title or overlap", async ({ page }) => {
  const name = "Supercalifragilistic";
  await plant(
    page,
    `<span style="display: block; width: 40px; overflow-wrap: anywhere">${name}</span>`,
  );
  expect(await checks.names(page, [name], SCOPE)).toEqual([
    expect.stringContaining("breaks across"),
    expect.stringContaining("can wrap"),
    expect.stringContaining("no title"),
  ]);
  await plant(
    page,
    `<span title="${name}" style="display: block; width: 60px; white-space: nowrap; overflow: hidden">${name}</span>`,
  );
  expect(await checks.names(page, [name], SCOPE)).toEqual([
    expect.stringContaining("without an ellipsis"),
  ]);
  await plant(
    page,
    `<span title="Ada" style="position: absolute; top: 0; white-space: nowrap">Ada</span>
     <span title="Linus" style="position: absolute; top: 0; white-space: nowrap">Linus</span>`,
  );
  expect(await checks.names(page, ["Ada", "Linus"], SCOPE)).toEqual([
    expect.stringContaining("overlaps"),
  ]);
  await plant(
    page,
    `<div aria-label="Person"><span title="Ada" style="white-space: nowrap">Ada</span></div>
     <section aria-label="Notifications"><span title="Linus" style="white-space: nowrap">Linus</span></section>`,
  );
  expect(await checks.names(page, ["Ada", "Linus"], SCOPE)).toEqual([
    expect.stringContaining('"Ada" is missing from the accessible name'),
  ]);
  await plant(
    page,
    `<span title="${name}" style="display: block; width: 60px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${name}</span>
     <p>${name} said something long enough to wrap onto a second line in a sentence.</p>`,
  );
  expect(await checks.names(page, [name], SCOPE)).toEqual([]);
});

test("cards flags the wrong fill, corners or shadow, a same-way lean and a div that acts as a button", async ({
  page,
}) => {
  await plant(
    page,
    `<div class="dr-card" style="background: var(--raised)">Wrong fill</div>
     <div class="dr-card dr-card--flip" style="border-radius: 14px">Round corners</div>
     <div class="dr-card dr-card--raised" style="box-shadow: var(--lift)">Raised with a shadow</div>
     <div class="dr-card" style="box-shadow: none">Same lean, no lift</div>
     <div class="dr-card dr-card--flip"></div>
     <div class="dr-card" role="button" tabindex="0"
       style="border-radius: var(--radius-lg) 8px var(--radius-lg) 8px">Pretend button</div>`,
  );
  expect(await checks.cards(page, SCOPE)).toEqual([
    expect.stringContaining("not --surface"),
    expect.stringContaining("has corners 14 14 14 14"),
    expect.stringContaining("is raised but has a shadow"),
    expect.stringContaining("doesn't have the --lift shadow"),
    expect.stringContaining("lean the same way"),
    expect.stringContaining("isn't a <button> or <a href>"),
  ]);
  await plant(
    page,
    `<div class="dr-card"><h4 class="dr-card__title">Food Fights</h4>
       <div class="dr-card dr-card--raised">Nested</div></div>
     <button type="button" class="dr-card is-selected">Spectrum</button>
     <a class="dr-card" href="#">Middle Ground</a>`,
  );
  expect(await checks.cards(page, SCOPE)).toEqual([]);
});

/** Every Tag variant, as Tag.md lists them, plus "You". */
const ALL_TAGS = ["", "chill", "spicy", "host", "cohost", "spectator", "outline", "live"]
  .map((variant) => `<span class="dr-tag${variant ? ` dr-tag--${variant}` : ""}">Tag</span>`)
  .join("");

test("tags flags a tag that loses its pill on its ground, or sits on an undocumented one", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await setTheme(page, theme);
    await plant(
      page,
      `<div style="background: var(--raised)"><span class="dr-tag">Fill like the card</span></div>
       <div style="background: var(--surface)">
         <span class="dr-tag" style="background: var(--surface)">Fill like the card</span>
       </div>
       <div style="background: var(--teal)"><span class="dr-tag">Off the grounds</span></div>`,
    );
    expect(await checks.tags(page, SCOPE)).toEqual([
      expect.stringContaining("doesn't read as a pill on --raised"),
      expect.stringContaining("doesn't read as a pill on --surface"),
      expect.stringContaining("not on --ground, --surface or --raised"),
    ]);
    // Every variant, on each of the grounds the app puts tags on.
    await plant(
      page,
      `<div style="background: var(--ground)">${ALL_TAGS}</div>
       <div class="dr-card">${ALL_TAGS}<div class="dr-card dr-card--raised">${ALL_TAGS}</div></div>
       <ul class="people"><li>${ALL_TAGS}</li><li class="you">${ALL_TAGS}</li></ul>`,
    );
    expect(await checks.tags(page, SCOPE)).toEqual([]);
  }
});

test("reduced motion stops the Timer's last-10-seconds pulse", async ({ page }) => {
  const lowDial = `<span class="dr-timer is-low" role="timer" aria-label="Time: 9 seconds remaining">
    <span class="dr-timer__num">9</span></span>`;
  await setReducedMotion(page, false);
  await plant(page, lowDial);
  expect(await checks.reducedMotion(page, SCOPE)).toEqual([
    expect.stringContaining("dr-timer-beat"),
  ]);
  await setReducedMotion(page, true);
  await plant(page, lowDial);
  expect(await checks.reducedMotion(page, SCOPE)).toEqual([]);
});

test("leak flags hidden values in attributes, styles and the accessibility tree", async ({
  page,
}) => {
  await plant(page, `<span style="left: 37%" title="Linus">Linus</span>`);
  expect(await checks.leak(page, [{ name: "Linus", values: ["37"] }])).toEqual([
    expect.stringContaining("The DOM shows Linus's hidden value 37"),
  ]);
  await plant(page, `<p>Linus · Agree</p>`);
  expect(await checks.leak(page, [{ name: "Linus", values: ["37"] }])).toEqual([
    expect.stringContaining('ties Linus to "Agree"'),
  ]);
  await plant(page, `<p>Linus · 3 of 4 locked in · 137 points</p>`);
  expect(await checks.leak(page, [{ name: "Linus", values: ["37"] }])).toEqual([]);
});
