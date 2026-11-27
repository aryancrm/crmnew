import { describe, expect, it } from "vitest";
import { hqOfSeat } from "../team/hq-name";
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
  it("is On site for an on-site HQ the head made, whoever works it or nobody (PLAN 264)", () => {
    expect(placeOf(seat("B2C | ON SITE"))).toBe("On site");
    expect(placeOf({ area: { name: "B2C | ON SITE | 2" }, person: null })).toBe("On site");
  });

  it("is a seller's HQ on the team's pages, and none for a lead (PLAN 265)", () => {
    expect(hqOfSeat({ lead: false, area: { name: "RX | TAFT" }, person: { name: "Marwin Dy" } })).toBe("TAFT");
    expect(hqOfSeat({ lead: false, area: { name: "B2C | Rachelle Upao" }, person: { name: "Rachelle Upao" } })).toBe("ON SITE");
    expect(hqOfSeat({ lead: true, area: { name: "RX | NCL" }, person: { name: "Honey Cordero" } })).toBeNull();
    expect(hqOfSeat({ lead: false, area: null, person: { name: "Kim" } })).toBeNull();
  });
});
