import { describe, expect, it } from "vitest";
import { freshPassword } from "./service";

describe("one-time passwords", () => {
  it("are 12 letters and digits with none that reads as another (0/O, 1/I/l, 5/S…)", () => {
    for (let i = 0; i < 2000; i++) {
      const password = freshPassword();
      expect(password).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(password).not.toMatch(/[0Oo1Iil5Ss2Zz8BUuVv]/);
    }
  });
});
