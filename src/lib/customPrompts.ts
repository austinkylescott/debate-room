// Custom Prompts the Host has written, kept in this browser for reuse in later Rooms.
import { ref } from "vue";
import { tidyText } from "../room/text";

const KEY = "debate-room:custom-prompts";
const MAX_SAVED = 200;

export const savedPrompts = ref<string[]>(load());

export function rememberPrompt(text: string) {
  const prompt = tidyText(text);
  if (!prompt) return;
  save([prompt, ...savedPrompts.value.filter((p) => p !== prompt)].slice(0, MAX_SAVED));
}

export function forgetPrompt(text: string) {
  save(savedPrompts.value.filter((p) => p !== text));
}

function save(prompts: string[]) {
  savedPrompts.value = prompts;
  try {
    localStorage.setItem(KEY, JSON.stringify(prompts));
  } catch {
    // Without storage the Prompts still work in this Room; they just aren't kept.
  }
}

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}
