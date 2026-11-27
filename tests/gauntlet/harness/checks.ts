// The gauntlet's automated checks (docs/design/HANDOFF.md, "Acceptance: the
// design gauntlet"). Each looks at the page as it is now and returns the
// violations it found, one readable line each: an empty list is a pass.
//
// Every check takes a `scope`: null looks at the whole page; a list of
// selectors looks only at elements that match one, or sit inside one (see
// ../redesigned.ts for why).
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { SPARK_ALLOWLIST } from "../spark-allowlist.ts";

export type Violations = string[];
export type Scope = string[] | null;

/** Reports a check's violations as a soft failure, so one run lists every failing check. */
export function expectClean(check: string, violations: Violations) {
  const counts = new Map<string, number>();
  for (const violation of violations) counts.set(violation, (counts.get(violation) ?? 0) + 1);
  const lines = [...counts].map(([violation, n]) => (n > 1 ? `${violation} (×${n})` : violation));
  expect
    .soft(violations.length, `${check}, ${violations.length} found:\n  ${lines.join("\n  ")}\n`)
    .toBe(0);
}

/** Interactive elements: what someone can press, type into or move. */
const CONTROLS = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=option]",
  "[role=menuitem]",
  "[role=slider]",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * Helpers the checks use inside the page. Sent to the browser as source, so it
 * must not use anything from this module's scope.
 */
function installDomHelpers() {
  const describe = (el: Element): string => {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node !== document.body && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += `#${node.id}`;
      const classes = [...node.classList].slice(0, 2);
      if (classes.length) part += `.${classes.join(".")}`;
      const slot = node.getAttribute("data-slot");
      if (slot) part += `[data-slot=${slot}]`;
      parts.unshift(part);
      node = node.parentElement;
    }
    const text = (el.getAttribute("aria-label") ?? el.textContent ?? "")
      .trim()
      .replace(/\s+/g, " ");
    return `${parts.join(" > ")}${text ? ` "${text.slice(0, 40)}"` : ""}`;
  };
  const visible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const inScope = (el: Element, scope: string[] | null): boolean =>
    scope === null || scope.some((selector) => el.closest(selector) !== null);
  /** Resolves a CSS colour (e.g. `var(--primary)`) to its computed rgb() form. */
  const resolveColor = (value: string): string => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  };
  window.__gauntlet = { describe, visible, inScope, resolveColor };
}

declare global {
  interface Window {
    __gauntlet: {
      describe: (el: Element) => string;
      visible: (el: Element) => boolean;
      inScope: (el: Element, scope: string[] | null) => boolean;
      resolveColor: (value: string) => string;
    };
  }
}

async function withHelpers(page: Page) {
  await page.evaluate(installDomHelpers);
}

/** Contrast (gauntlet 3): axe's WCAG AA colour-contrast rule. Run it in each theme. */
export async function contrast(page: Page, scope: Scope = null): Promise<Violations> {
  let builder = new AxeBuilder({ page }).withRules(["color-contrast"]);
  if (scope) {
    const present = await page.evaluate(
      (scope) => scope.filter((selector) => document.querySelector(selector)),
      scope,
    );
    if (present.length === 0) return [];
    for (const selector of present) builder = builder.include(selector);
  }
  const results = await builder.analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) => `${node.target.join(" ")}: ${node.any.map((check) => check.message).join("; ")}`,
    ),
  );
}

/**
 * Targets (gauntlet 4): every visible control is at least 44×44px. A control
 * inside a `<label>` counts the label as its target, as the browser does.
 */
export async function targets(page: Page, scope: Scope = null): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate(
    ({ controls, scope, min }) => {
      const { describe, visible, inScope } = window.__gauntlet;
      // UI SDK's hidden native input mirrors a role=radio for forms: nobody can press it.
      const pressable = (el: Element) =>
        !(el.matches("input[aria-hidden=true]") && getComputedStyle(el).pointerEvents === "none");
      return [...document.querySelectorAll(controls)]
        .filter((el) => visible(el) && inScope(el, scope) && pressable(el))
        .flatMap((el) => {
          const own = el.getBoundingClientRect();
          const label = el.closest("label")?.getBoundingClientRect();
          const width = Math.max(own.width, label?.width ?? 0);
          const height = Math.max(own.height, label?.height ?? 0);
          return width + 0.5 >= min && height + 0.5 >= min
            ? []
            : [`${describe(el)} is ${Math.round(width)}×${Math.round(height)}px`];
        });
    },
    { controls: CONTROLS, scope, min: 44 },
  );
}

