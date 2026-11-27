// The desks' common password (Aryan, 19 Nov; back on 27 Nov: "Management, Finance and Dispatch had
// a common password only, bring it back"). What must hold: off until the company's Admin types one;
// only the Admin or the CEO sets it, and it is never shown; it opens that desk's shared screen in
// the desk's name; nobody's own leave, payslips, messages or password on it; five wrong tries close
// that desk's screen for a while; a new password closes the screens open; what is done on an order
// is written in the name of the person it was given to; each person's own login stays as it was.

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import { ticked } from "../testing/approve";
import type { Me } from "../types";

const PASSWORD = "test-password-1";
const DESK = "desk-words-2026";
let db: Database;
let app: ReturnType<typeof createApp>;

const request = (path: string, cookie = "", body?: unknown) =>
  app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";
const codeOf = async (response: Response) => ((await response.json()) as { error?: { code: string } }).error?.code;
const signIn = async (who: string) => {
  const response = await request("/api/auth/login", "", { email: `${who}@2mg.test`, password: PASSWORD });
  expect(response.status, who).toBe(200);
  return cookieOf(response);
};
const openDesk = (desk: string, password: string) => request("/api/auth/desk", "", { desk, password });
const idOf = async (name: string) =>
  (await rows<{ id: number }>(db, sql`select id::int as id from person where name = ${name}`))[0]?.id as number;

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  // A second person at Management, with the demo password.
  await db.execute(
    sql`insert into person (name, email, role, title, password_hash, active)
      select 'Kate', 'kate@2mg.test', 'management', 'Desk', password_hash, true from person where name = 'Sarla'`,
  );
  app = createApp(db, { webUrl: "http://localhost:5180" });
}, 120_000);

describe("the desks' common password", () => {
  it("is off until the Admin types one, and only the Admin or the CEO may", async () => {
    expect(await (await request("/api/auth/desk")).json()).toEqual({ on: false });
    expect(await codeOf(await openDesk("finance", DESK))).toBe("desk_off");

    const fiona = await signIn("fiona");
    expect((await request("/api/settings/desk-password", fiona, { password: DESK })).status).toBe(403);
    const admin = await signIn("admin");
    expect((await request("/api/settings/desk-password", admin, { password: "short" })).status).toBe(400);
    expect((await request("/api/settings/desk-password", admin, { password: DESK })).status).toBe(200);

    expect(await (await request("/api/auth/desk")).json()).toEqual({ on: true });
    const settings = await (await request("/api/settings", admin)).text();
    expect(JSON.parse(settings).deskPassword).toMatchObject({ on: true, savedBy: "Admin" });
    // Never the password, nor its hash.
    expect(settings).not.toContain(DESK);
    expect(settings).not.toContain("scrypt");
    const [kept] = await rows<{ value: string }>(db, sql`select value::text as value from setting where key = 'desk_password'`);
    expect(kept?.value).not.toContain(DESK);
  });

  it("opens the desk's shared screen in the desk's name, until the working day ends", async () => {
    const response = await openDesk("finance", DESK);
    expect(response.status, await response.clone().text()).toBe(200);
    const { me } = (await response.json()) as { me: Me };
    expect(me).toMatchObject({ name: "Finance desk", role: "finance", deskScreen: "finance", email: null, photo: null });
    expect(response.headers.get("set-cookie")).toMatch(/Expires=/i);
    const screen = cookieOf(response);
    expect(((await (await request("/api/me", screen)).json()) as { me: Me }).me.deskScreen).toBe("finance");
    // The desk's work opens; nobody's own things do.
    expect((await request("/api/desk/finance/team", screen)).status).toBe(200);
    for (const path of ["/api/hr/leave/mine", "/api/hr/payslips/mine", "/api/hr/my-day", "/api/messages", "/api/me/profile"])
      expect(await codeOf(await request(path, screen)), path).toBe("desk_screen");
    expect(await codeOf(await request("/api/auth/password", screen, { current: DESK, next: "anything-new-1" }))).toBe("desk_screen");
    expect(await codeOf(await request("/api/auth/two-step/start", screen, {}))).toBe("desk_screen");
    // Each person starts themselves, on their own login.
    expect((await request(`/api/desk/finance/people/${await idOf("Fiona")}/start`, screen, { on: true })).status).toBe(403);
  });

  it("refuses a wrong password, and closes that desk's screen after five, never anyone's own login", async () => {
    expect(await codeOf(await openDesk("dispatch", "not-the-words"))).toBe("wrong_login");
    for (let i = 0; i < 4; i += 1) await openDesk("dispatch", `wrong-${i}`);
    expect(await codeOf(await openDesk("dispatch", DESK))).toBe("locked");
    // Another desk's screen, and Marco's own login, are untouched.
    expect((await openDesk("management", DESK)).status).toBe(200);
    expect((await request("/api/auth/login", "", { email: "marco@2mg.test", password: PASSWORD })).status).toBe(200);
  });

  it("writes what is done on an order in the name of the person it was given to", async () => {
    const screenResponse = await openDesk("management", DESK);
    const screen = cookieOf(screenResponse);
    const { me } = (await screenResponse.json()) as { me: Me };
    // The other Management person starts, on their own login, and is given the order.
    const other = me.id === (await idOf("Kate")) ? "sarla" : "kate";
    const otherId = await idOf(other === "kate" ? "Kate" : "Sarla");
    const own = await signIn(other);
    expect((await request(`/api/desk/management/people/${otherId}/start`, own, { on: true })).status).toBe(200);
    const ryan = await signIn("ryan");
    const added = await request("/api/customers", own, { kind: "hospital", name: "Desk Hospital", city: "Pasay" });
    expect(added.status, await added.clone().text()).toBe(200);
    const customer = (await added.json()) as { id: number };
    const [medicine] = await rows<{ id: number }>(
      db,
      sql`select m.id::int as id from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' limit 1`,
    );
    const made = await request("/api/orders", ryan, {
      customerId: customer.id,
      items: [{ medicineId: medicine?.id, qty: 1, priceKind: "hospital" }],
      paymentTerm: "NET 30",
    });
    expect(made.status, await made.clone().text()).toBe(200);
    const { id } = (await made.json()) as { id: number };
    // Shared out to whoever has started (the next request at the desk does it).
    await request("/api/desk/management/team", screen);
    const [given] = await rows<{ by: number }>(db, sql`select manage_by::int as by from sales_order where id = ${id}`);
    expect(given?.by).toBe(otherId);

    const approved = await request(await ticked(db, `/api/orders/${id}/approve`), screen, {});
    expect(approved.status, await approved.clone().text()).toBe(200);
    const [row] = await rows<{ by: number }>(db, sql`select approved_by::int as by from sales_order where id = ${id}`);
    expect(row?.by).toBe(otherId);
  });

  it("closes every desk screen open when the password changes, and all of them when it is taken off", async () => {
    const screen = cookieOf(await openDesk("management", DESK));
    expect((await request("/api/me", screen)).status).toBe(200);
    const admin = await signIn("admin");
    expect((await request("/api/settings/desk-password", admin, { password: "new-desk-words-1" })).status).toBe(200);
    expect((await request("/api/me", screen)).status).toBe(401);
    expect(await codeOf(await openDesk("management", DESK))).toBe("wrong_login");
    expect((await openDesk("management", "new-desk-words-1")).status).toBe(200);

    expect((await request("/api/settings/desk-password", admin, { password: null })).status).toBe(200);
    expect(await codeOf(await openDesk("management", "new-desk-words-1"))).toBe("desk_off");
    expect(await rows(db, sql`select 1 from session where desk is not null`)).toEqual([]);
  });
});
