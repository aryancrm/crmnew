// A case's own steps emailed to the customer by themselves (Aryan, 26 Nov: "everything was
// automatic" in the old CRM): off until the Admin switches them on; then thank you for contacting
// us, the quotation with its PDF (PCSO's once all three are there), the guarantee letter received
// and verified, each once.

import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { todayManila } from "../inventory/rules";
import { seedPapRep } from "../orders/seed-team";
import { seedDemo } from "../seed";
import type { Catalogue, Me } from "../types";
import { connectMailbox, type OutgoingMail, useMailTransport } from "./email";

const PASSWORD = "test-password-1";
let db: Database;
let app: ReturnType<typeof createApp>;
const cookies: Record<string, string> = {};
let medicine = 0;
const outbox: OutgoingMail[] = [];

const post = (who: string, path: string, body: unknown = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies[who] as string },
    body: JSON.stringify(body),
  });
const idOf = async (response: Response) => {
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as { id: number }).id;
};
/** The emails to one address, once those sent after the answer have gone. */
async function mailTo(to: string, count: number): Promise<OutgoingMail[]> {
  for (let tries = 0; tries < 100 && outbox.filter((mail) => mail.to === to).length < count; tries++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 100));
  return outbox.filter((mail) => mail.to === to);
}
const switchOn = (events: Partial<Record<string, boolean>> = {}) =>
  post("admin", "/api/settings/case-emails", {
    enabled: true,
    events: { enquiry: true, quotation: true, gl_received: true, gl_verified: true, ...events },
  });

