// The customer page guides each seller (work.ts): who they are, their buttons.
import type { Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { actionsFor, sellerKind } from "./work";

const seat = (role: string, channel: string | null) =>
  ({ role, channel: channel ? { code: channel, name: channel, division: null } : null }) as unknown as Pick<Me, "role" | "channel">;

describe("who the seller is", () => {
  it("by their seat's channel", () => {
    expect(sellerKind(seat("medrep", "HOSP"))).toBe("field");
    expect(sellerKind(seat("medrep", null))).toBe("field");
    expect(sellerKind(seat("medrep", "RX"))).toBe("rx");
    expect(sellerKind(seat("medrep", "PAP"))).toBe("pap");
    for (const code of ["TS", "B2B", "BID", "ONLINE"]) expect(sellerKind(seat("medrep", code))).toBe("phone");
    expect(sellerKind(seat("online", null))).toBe("phone");
    expect(sellerKind(seat("team_lead", "HOSP"))).toBe("lead");
    expect(sellerKind(seat("finance", null))).toBe("desk");
  });
});

describe("the buttons on a customer", () => {
  const all = { order: true, visit: true, call: true, directions: true };
  it("in the field: order, visit, call, directions", () => {
    expect(actionsFor("field", all)).toEqual(["order", "visit", "call", "directions"]);
  });
  it("by phone: the call first, no visit", () => {
    expect(actionsFor("phone", all)).toEqual(["call", "order", "directions"]);
  });
  it("only what they may do", () => {
    expect(actionsFor("field", { order: true, visit: false, call: false, directions: false })).toEqual(["order"]);
    expect(actionsFor("desk", { order: false, visit: false, call: false, directions: true })).toEqual(["directions"]);
  });
});
