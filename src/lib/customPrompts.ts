// Custom Prompts the Host has written, kept in this browser for reuse in later Rooms.
import { ref } from "vue";

const KEY = "debate-room:custom-prompts";
const MAX_SAVED = 200;

export const savedPrompts = ref<string[]>(load());

export function rememberPrompt(text: string) {
  const prompt = text.trim().replace(/\s+/g, " ");
  if (!prompt) return;
  savedPrompts.value = [prompt, ...savedPrompts.value.filter((p) => p !== prompt)].slice(
    0,
    MAX_SAVED,
  );
  try {
    localStorage.setItem(KEY, JSON.stringify(savedPrompts.value));
  } catch {
    // Without storage the Prompts still work in this Room; they just aren't kept.
  }
}

export function forgetPrompt(text: string) {
  savedPrompts.value = savedPrompts.value.filter((p) => p !== text);
  try {
    localStorage.setItem(KEY, JSON.stringify(savedPrompts.value));
  } catch {
    // Nothing to do without storage.
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
