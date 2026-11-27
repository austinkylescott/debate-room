// Throwaway: proves CI goes red on a failing test (#73). Reverted next commit.
import { expect, test } from "vite-plus/test";

test("CI fails on a failing assertion", () => {
  expect(1 + 1).toBe(3);
});
