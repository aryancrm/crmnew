import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedPapRep } from "../orders/seed-team";
import { seedDemo } from "../seed";
import { attachReceipt } from "../testing/receipt";
import type { Catalogue, LeadCase, LeadDesk, OrderDetail } from "../types";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine: { id: number; price: number };

const get = (who: string, path: string) =>
  app.request(path, { headers: { cookie: cookies[who] as string } });
const read = async <T>(who: string, path: string) => (await (await get(who, path)).json()) as T;
const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const lead = (who: string, id: number) => read<LeadCase>(who, `/api/leads/${id}`);
const file = (who: string, id: number, kind: string) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set(
    "file",
    new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], `${kind}.png`, {
      type: "image/png",
    }),
  );
  return app.request(`/api/leads/${id}/files`, {
    method: "POST",
    headers: { cookie: cookies[who] as string },
    body: form,
  });
};
const shift = (days: number) =>
  new Date(Date.parse(`${todayManila()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  expect(await seedPapRep(db, PASSWORD)).toBe(true);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["paula", "jane", "sarla", "fiona", "marco", "ryan", "naresh"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const catalogue = await read<Catalogue>("sarla", "/api/inventory/medicines");
  const row = catalogue.rows.find(
    (item) => item.prices.patient !== undefined && item.total >= 200 && item.rx,
  );
  if (!row) throw new Error("no prescription medicine with a patient price and stock");
  medicine = { id: row.id, price: row.prices.patient as number };
});

describe("PAP cases", () => {
  it("a PAP MedRep walks a guarantee-letter case to the agency's claim; only they see it", async () => {
    // Only a guarantee letter's road.
    expect(
      (
        await post("paula", "/api/leads", {
          source: "referral",
          name: "Lorna Cruz",
          road: "regular",
        })
      ).status,
    ).toBe(400);
    const made = await post("paula", "/api/leads", {
      source: "referral",
      name: "Lorna Cruz",
      phone: "0917 222 3344",
      city: "Manila",
      road: "gl",
      agency: "pcso",
    });
    expect(made.status).toBe(200);
    const id = ((await made.json()) as { id: number }).id;

    // Hers alone: not the Online desk's, not another MedRep's; Management reads it.
    const mine = await read<LeadDesk>("paula", "/api/leads?desk=pap&queue=all");
    expect(mine.cards.map((card) => card.id)).toContain(id);
    expect(mine.can.add).toBe(true);
    const online = await read<LeadDesk>("jane", "/api/leads?queue=all");
    expect(online.cards.map((card) => card.id)).not.toContain(id);
    expect((await get("jane", `/api/leads/${id}`)).status).toBe(404);
    expect((await get("ryan", `/api/leads/${id}`)).status).toBe(403);
    expect((await get("ryan", "/api/leads?desk=pap")).status).toBe(403);
    const seen = await lead("sarla", id);
    expect(seen.lead.desk).toBe("pap");
    expect(seen.can.work).toBe(false);
    expect((await lead("paula", id)).can.work).toBe(true);

    // The quotation, PCSO's two other vendors, the application and the letter.
    expect(
      (
        await post("paula", `/api/leads/${id}/quote`, {
          lines: [{ medicineId: medicine.id, qty: 4 }],
        })
      ).status,
    ).toBe(200);
    const total = medicine.price * 4;
    expect(
      (
        await post("paula", `/api/leads/${id}/canvass`, {
          lines: [
            { vendor: "MedExpress Pharma", amount: total + 5000 },
            { vendor: "Rose Pharmacy", amount: total + 9000 },
          ],
        })
      ).status,
    ).toBe(200);
    expect((await lead("paula", id)).lead.canvass).toHaveLength(2);
    const pdf = await get("paula", `/api/leads/${id}/quotation.pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    // Ours, then one page for each other vendor.
    const printed = await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()));
    expect(printed.getPageCount()).toBe(3);
    await post("paula", `/api/leads/${id}/gl`, { appliedOn: todayManila() });
    await file("paula", id, "gl_letter");
    // An expired letter is refused.
    expect(
      (
        await post("paula", `/api/leads/${id}/gl`, {
          appliedOn: todayManila(),
          letterNo: "PCSO-777",
          amount: total,
          letterOn: todayManila(),
          expiresOn: shift(-1),
          verify: true,
        })
      ).status,
    ).toBe(400);
    // A letter for less than the quotation can't carry the order.
    await post("paula", `/api/leads/${id}/gl`, {
      appliedOn: todayManila(),
      letterNo: "PCSO-777",
      amount: total - 100,
      letterOn: todayManila(),
      expiresOn: shift(30),
      verify: true,
    });
    await file("paula", id, "rx");
    await file("paula", id, "valid_id");
    await file("paula", id, "med_cert");
    let now = await lead("paula", id);
    expect(now.step.value).toBe("verify");
    expect(now.next).toContain("is more than the letter");
    expect(now.can.placeOrder).toBe(false);
    await post("paula", `/api/leads/${id}/gl`, {
      appliedOn: todayManila(),
      letterNo: "PCSO-777",
      amount: total,
      letterOn: todayManila(),
      expiresOn: shift(30),
      verify: true,
    });
    now = await lead("paula", id);
    expect(now.step.value).toBe("ready");

    // The order is Paula's, and goes the MedRep's way: Management, then Finance, then Dispatch.
    const placed = await post("paula", `/api/leads/${id}/order`);
    expect(placed.status).toBe(200);
    const orderId = ((await placed.json()) as { id: number }).id;
    let order = await read<OrderDetail>("sarla", `/api/orders/${orderId}`);
    expect(order.order).toMatchObject({ status: "pending_approval", medrep: "Paula" });
    expect(order.order.channel).toBe("PAP");
    expect((await post("sarla", `/api/orders/${orderId}/approve`, { finance: true })).status).toBe(
      200,
    );
    order = await read<OrderDetail>("fiona", `/api/orders/${orderId}`);
    expect(order.order.status).toBe("ready_for_invoice");
    expect((await post("fiona", `/api/finance/orders/${orderId}/invoice`, {})).status).toBe(200);
    expect((await post("marco", `/api/dispatch/orders/${orderId}/pack`, {})).status).toBe(200);
    await post("marco", `/api/dispatch/orders/${orderId}/ship`, {
      method: "courier",
      courier: "LBC",
      tracking: "5512",
    });
    // Before the delivery, no pick-up photo and no claim.
    expect((await file("paula", id, "pickup_photo")).status).toBe(409);
    expect(await attachReceipt(app, cookies.marco as string, orderId)).toBe(200);
    expect(
      (
        await post("marco", `/api/dispatch/orders/${orderId}/deliver`, {
          receivedBy: "Lorna Cruz",
          deliveredOn: todayManila(),
        })
      ).status,
    ).toBe(200);

    // The claim: the pick-up photo, then sent to PCSO; Finance records the agency's money.
    now = await lead("paula", id);
    expect(now.step.value).toBe("claim");
    expect(now.next).toBe("Delivered: add the pick-up photo, then send the claim to PCSO");
    expect(
      (await post("paula", `/api/leads/${id}/claim`, { sentOn: todayManila(), ref: "CL-1" }))
        .status,
    ).toBe(400);
    expect((await file("paula", id, "pickup_photo")).status).toBe(200);
    expect(
      (await post("paula", `/api/leads/${id}/claim`, { sentOn: todayManila(), ref: "CL-1" }))
        .status,
    ).toBe(200);
    now = await lead("paula", id);
    expect(now.step.value).toBe("billed");
    expect(now.next).toBe("Claim sent: waiting for PCSO to pay");
    expect(now.lead).toMatchObject({ claimSentOn: todayManila(), claimRef: "CL-1" });
    // The agency's money is Finance's to record, not the MedRep's.
    expect(now.can).toMatchObject({ pay: false, deliver: false });
  });

  it("keeps a PAP MedRep to their own cases", async () => {
    const [other] = await rows<{ id: number }>(
      db,
      sql`insert into lead (desk, source, name, road, agency, assigned_to) values ('pap', 'referral', 'Someone Else', 'gl', 'dswd', null) returning id::int as id`,
    );
    expect((await get("paula", `/api/leads/${other?.id}`)).status).toBe(404);
    expect((await post("paula", `/api/leads/${other?.id}/note`, { message: "hi" })).status).toBe(
      404,
    );
    const cards = (await read<LeadDesk>("paula", "/api/leads?desk=pap&queue=all")).cards;
    expect(cards.map((card) => card.id)).not.toContain(other?.id);
  });
});
