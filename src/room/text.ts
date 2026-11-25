/** Trims text and collapses runs of whitespace to single spaces. */
export const tidyText = (text: string) => text.trim().replace(/\s+/g, " ");