/**
 * Focus (gauntlet 4, hard rule 5): Tabs through the page from the top. Focus
 * moves in DOM order (no positive tabindex, never backwards) and every stop
 * shows the ring: 3px solid `--focus`, offset 2px.
 */
export async function focus(page: Page, scope: Scope = null, maxTabs = 300): Promise<Violations> {
  await withHelpers(page);
  // Number every element in DOM order, and start from the top of the document.
  await page.evaluate(() => {
    document
      .querySelectorAll("body *")
      .forEach((el, i) => el.setAttribute("data-gauntlet-order", String(i)));
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
  });
  const violations: Violations = [];
  let first: number | null = null;
  let previous = -1;
  for (let tab = 0; ; tab++) {
    if (tab === maxTabs) {
      violations.push(`Focus didn't come round after ${maxTabs} Tabs: raise maxTabs`);
      break;
    }
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((scope) => {
      const { describe, inScope, resolveColor } = window.__gauntlet;
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const ring =
        style.outlineStyle === "solid" &&
        parseFloat(style.outlineWidth) >= 3 &&
        parseFloat(style.outlineOffset) >= 2 &&
        style.outlineColor === resolveColor("var(--focus)");
      return {
        order: Number(el.getAttribute("data-gauntlet-order") ?? -1),
        name: describe(el),
        checked: inScope(el, scope),
        ring,
        outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}, offset ${style.outlineOffset}`,
      };
    }, scope);
    // Off the end of the document, or back round to the first stop: all visited.
    if (!stop || stop.order === first) break;
    if (stop.order <= previous) {
      violations.push(`${stop.name} is focused out of DOM order`);
      break;
    }
    if (stop.checked && !stop.ring) {
      violations.push(
        `${stop.name} needs a 3px solid --focus ring offset 2px, has ${stop.outline}`,
      );
    }
    first ??= stop.order;
    previous = stop.order;
  }
  await page.evaluate(() =>
    document
      .querySelectorAll("[data-gauntlet-order]")
      .forEach((el) => el.removeAttribute("data-gauntlet-order")),
  );
  return violations;
}

/**
 * Reduced motion (gauntlet 5, hard rule 6): call with `prefers-reduced-motion:
 * reduce` on (see `setReducedMotion`). No SMIL animation elements, and no CSS
 * animation running.
 */
export async function reducedMotion(page: Page, scope: Scope = null): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate((scope) => {
    const { describe, inScope } = window.__gauntlet;
    const smil = [...document.querySelectorAll("animate, animateMotion, animateTransform, set")]
      .filter((el) => inScope(el, scope))
      .map((el) => `${describe(el.parentElement ?? el)} has an <${el.tagName}> element`);
    const css = document
      .getAnimations()
      .filter((animation) => animation instanceof CSSAnimation && animation.playState === "running")
      .flatMap((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        if (target && !inScope(target, scope)) return [];
        const name = (animation as CSSAnimation).animationName;
        return [`${target ? describe(target) : "An element"} runs the CSS animation "${name}"`];
      });
    return [...smil, ...css];
  }, scope);
}

/**
 * Spark audit (gauntlet 6, hard rule 2): every visible element, `::before` or
 * `::after` whose colour, background, border, outline, shadow, fill, stroke or
 * accent resolves to `--primary` must match the allowlist
 * (../spark-allowlist.ts), or sit inside an element that does.
 */
export async function spark(
  page: Page,
  scope: Scope = null,
  allowlist: string[] = SPARK_ALLOWLIST.map((entry) => entry.selector),
): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate(
    ({ scope, allowlist }) => {
      const { describe, visible, inScope, resolveColor } = window.__gauntlet;
      const primary = resolveColor("var(--primary)");
      const found: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        if (!visible(el) || !inScope(el, scope)) continue;
        if (allowlist.some((selector) => el.closest(selector))) continue;
        const ownText = [...el.childNodes].some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        for (const pseudo of [null, "::before", "::after"]) {
          const style = getComputedStyle(el, pseudo);
          if (pseudo && (style.content === "none" || style.content === "normal")) continue;
          const uses: string[] = [];
          if (style.color === primary && (ownText || pseudo)) uses.push("color");
          if (style.backgroundColor === primary) uses.push("background");
          if (style.backgroundImage.includes(primary)) uses.push("background-image");
          for (const side of ["top", "right", "bottom", "left"]) {
            const border = (part: string) => style.getPropertyValue(`border-${side}-${part}`);
            if (parseFloat(border("width")) > 0 && border("style") !== "none") {
              if (border("color") === primary) uses.push(`border-${side}`);
            }
          }
          if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
            if (style.outlineColor === primary) uses.push("outline");
          }
          if (style.boxShadow.includes(primary)) uses.push("box-shadow");
          if (el instanceof SVGElement) {
            if (style.fill === primary) uses.push("fill");
            if (style.stroke === primary) uses.push("stroke");
          }
          if (el.matches("input, progress, meter") && style.accentColor === primary) {
            uses.push("accent-color");
          }
          if (uses.length) {
            found.push(`${describe(el)}${pseudo ?? ""} uses --primary for ${uses.join(", ")}`);
          }
        }
      }
      return found;
    },
    { scope, allowlist },
  );
}

/** Flat shapes (hard rule 7): no gradients and no blur. */
export async function flat(page: Page, scope: Scope = null): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate((scope) => {
    const { describe, visible, inScope } = window.__gauntlet;
    const found: string[] = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!inScope(el, scope)) continue;
      if (el.matches("linearGradient, radialGradient, feGaussianBlur")) {
        found.push(`${describe(el.parentElement ?? el)} has a <${el.tagName}>`);
        continue;
      }
      if (!visible(el)) continue;
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(el, pseudo);
        if (pseudo && (style.content === "none" || style.content === "normal")) continue;
        const where = `${describe(el)}${pseudo ?? ""}`;
        if (style.backgroundImage.includes("gradient")) found.push(`${where} has a gradient`);
        if (style.filter.includes("blur")) found.push(`${where} is blurred`);
        if (style.backdropFilter && style.backdropFilter !== "none") {
          found.push(`${where} has a backdrop filter`);
        }
      }
    }
    return found;
  }, scope);
}

/**
 * Names (hard rule 3; the crowd test, gauntlet 1): every label that shows one
 * of `shown` on its own (not a name inside a sentence) stays on one line with
 * `white-space: nowrap`, is cut only with an ellipsis, carries the full name in
 * `title` and in its accessible name, and overlaps no other name label.
 */
export async function names(page: Page, shown: string[], scope: Scope = null): Promise<Violations> {
  if (shown.length === 0) return [];
  await withHelpers(page);
  return page.evaluate(
    ({ shown, scope }) => {
      const { describe, visible, inScope } = window.__gauntlet;
      const found: string[] = [];
      const labels: { name: string; where: string; rect: DOMRect }[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const name = node.textContent?.trim() ?? "";
        const el = node.parentElement;
        if (!shown.includes(name) || !el || !visible(el) || !inScope(el, scope)) continue;
        const where = describe(el);
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = new Set(
          [...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)),
        );
        if (lines.size > 1) found.push(`"${name}" breaks across ${lines.size} lines in ${where}`);
        const style = getComputedStyle(el);
        if (style.whiteSpace !== "nowrap") {
          found.push(`"${name}" can wrap (white-space: ${style.whiteSpace}) in ${where}`);
        }
        const cut = el.scrollWidth > el.clientWidth + 1 && style.overflowX !== "visible";
        if (cut && style.textOverflow !== "ellipsis") {
          found.push(`"${name}" is cut off without an ellipsis in ${where}`);
        }
        if (!el.closest("[title]")?.getAttribute("title")?.includes(name)) {
          found.push(`"${name}" has no title with the full name in ${where}`);
        }
        const labelled = el.closest("[aria-label]");
        if (labelled && !labelled.getAttribute("aria-label")?.includes(name)) {
          found.push(`"${name}" is missing from the accessible name of ${describe(labelled)}`);
        }
        labels.push({ name, where, rect: el.getBoundingClientRect() });
      }
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i].rect;
          const b = labels[j].rect;
          const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (x > 1 && y > 1) {
            found.push(`"${labels[i].name}" overlaps "${labels[j].name}" in ${labels[j].where}`);
          }
        }
      }
      return found;
    },
    { shown, scope },
  );
}

/**
 * Choices (hard rule 8): every radio and checkbox sits right beside its label,
 * on the same line and at most `max` px before its first letter, so it reads
 * as one row (the join form's radios used to sit a whole row away).
 */
export async function choices(page: Page, scope: Scope = null, max = 16): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate(
    ({ scope, max }) => {
      const { describe, visible, inScope } = window.__gauntlet;
      const found: string[] = [];
      const controls = document.querySelectorAll(
        "[role=radio], [role=checkbox], input[type=radio], input[type=checkbox]",
      );
      for (const control of controls) {
        if (!visible(control) || !inScope(control, scope)) continue;
        // UI SDK's hidden native input, beside the role=radio or role=checkbox it serves.
        if (control.matches("input[aria-hidden=true]")) continue;
        const labelledBy = control.getAttribute("aria-labelledby")?.split(/\s+/)[0];
        const label =
          (labelledBy && document.getElementById(labelledBy)) ||
          control.closest("label") ||
          (control.id && document.querySelector(`label[for="${CSS.escape(control.id)}"]`));
        const walker = label ? document.createTreeWalker(label, NodeFilter.SHOW_TEXT) : null;
        let text: Text | null = null;
        for (let node = walker?.nextNode(); node; node = walker?.nextNode()) {
          if (!control.contains(node) && node.textContent?.trim()) {
            text = node as Text;
            break;
          }
        }
        if (!text) {
          found.push(`${describe(control)} has no visible label`);
          continue;
        }
        const start = text.data.search(/\S/);
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 1);
        const letter = range.getBoundingClientRect();
        const box = control.getBoundingClientRect();
        // The mark is square and centred in its box: a native radio stretched to 100% width
        // draws its circle in the middle, far from a label that starts right after the box.
        const half = Math.min(box.width, box.height) / 2;
        const centre = box.left + box.width / 2;
        const rtl = getComputedStyle(control).direction === "rtl";
        const gap = Math.round(rtl ? centre - half - letter.right : letter.left - (centre + half));
        const sameLine = letter.top < box.bottom && letter.bottom > box.top;
        if (!sameLine) found.push(`${describe(control)} sits on another line from its label`);
        else if (gap < 0 || gap > max)
          found.push(`${describe(control)} sits ${gap}px from its label`);
      }
      return found;
    },
    { scope, max },
  );
}

/** What the Card spec calls a card: the new class and the screens' legacy one. */
const CARDS = ".dr-card, .card";

/**
 * Cards (docs/design/components/Card.md): every card has the surface fill (or
 * `raised` when nested), the asymmetric corners (`radius-lg` and 8px), the
 * `lift` shadow unless it's raised, and mirrors its corners from the card
 * before it among its siblings. A card someone can press is a real `<button>`
 * or `<a href>`, never a div with a role or tabindex.
 */
export async function cards(page: Page, scope: Scope = null): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate(
    ({ selector, scope }) => {
      const { describe, visible, inScope, resolveColor } = window.__gauntlet;
      const resolve = (property: string, value: string) => {
        const probe = document.createElement("div");
        probe.style.setProperty(property, value);
        document.body.append(probe);
        const resolved = getComputedStyle(probe).getPropertyValue(property);
        probe.remove();
        return resolved;
      };
      const surface = resolveColor("var(--surface)");
      const raised = resolveColor("var(--raised)");
      const lift = resolve("box-shadow", "var(--lift)");
      const big = parseFloat(resolve("border-top-left-radius", "var(--radius-lg)"));
      const corners = (el: Element) => {
        const style = getComputedStyle(el);
        return ["top-left", "top-right", "bottom-right", "bottom-left"]
          .map((corner) => parseFloat(style.getPropertyValue(`border-${corner}-radius`)))
          .join(" ");
      };
      const leans = [`${big} 8 ${big} 8`, `8 ${big} 8 ${big}`];
      const found: string[] = [];
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || !inScope(el, scope)) continue;
        const where = describe(el);
        const style = getComputedStyle(el);
        const isRaised = el.matches(".dr-card--raised");
        const fill = isRaised ? raised : surface;
        if (style.backgroundColor !== fill) {
          found.push(
            `${where} has background ${style.backgroundColor}, not --${isRaised ? "raised" : "surface"}`,
          );
        }
        const shape = corners(el);
        if (!leans.includes(shape)) found.push(`${where} has corners ${shape}, not ${leans[0]}`);
        if (isRaised && style.boxShadow !== "none" && !el.matches(".is-selected")) {
          found.push(`${where} is raised but has a shadow`);
        }
        if (!isRaised && !style.boxShadow.includes(lift)) {
          found.push(`${where} doesn't have the --lift shadow`);
        }
        const next = [...(el.parentElement?.children ?? [])]
          .slice([...(el.parentElement?.children ?? [])].indexOf(el) + 1)
          .find((sibling) => sibling.matches(selector) && visible(sibling));
        if (next && corners(next) === shape && leans.includes(shape)) {
          found.push(`${where} and the card after it lean the same way`);
        }
        const pressable = el.matches("[role=button], [role=link], [tabindex]:not([tabindex='-1'])");
        if (pressable && !el.matches("button, a[href]")) {
          found.push(`${where} can be pressed but isn't a <button> or <a href>`);
        }
      }
      return found;
    },
    { selector: CARDS, scope },
  );
}