beforeAll(async () => {
  useMailTransport({
    check: async () => ({ error: null, cursor: { uidValidity: "1", lastUid: 0 } }),
    read: async () => ({ cursor: { uidValidity: "1", lastUid: 0 }, sources: [] }),
    send: async (_mailbox, mail) => {
      outbox.push(mail);
    },
  });
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  await seedPapRep(db, PASSWORD);
  app = createApp(db, { webUrl: "http://localhost:5180" });
  for (const name of ["jane", "paula", "admin"]) {
    const response = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `${name}@2mg.test`, password: PASSWORD }),
    });
    cookies[name] = response.headers.get("set-cookie")?.split(";")[0] as string;
  }
  const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where email = 'admin@2mg.test'`);
  await connectMailbox(db, { id: admin?.id, name: "Admin", role: "admin" } as Me, {
    address: "hello@company.test",
    password: "app-pass-for-tests",
    imapHost: "imap.company.test",
    imapPort: 993,
    smtpHost: "smtp.company.test",
    smtpPort: 465,
  });
  const catalogue = (await (await app.request("/api/inventory/medicines", { headers: { cookie: cookies.admin as string } })).json()) as Catalogue;
  const row = catalogue.rows.find((item) => item.prices.patient !== undefined && item.total >= 50);
  if (!row) throw new Error("no medicine with a patient price and stock");
  medicine = row.id;
}, 180_000);
afterAll(() => useMailTransport(null));

describe("automatic emails on a case", () => {
  it("sends nothing until the Admin switches them on", async () => {
    await idOf(await post("jane", "/api/leads", { source: "phone", name: "Carla Diaz", email: "carla@example.test" }));
    expect(await mailTo("carla@example.test", 1)).toEqual([]);
    // Only the Admin or the CEO switches them.
    expect((await post("jane", "/api/settings/case-emails", { enabled: true, events: { enquiry: true, quotation: true, gl_received: true, gl_verified: true } })).status).toBe(403);
    expect((await switchOn()).status).toBe(200);
  });

  it("thanks a new enquiry once, and emails its quotation with the PDF once per save", async () => {
    const id = await idOf(await post("jane", "/api/leads", { source: "phone", name: "Maria Santos", email: "maria@example.test" }));
    const thanked = await mailTo("maria@example.test", 1);
    expect(thanked).toHaveLength(1);
    expect(thanked[0]?.subject).toMatch(/^We got your message \(ENQ-/);
    expect(thanked[0]?.text).toContain("Thank you for contacting");

    expect((await post("jane", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine, qty: 2 }] })).status).toBe(200);
    const quoted = await mailTo("maria@example.test", 2);
    expect(quoted).toHaveLength(2);
    expect(quoted[1]?.attachments?.[0]?.contentType).toBe("application/pdf");
    const [events] = await rows<{ n: number }>(db, sql`select count(*)::int as n from lead_event where lead_id = ${id} and message like 'Emailed the customer: Quotation%'`);
    expect(events?.n).toBe(1);
  });

  it("emails PCSO's quotations once all three are there, then the letter received and verified, once each", async () => {
    const id = await idOf(
      await post("paula", "/api/leads", { source: "referral", name: "Lito Reyes", email: "lito@example.test", phone: "0917 444 5566", road: "gl", agency: "pcso" }),
    );
    expect(await mailTo("lito@example.test", 1)).toHaveLength(1);
    // Ours alone isn't PCSO's application: nothing until the other two vendors' are there.
    await post("paula", `/api/leads/${id}/quote`, { lines: [{ medicineId: medicine, qty: 1 }] });
    expect(await mailTo("lito@example.test", 2)).toHaveLength(1);
    await post("paula", `/api/leads/${id}/canvass`, { lines: [{ vendor: "MedExpress", amount: 900000 }, { vendor: "Rose Pharmacy", amount: 950000 }] });
    const sent = await mailTo("lito@example.test", 2);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.text).toContain("the 3 quotations PCSO (IMAP) asks for");
    const pdf = sent[1]?.attachments?.[0]?.content as Uint8Array;
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(3);

    const gl = (verify: boolean) =>
      post("paula", `/api/leads/${id}/gl`, { appliedOn: todayManila(), letterNo: "PCSO-77", amount: 900000, letterOn: todayManila(), verify });
    expect((await gl(false)).status).toBe(200);
    // On the case's email conversation (a reply in it, so its subject is the thread's).
    const received = await mailTo("lito@example.test", 3);
    expect(received[2]?.text).toContain("We received your guarantee letter no. PCSO-77 from PCSO for ₱9,000.00");
    await gl(false);
    expect(await mailTo("lito@example.test", 4)).toHaveLength(3);
    const form = new FormData();
    form.set("kind", "gl_letter");
    form.set("file", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])], "letter.png", { type: "image/png" }));
    expect((await app.request(`/api/leads/${id}/files`, { method: "POST", headers: { cookie: cookies.paula as string }, body: form })).status).toBe(200);
    expect((await gl(true)).status).toBe(200);
    const verified = await mailTo("lito@example.test", 4);
    expect(verified[3]?.text).toContain("is verified. Your order goes ahead now");
    await gl(true);
    expect(await mailTo("lito@example.test", 5)).toHaveLength(4);
  });

  it("sends none of a step switched off", async () => {
    expect((await switchOn({ enquiry: false })).status).toBe(200);
    await idOf(await post("jane", "/api/leads", { source: "phone", name: "Pia Lopez", email: "pia.lopez@example.test" }));
    expect(await mailTo("pia.lopez@example.test", 1)).toEqual([]);
  });

  it("lets the PAP person answer her own case by email (Aryan, 26 Nov), and nobody else's", async () => {
    const [mine] = await rows<{ id: number }>(db, sql`select id::int as id from lead where email = 'lito@example.test'`);
    const id = mine?.id as number;
    const thread = await app.request(`/api/leads/${id}/thread`, { headers: { cookie: cookies.paula as string } });
    expect(thread.status).toBe(200);
    expect(((await thread.json()) as { can: { reply: boolean } }).can.reply).toBe(true);
    expect((await post("paula", `/api/leads/${id}/reply`, { text: "Your quotations are attached above." })).status).toBe(200);
    expect((await mailTo("lito@example.test", 5)).at(-1)?.text).toContain("Your quotations are attached above.");
    // Not an Online desk case of hers.
    expect((await post("paula", `/api/leads/${await idOf(await post("jane", "/api/leads", { source: "phone", name: "Ana Cruz", email: "ana.cruz@example.test" }))}/reply`, { text: "Hi" })).status).toBeGreaterThanOrEqual(400);
  });
});
