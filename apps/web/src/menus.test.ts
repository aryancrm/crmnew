// Each MedRep's menu as it stands (the medrep branch, 25 Nov): the menu code is being tidied (one
// Tenders folder, one Calls link, the channel's words from seat-words.ts), and every MedRep must
// see exactly the same menu after it. The snapshot is today's menus; a change shows here first.

import type { Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { allItems, folderOpen, type MenuItem, type Space, spaceFor } from "./menus";

type Seat = { channel: string | null; title: string; business?: string | null };

/** The MedRep seats, one of each kind of menu (docs/PLAN.md 16; menus.ts, case "medrep"). */
const MEDREPS: Record<string, Seat> = {
  "Hospital CHC": { channel: "HOSP", title: "Hospital CHC" },
  "Hospital bidding coachee": { channel: "HOSP", title: "Government Account Bidding Coachee" },
  "Rx CHC": { channel: "RX", title: "Rx CHC" },
  "B2B NBD": { channel: "B2B", title: "NBD Telesales" },
  "B2B CRR": { channel: "B2B", title: "CRR Telesales" },
  "Government Bidding": { channel: "BID", title: "Bidding Coachee" },
  CLIDP: { channel: "B2B", title: "CLIDP Sales Coach" },
  "MD Telesales Anesthesia": { channel: "TS", title: "MD Telesales", business: "HOSP" },
  "MD Telesales Oncology": { channel: "TS", title: "MD Telesales", business: "RX" },
  "PAP MedRep": { channel: "PAP", title: "PAP Officer" },
  "Online B2C": { channel: "ONLINE", title: "B2C CHC" },
  "Any other MedRep": { channel: "MT", title: "MedRep" },
  "MedRep with no channel": { channel: null, title: "MedRep" },
};

const medrep = (seat: Seat): Me =>
  ({
    id: 9,
    name: "Test MedRep",
    email: null,
    title: seat.title,
    role: "medrep",
    roleLabel: "MedRep",
    channel: seat.channel ? { code: seat.channel, name: seat.channel, division: null } : null,
    business: seat.business ?? null,
    divisions: [],
    reportsTo: null,
  }) as unknown as Me;

/** A menu as plain words: each link's page, name, icon, badge and tab name, folders with theirs. */
const item = (one: MenuItem): unknown => ({
  to: one.to,
  label: one.label,
  icon: (one.icon as { displayName?: string }).displayName ?? "?",
  ...(one.badge ? { badge: one.badge } : {}),
  ...(one.short ? { short: one.short } : {}),
  ...(one.teams ? { teams: true } : {}),
  ...(one.children ? { children: one.children.map(item) } : {}),
});
const plain = (space: Space) => ({
  desk: space.label,
  cta: space.cta ?? null,
  cta2: space.cta2 ?? null,
  tabs: space.tabs?.map(item) ?? null,
  groups: space.groups.map((group) => ({
    ...(group.title ? { title: group.title } : {}),
    ...(group.divider ? { divider: true } : {}),
    items: group.items.map(item),
  })),
});

describe("each MedRep's menu", () => {
  for (const [kind, seat] of Object.entries(MEDREPS))
    it(`${kind} sees the same menu`, () => {
      expect(plain(spaceFor(medrep(seat), "/"))).toMatchSnapshot();
    });
});

/** Every page a menu links to, folders opened. */
const pages = (space: Space) => allItems(space.groups.flatMap((group) => group.items)).map((one) => one.to);

describe("office or field (docs/PLAN.md 29)", () => {
  const as = (seat: Seat, works: "office" | "field") => spaceFor({ ...medrep(seat), works } as Me, "/");

  it("a seat that works as its channel does keeps the same menu", () => {
    expect(plain(as(MEDREPS["Hospital CHC"] as Seat, "field"))).toEqual(plain(spaceFor(medrep(MEDREPS["Hospital CHC"] as Seat), "/")));
    expect(plain(as(MEDREPS["B2B CRR"] as Seat, "office"))).toEqual(plain(spaceFor(medrep(MEDREPS["B2B CRR"] as Seat), "/")));
  });

  it("an office seat has no visits, tour plan, field expenses or samples, and no Log a call", () => {
    for (const kind of ["Hospital CHC", "Rx CHC", "PAP MedRep"]) {
      const space = as(MEDREPS[kind] as Seat, "office");
      for (const page of ["/field", "/visits", "/field/plan", "/visits/expenses", "/me/samples"])
        expect(pages(space), `${kind} ${page}`).not.toContain(page);
      expect(space.cta2?.to, kind).not.toBe("/field");
      // Their own work stays: the orders, the customers.
      expect(pages(space), kind).toContain("/orders");
    }
  });

  it("a field seat in a channel that sells by phone gets the visits folder", () => {
    const space = as(MEDREPS["B2B NBD"] as Seat, "field");
    expect(pages(space)).toEqual(expect.arrayContaining(["/visits", "/field/plan", "/visits/expenses"]));
    const labels = space.groups[0]?.items.map((one) => one.label) ?? [];
    expect(labels.indexOf("Visits")).toBe(labels.indexOf("My numbers") - 1);
  });
});

/** The folders lit (open, in green) on a page. */
const litFolders = (space: Space, to: string) => {
  const [pathname = "", query] = to.split("?");
  const location = { pathname, search: query ? `?${query}` : "" };
  const every = allItems(space.groups.flatMap((group) => group.items));
  return space.groups
    .flatMap((group) => group.items)
    .filter((one) => one.children && folderOpen(one, location, every))
    .map((one) => one.label);
};

describe("the sidebar lights one folder at a time", () => {
  it("on All my customers (/field/clients) the Hospital CHC's Hospitals, not Visits (My day is /field)", () => {
    const space = spaceFor(medrep(MEDREPS["Hospital CHC"] as Seat), "/field/clients");
    expect(litFolders(space, "/field/clients")).toEqual(["Hospitals"]);
    expect(litFolders(space, "/field")).toEqual(["Visits"]);
    expect(litFolders(space, "/field/plan")).toEqual(["Visits"]);
  });

  for (const [kind, seat] of Object.entries(MEDREPS))
    it(`${kind}: every link's page lights at most one folder`, () => {
      const space = spaceFor(medrep(seat), "/");
      for (const link of allItems(space.groups.flatMap((group) => group.items)).filter((one) => !one.children)) {
        const lit = litFolders(space, link.to);
        expect(lit.length, `${link.label} (${link.to}) lights ${lit.join(", ")}`).toBeLessThanOrEqual(1);
      }
    });
});