/** What the Tag spec calls a tag: the new class and the Stages' legacy one. */
const TAGS = ".dr-tag, .tag";

/**
 * Tags (docs/design/components/Tag.md): every tag sits on one of the three
 * documented grounds (`ground`, `surface`, `raised`) and reads there as a pill:
 * its fill, border or outline shadow differs from the ground behind it. So a
 * `raised` tag on a `raised` card, whose edge vanishes, fails.
 */
export async function tags(page: Page, scope: Scope = null): Promise<Violations> {
  await withHelpers(page);
  return page.evaluate(
    ({ selector, scope }) => {
      const { describe, visible, inScope, resolveColor } = window.__gauntlet;
      const grounds = new Map(
        ["ground", "surface", "raised"].map((token) => [resolveColor(`var(--${token})`), token]),
      );
      const clear = (color: string) => color === "transparent" || /rgba\(.*,\s*0\)$/.test(color);
      /** The colour behind `el`: the nearest ancestor with a fill. */
      const groundOf = (el: Element) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const fill = getComputedStyle(node).backgroundColor;
          if (!clear(fill)) return fill;
        }
        return getComputedStyle(document.documentElement).backgroundColor;
      };
      /** The colour of each shadow in a computed `box-shadow` that draws something. */
      const shadowColors = (value: string) =>
        value === "none"
          ? []
          : value.split(/,(?![^(]*\))/).flatMap((shadow) => {
              const color = shadow.match(/rgba?\([^)]*\)/)?.[0] ?? "";
              const lengths = shadow.replace(color, "").match(/-?[\d.]+px/g) ?? [];
              return color && lengths.some((n) => parseFloat(n) !== 0) ? [color] : [];
            });
      const found: string[] = [];
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || !inScope(el, scope)) continue;
        const where = describe(el);
        const ground = groundOf(el);
        const token = grounds.get(ground);
        if (!token) {
          found.push(`${where} sits on ${ground}, not on --ground, --surface or --raised`);
          continue;
        }
        const style = getComputedStyle(el);
        const borders = ["top", "right", "bottom", "left"]
          .filter(
            (side) =>
              parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0 &&
              style.getPropertyValue(`border-${side}-style`) !== "none",
          )
          .map((side) => style.getPropertyValue(`border-${side}-color`));
        const edges = [style.backgroundColor, ...shadowColors(style.boxShadow), ...borders];
        if (!edges.some((color) => !clear(color) && color !== ground)) {
          found.push(
            `${where} doesn't read as a pill on --${token}: no fill or outline apart from it`,
          );
        }
      }
      return found;
    },
    { selector: TAGS, scope },
  );
}

