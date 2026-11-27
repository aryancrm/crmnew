import { describe, expect, it } from "vitest";
import { localOpenAllowed } from "./local-open";

// The no-password door is for a developer's own computer only: never where the live server runs.
describe("open as anyone, this computer only", () => {
  const local = "http://localhost:5180";
  it("is on for the local copy", () => {
    expect(localOpenAllowed({}, local)).toBe(true);
  });
  it("is off online and whenever any guard fails", () => {
    expect(localOpenAllowed({ DATABASE_URL: "postgres://x" }, local)).toBe(false);
    expect(localOpenAllowed({}, "https://one.bishnoi.ai")).toBe(false);
    expect(localOpenAllowed({}, "http://one.bishnoi.ai")).toBe(false);
    expect(localOpenAllowed({ NODE_ENV: "production" }, local)).toBe(false);
    expect(localOpenAllowed({ LOCAL_OPEN: "off" }, local)).toBe(false);
  });
});
