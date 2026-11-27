// What the redesign has reached so far. The checks the old screens can't pass yet
// (targets, names, flat shapes, the strict focus ring) look only at elements that
// match one of these selectors, or sit inside one. Each component issue appends
// the selectors for what it restyled, in the same PR, so its checks start
// running. Never remove an entry to make a check pass: fix the component.
//
// Anything can also opt in from the markup with a `data-redesigned` attribute.

export interface RedesignedEntry {
  selector: string;
  /** The issue that redesigned it. */
  issue: string;
}

export const REDESIGNED: RedesignedEntry[] = [{ selector: "[data-redesigned]", issue: "#54" }];

export const REDESIGNED_SELECTORS = REDESIGNED.map((entry) => entry.selector);