export interface Secret {
  /** The other person's nickname. */
  name: string;
  /** Their hidden position, as the page could spell it (e.g. "37"). */
  values: string[];
}

/** Words that tie a name to a place on the Spectrum. */
export const NOTCH_WORDS = ["Disagree", "Neutral", "Agree"];

/**
 * Leak test, part 1 (gauntlet 2, hard rule 4): before the reveal, no text,
 * attribute, inline style or form value in the DOM, and nothing in the
 * accessibility tree, holds another person's hidden value; and no line of the
 * accessibility tree ties their name to one of `words`.
 */
export async function leak(
  page: Page,
  secrets: Secret[],
  words: string[] = NOTCH_WORDS,
): Promise<Violations> {
  const found: Violations = [];
  const dom = await page.evaluate(() => {
    const parts: string[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (el.matches("script, style")) continue;
      for (const attr of el.attributes) parts.push(`${attr.name}="${attr.value}"`);
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) parts.push(child.textContent ?? "");
      }
      if (el instanceof HTMLInputElement) parts.push(`value="${el.value}"`);
    }
    return parts;
  });
  const tree = await page.locator("body").ariaSnapshot();
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const has = (haystack: string, value: string) =>
    new RegExp(`(^|[^\\w.])${escape(value)}($|[^\\w])`).test(haystack);
  for (const { name, values } of secrets) {
    for (const value of values) {
      const hit = dom.find((part) => has(part, value));
      if (hit) found.push(`The DOM shows ${name}'s hidden value ${value}: ${hit.slice(0, 100)}`);
      if (has(tree, value)) {
        found.push(`The accessibility tree shows ${name}'s hidden value ${value}`);
      }
    }
    for (const line of tree.split("\n").filter((line) => line.includes(name))) {
      const word = words.find((w) => line.includes(w));
      if (word) found.push(`The accessibility tree ties ${name} to "${word}": ${line.trim()}`);
    }
  }
  return found;
}

