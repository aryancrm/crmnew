import { describe, expect, it } from "vitest";
import { placeOf } from "./sales-tree";

// A person's area on the team's tree (27 Nov): never their own name.
describe("a person's area on the tree", () => {
  const seat = (area: string | null, name = "Marwin Dy") => ({ area: area ? { name: area } : null, person: { name } });
  it("is the territory's last part", () => {
    expect(placeOf(seat("RX | NCR 1"))).toBe("NCR 1");
    expect(placeOf(seat("RX | North & Central Luzon (Onco) | Marwin Dy"))).toBe("North & Central Luzon (Onco)");
    expect(placeOf(seat("RX | Blood & Bone Care | Marwin Dy"))).toBe("Blood & Bone Care");
  });
  it("is On site when the territory is only the channel and the person", () => {
    expect(placeOf(seat("B2C | Mary Jane Vinas", "Mary Jane Viñas"))).toBe("On site");
    expect(placeOf(seat(null))).toBe("On site");
  });
});
