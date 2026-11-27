import type { RejectionCode } from "../room/room";

export type RejectedField = "nickname" | "pin" | "limit";

const FIELDS: Partial<Record<RejectionCode, RejectedField>> = {
  "nickname-invalid": "nickname",
  "nickname-taken": "nickname",
  "pin-invalid": "pin",
  "wrong-pin": "pin",
  "pin-locked": "pin",
  "limit-invalid": "limit",
};

/** The form field a refusal is about, if any: that field shows the message as its error. */
export function rejectedField(code: RejectionCode | undefined): RejectedField | null {
  return (code && FIELDS[code]) ?? null;
}