/**
 * What a viewer can perceive of the page: its accessibility tree and its DOM
 * (tags, attributes, text and form values), with generated ids, clock times and
 * the Room id masked, so two Rooms set up alike read the same.
 */
export async function perceivable(page: Page, roomId: string): Promise<string[]> {
  const dom = await page.evaluate(() => {
    const lines: string[] = [];
    const walk = (el: Element, depth: number) => {
      if (el.matches("script, style")) return;
      const indent = "  ".repeat(depth);
      const attrs = [...el.attributes].map((a) => ` ${a.name}="${a.value}"`).join("");
      const value = el instanceof HTMLInputElement ? ` value="${el.value}"` : "";
      lines.push(`${indent}<${el.tagName.toLowerCase()}${attrs}${value}>`);
      for (const child of el.childNodes) {
        if (child instanceof Element) walk(child, depth + 1);
        else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
          lines.push(`${indent}  ${child.textContent.trim()}`);
        }
      }
    };
    walk(document.body, 0);
    return lines;
  });
  const tree = (await page.locator("body").ariaSnapshot()).split("\n");
  return [...tree, "----", ...dom].map((line) =>
    line
      .replaceAll(roomId, "<room>")
      .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?\b/g, "<time>")
      .replace(/\b(id|for|aria-controls|aria-labelledby|aria-describedby)="[^"]*"/g, '$1="<id>"'),
  );
}

/**
 * Leak test, part 2: two views that differ only in other people's hidden
 * choices must read the same. Returns the first lines that differ.
 */
export function sameView(a: string[], b: string[]): Violations {
  const found: Violations = [];
  for (let i = 0; i < Math.max(a.length, b.length) && found.length < 5; i++) {
    if (a[i] !== b[i]) found.push(`Line ${i + 1} differs: "${a[i]?.trim()}" / "${b[i]?.trim()}"`);
  }
  return found;
}
