// Each MedRep's menu as it stands (the medrep branch, 25 Nov): the menu code is being tidied (one
// Tenders folder, one Calls link, the channel's words from seat-words.ts), and every MedRep must
// see exactly the same menu after it. The snapshot is today's menus; a change shows here first.

import type { Me } from "@2mg/api/types";
import { describe, expect, it } from "vitest";
import { type MenuItem, type Space, spaceFor } from "./menus";

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
