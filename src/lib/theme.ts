// The theme someone picks for this device: System (follow the OS), Dark or Light.
// Dark and Light set `data-theme` on <html>; System removes it so tokens.css follows
// `prefers-color-scheme`, live. index.html applies the saved choice before first
// paint with the same key and rules (theme.test.ts runs that script too).

export type ThemeChoice = "system" | "dark" | "light";

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

type ThemeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ThemeRoot = Pick<Element, "setAttribute" | "removeAttribute">;

export const THEME_KEY = "debate-room:theme";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "dark" || value === "light";
}

export function savedTheme(storage: ThemeStorage | null): ThemeChoice {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return isThemeChoice(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

export function chooseTheme(
  choice: ThemeChoice,
  { storage, root }: { storage: ThemeStorage | null; root: ThemeRoot },
) {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    storage?.setItem(THEME_KEY, choice);
  } catch {
    // Storage can be blocked (private mode): the page still switches, just not for next time.
  }
}
