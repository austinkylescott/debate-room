// Asking before something can't be undone (ending or cancelling the Room, removing
// someone or a Round): `await ask({...})` in place of the browser's confirm().
// ConfirmDialog.vue, mounted once in App.vue, shows the question.

export interface Question {
  title: string;
  description: string;
  /** The agreeing button's words, like "End the Room". */
  confirmLabel: string;
  cancelLabel?: string;
}

type Asker = (question: Question) => Promise<boolean>;

let asker: Asker | null = null;

/** ConfirmDialog.vue registers itself here; it returns how to unregister. */
export function registerAsker(next: Asker): () => void {
  asker = next;
  return () => {
    if (asker === next) asker = null;
  };
}

/** Resolves true when the person agrees, false when they cancel or press Escape. */
export function ask(question: Question): Promise<boolean> {
  return asker ? asker(question) : Promise.resolve(false);
}
