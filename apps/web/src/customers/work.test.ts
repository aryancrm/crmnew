// The customer page guides each seller (work.ts): who they are, their buttons, what's next.
import type { ClientPage } from "@2mg/api/mr";
import type { CustomerPage, Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { actionsFor, nextSteps, sellerKind } from "./work";

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

const TODAY = "2026-11-25";
const page = (over: Partial<Pick<CustomerPage, "orders" | "refill">> & { overdue?: number; licence?: "ok" | "soon" | "expired" } = {}) =>
  ({
    customer: { id: 2, licenceState: over.licence ?? "ok", review: "ok" },
    totals: { overdue: over.overdue ?? 0, owed: over.overdue ?? 0 },
    orders: over.orders ?? [],
    refill: over.refill ?? { nextOn: null, lastOn: null },
  }) as unknown as Pick<CustomerPage, "customer" | "totals" | "orders" | "refill">;
const order = (id: number, status: string) => ({ id, code: `2MG-${id}`, status, statusLabel: status === "on_hold" ? "On hold" : "Pending Management Approval", medicines: "Anastrozole" });
const field = (next: { id: number; day: string } | null, lastDone: string | null) =>
  ({
    client: { nextVisit: next, prefDays: ["tue"], prefTime: "AM" },
    history: lastDone ? [{ day: lastDone, status: "done" }] : [],
  }) as unknown as ClientPage;
const can = { order: true, visit: true, call: true };

describe("what's next with them", () => {
  it("nothing waiting: an empty list", () => {
    expect(nextSteps(page(), null, can, TODAY)).toEqual([]);
  });

  it("the most urgent first: overdue, then a stuck order, then a reorder, then visits and orders on the way", () => {
    const steps = nextSteps(
      page({
        overdue: 780_000,
        orders: [order(5, "pending_approval"), order(2, "on_hold")] as unknown as CustomerPage["orders"],
        refill: { nextOn: "2026-11-27", lastOn: "2026-10-28" } as CustomerPage["refill"],
      }),
      field({ id: 9, day: "2026-12-01" }, "2026-11-10"),
      can,
      TODAY,
    );
    expect(steps.map((step) => step.key)).toEqual(["overdue", "order-2", "reorder", "visit", "moving"]);
    expect(steps[0]).toMatchObject({ text: "Overdue ₱7,800", go: { label: "Call them", action: "call" } });
    expect(steps[1]).toMatchObject({ text: "Order 2MG-2 is on hold", go: { to: "/orders/2" } });
    expect(steps[3]).toMatchObject({ go: { to: "/visits/9" }, sub: "Best tue · AM" });
  });

  it("no call allowed: the statement instead", () => {
    const [overdue] = nextSteps(page({ overdue: 100 }), null, { ...can, call: false }, TODAY);
    expect(overdue?.go).toEqual({ label: "Statement", to: "/customers/2/statement" });
  });

  it("no visit planned: add one, flagged when the last was over 30 days ago", () => {
    const [recent] = nextSteps(page(), field(null, "2026-11-10"), can, TODAY);
    expect(recent).toMatchObject({ text: "No visit planned · last one 15 days ago", tone: "info", go: { action: "visit" } });
    const [old] = nextSteps(page(), field(null, "2026-09-01"), can, TODAY);
    expect(old?.tone).toBe("warn");
    expect(nextSteps(page(), field(null, null), can, TODAY)[0]?.text).toBe("No visit planned · never visited");
  });

  it("a licence expiring points at the papers; a reorder far off says nothing", () => {
    const steps = nextSteps(page({ licence: "soon", refill: { nextOn: "2026-12-20", lastOn: null } as CustomerPage["refill"] }), null, can, TODAY);
    expect(steps.map((step) => step.key)).toEqual(["licence"]);
    expect(steps[0]?.go).toEqual({ label: "Papers", papers: true });
  });
});
