// The theme someone picks for this device: System (follow the OS), Dark or Light.
import { describe, expect, it } from "vite-plus/test";
import html from "../../index.html?raw";
import { chooseTheme, savedTheme, THEME_KEY } from "./theme";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    items,
  };
}

function fakeRoot(theme?: string) {
  const attributes = new Map<string, string>(theme ? [["data-theme", theme]] : []);
  return {
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    get theme() {
      return attributes.get("data-theme") ?? null;
    },
  };
}

const blockedStorage = {
  getItem(): string | null {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem() {
    throw new DOMException("blocked", "SecurityError");
  },
  removeItem() {
    throw new DOMException("blocked", "SecurityError");
  },
};

describe("the saved theme", () => {
  it("is System when nothing is saved", () => {
    expect(savedTheme(memoryStorage())).toBe("system");
  });

  it("comes back as the theme chosen on this device", () => {
    const storage = memoryStorage();
    chooseTheme("light", { storage, root: fakeRoot() });
    expect(savedTheme(storage)).toBe("light");
    chooseTheme("dark", { storage, root: fakeRoot() });
    expect(savedTheme(storage)).toBe("dark");
  });
});

describe("choosing a theme", () => {
  it("sets Dark or Light on the page", () => {
    const root = fakeRoot();
    chooseTheme("light", { storage: memoryStorage(), root });
    expect(root.theme).toBe("light");
    chooseTheme("dark", { storage: memoryStorage(), root });
    expect(root.theme).toBe("dark");
  });

  it("hands the page back to the OS for System", () => {
    const root = fakeRoot("dark");
    chooseTheme("system", { storage: memoryStorage(), root });
    expect(root.theme).toBeNull();
  });
});

describe("without storage", () => {
  it("still switches the page when saving is blocked", () => {
    const root = fakeRoot();
    expect(() => chooseTheme("light", { storage: blockedStorage, root })).not.toThrow();
    expect(root.theme).toBe("light");
  });

  it("falls back to System when reading is blocked", () => {
    expect(savedTheme(blockedStorage)).toBe("system");
  });
});

describe("the script index.html runs before first paint", () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

  function boot(storage: object) {
    const root = fakeRoot();
    // Runs the exact script index.html ships, with fakes for what it touches.
    // oxlint-disable-next-line no-implied-eval
    new Function("document", "localStorage", script)({ documentElement: root }, storage);
    return root.theme;
  }

  it("applies a saved Dark or Light", () => {
    expect(boot(memoryStorage({ [THEME_KEY]: "light" }))).toBe("light");
    expect(boot(memoryStorage({ [THEME_KEY]: "dark" }))).toBe("dark");
  });

  it("leaves the OS in charge for System, nothing saved, or anything else", () => {
    expect(boot(memoryStorage({ [THEME_KEY]: "system" }))).toBeNull();
    expect(boot(memoryStorage())).toBeNull();
    expect(boot(memoryStorage({ [THEME_KEY]: "purple" }))).toBeNull();
  });

  it("doesn't stop the page loading when storage is blocked", () => {
    expect(boot(blockedStorage)).toBeNull();
  });
});
