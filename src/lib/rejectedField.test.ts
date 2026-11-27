// Which form field a refusal is about, so that field can show it as its own error.
import { describe, expect, it } from "vite-plus/test";
import { rejectedField } from "./rejectedField";

describe("rejectedField", () => {
  it.each([
    ["nickname-invalid", "nickname"],
    ["nickname-taken", "nickname"],
    ["pin-invalid", "pin"],
    ["wrong-pin", "pin"],
    ["pin-locked", "pin"],
    ["limit-invalid", "limit"],
  ] as const)("puts %s on the %s field", (code, field) => {
    expect(rejectedField(code)).toBe(field);
  });

  it.each(["room-full", "spectators-full", "room-ended", "not-host"] as const)(
    "leaves %s to the form, not a field",
    (code) => {
      expect(rejectedField(code)).toBeNull();
    },
  );

  it("has no field when there's no refusal", () => {
    expect(rejectedField(undefined)).toBeNull();
  });
});
