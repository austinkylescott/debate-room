// The app's tokens are the designer's: every value in docs/design/tokens.json
// reaches the theme it belongs to, so a hand edit to tokens.css can't drift.
import { describe, expect, it } from "vite-plus/test";
import design from "../../docs/design/tokens.json";
import css from "./tokens.css?raw";

// Selector (whitespace-normalised) → its custom properties.
function rules(source: string): Map<string, Map<string, string>> {
  const found = new Map<string, Map<string, string>>();
  const plain = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selector = "", body = ""] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const props = new Map<string, string>();
    for (const [, name = "", value = ""] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      props.set(name, value.trim().replace(/\s+/g, " "));
    }
    found.set(
      selector
        .trim()
        .replace(/\s*,\s*/g, ", ")
        .replace(/\s+/g, " "),
      props,
    );
  }
  return found;
}

const themes = rules(css);
const dark = themes.get(':root, [data-theme="dark"]');
const lightByPreference = themes.get(':root:not([data-theme="dark"])');
const lightByChoice = themes.get('[data-theme="light"]');
const shared = themes.get(":root");

const lower = (value: string) => value.toLowerCase();

describe("theme tokens", () => {
  it("defines dark as the default, and light for the OS preference and for data-theme", () => {
    expect(dark).toBeDefined();
    expect(lightByPreference).toBeDefined();
    expect(lightByChoice).toBeDefined();
    expect(css).toMatch(/@media \(prefers-color-scheme: light\)/);
  });

  it.each(design.color.tokens)("gives --$name its dark and light values", ({ name, value }) => {
    expect(dark?.get(`--${name}`)).toBe(lower(value.dark));
    expect(lightByPreference?.get(`--${name}`)).toBe(lower(value.light));
    expect(lightByChoice?.get(`--${name}`)).toBe(lower(value.light));
  });

  it("gives the lift shadow its value in each theme", () => {
    const [lift] = design.shadow.tokens;
    expect(dark?.get("--lift")).toBe(lift?.value.dark);
    expect(lightByPreference?.get("--lift")).toBe(lift?.value.light);
    expect(lightByChoice?.get("--lift")).toBe(lift?.value.light);
  });
});

describe("shared tokens", () => {
  it.each([...design.spacing.tokens, ...design.radius.tokens])(
    "sets --$name to $value",
    ({ name, value }) => {
      expect(shared?.get(`--${name}`)).toBe(value);
    },
  );

  it("sets the display and body font families", () => {
    expect(shared?.get("--font-display")).toBe(design.type.families.display);
    expect(shared?.get("--font-body")).toBe(design.type.families.body);
  });
});
