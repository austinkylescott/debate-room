// Custom Prompts the Host has written, saved in this browser so they can be
// reused in later Rooms. They only reach a Room when the Host adds them to it.
import { ref } from "vue";

const KEY = "debate-room:custom-prompts";

/** This browser's saved custom Prompts, newest first. */
export const customPrompts = ref<string[]>(load());

export function saveCustomPrompt(text: string) {
  const tidy = text.trim().replace(/\s+/g, " ");
  if (!tidy) return;
  customPrompts.value = [tidy, ...customPrompts.value.filter((p) => p !== tidy)];
  store();
}

export function forgetCustomPrompt(text: string) {
  customPrompts.value = customPrompts.value.filter((p) => p !== text);
  store();
}

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function store() {
  try {
    localStorage.setItem(KEY, JSON.stringify(customPrompts.value));
  } catch {
    // Without storage the Prompts still work in this Room; they just aren't kept.
  }
}
