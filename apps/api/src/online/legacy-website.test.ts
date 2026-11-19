import { randomBytes, scryptSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { passwordMatches } from "../auth/password";
import { type Database, openDatabase, rows } from "../db/index";
import { migrate } from "../db/migrate";
import { seedFixture } from "../inventory/fixture";
import { seedDemo } from "../seed";
import { convertOldHash, importOldWebsite, type OldWebsite } from "./legacy-website";

let db: Database;
let old: OldWebsite;
const PASSWORD = "test-password-1";

// The old points sign-in's hash, made as the old CRM made it (customer-auth.ts).
const oldHash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
};

beforeAll(async () => {
  db = openDatabase({ dir: "memory" });
  await migrate(db);
  await seedDemo(db, PASSWORD);
  await seedFixture(db);
  await db.execute(
    sql`insert into channel_account (kind, key, name, secret, connected_by) values ('website', '2mginc.com', '2MG website', 'x', (select id from person order by id limit 1))`,
  );
  const [medicine] = await rows<{ name: string; strength: string | null }>(
    db,
    sql`select name, strength from medicine where active order by id limit 1`,
  );
  const wallet = "11111111-1111-4111-8111-111111111111";
  const login = "22222222-2222-4222-8222-222222222222";
  old = {
    products: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "OLD-1", name: medicine?.name ?? "", strength: medicine?.strength ?? null },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "GONE-1", name: "A medicine no longer sold", strength: "5 mg" },
    ],
    wallets: [
      { id: wallet, name: "Lito Ramirez", phone: "+639171234567", balance: 150 },
      { id: "33333333-3333-4333-8333-333333333333", name: "No number", phone: null, balance: 5 },
    ],
    entries: [
      { id: "e1", account_id: wallet, kind: "earn", points: 100, reference: "S-1", note: null, created_at: "2026-09-01T02:00:00Z" },
      { id: "e2", account_id: wallet, kind: "settle", points: 30, reference: "S-2", note: null, created_at: "2026-10-01T02:00:00Z" },
      { id: "e3", account_id: wallet, kind: "spend", points: -20, reference: "2MG-OLD-1", note: "Reserved at checkout", created_at: "2026-11-10T02:00:00Z" },
    ],
    logins: [{ id: login, phone: "09171234567", name: "Lito Ramirez", password_hash: oldHash("lito-points-1"), account_id: wallet }],
    sessions: [{ credential_id: login, token_hash: "f".repeat(64), expires_at: new Date(Date.now() + 86_400_000) }],
    ties: [{ site: "https://www.2mginc.com", account_ref: "web-user-9", phone: "+639171234567", rewards_account_id: wallet, order_ref: "2MG-OLD-1", bound_at: "2026-11-10T02:00:00Z" }],
    holds: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        account_id: wallet,
        reference: "2MG-OLD-1",
        points: 20,
        restored: 0,
        state: "spent",
        site: "2mginc.com",
        request_key: "order:2MG-OLD-1",
        created_at: "2026-11-10T02:00:00Z",
      },
    ],
    orders: [
      {
        site: "https://www.2mginc.com",
        ref: "2MG-OLD-1",
        status: "confirmed",
        customer_name: "Lito Ramirez",
        phone: "+639171234567",
        email: null,
        address: "Pasay",
        items: [{ name: "Letrozole 2.5 mg", quantity: 1, unitPrice: 140000, lineTotal: 140000, crmProductId: "x" }],
        subtotal: 140000,
        relief: 0,
        discount: 0,
        delivery_fee: 0,
        total: 138000,
        benefit: null,
        assistance: null,
        is_b2b: false,
        lead_id: null,
        placed_at: "2026-11-10T02:00:00Z",
        source_updated_at: "2026-11-10T02:00:00Z",
        account_ref: "web-user-9",
        account_phone: "+639171234567",
        payment_method: "cod",
        files: [],
        callback_url: "https://www.2mginc.com/api/crm/order-status",
        redemption_id: "44444444-4444-4444-8444-444444444444",
        admin_url: null,
        card_error: null,
      },
    ],
  };
});

describe("the old CRM's website link, brought over", () => {
  it("keeps an old points password working in this CRM's form", async () => {
    const converted = convertOldHash(oldHash("lito-points-1")) as string;
    expect(converted.startsWith("scrypt$")).toBe(true);
    expect(await passwordMatches("lito-points-1", converted)).toBe(true);
    expect(await passwordMatches("wrong-one", converted)).toBe(false);
    expect(convertOldHash("not-a-hash")).toBeNull();
  });

  it("writes nothing on a dry run, everything with --apply, and nothing twice", async () => {
    const dry = await importOldWebsite(db, old, false);
    expect(dry).toMatchObject({ medicinesMatched: 1, medicinesNoMatch: 1, wallets: 1, walletsNoPhone: 1, entries: 3, logins: 1, holds: 1, orders: 1 });
    expect((await rows(db, sql`select 1 from points_account where phone_key = '9171234567'`)).length).toBe(0);

    const done = await importOldWebsite(db, old, true);
    expect(done).toMatchObject({ entries: 3, balanceCarried: 1, sessions: 1, ties: 1, holds: 1, orders: 1 });
    // The balance as the old CRM had it: its history plus one carried entry.
    const [account] = await rows<{ id: number; balance: number }>(
      db,
      sql`select id::int as id, balance from points_account where phone_key = '9171234567'`,
    );
    expect(account?.balance).toBe(150);
    // The same password signs in; the open session goes on.
    const [login] = await rows<{ hash: string; accountId: number }>(
      db,
      sql`select password_hash as hash, account_id::int as "accountId" from points_login where phone_key = '9171234567'`,
    );
    expect(await passwordMatches("lito-points-1", login?.hash ?? "")).toBe(true);
    expect(login?.accountId).toBe(account?.id);
    // The website order is known, with its points hold; the medicine keeps the website's id.
    const [web] = await rows<{ hold: string | null; points: number }>(
      db,
      sql`select points_reservation::text as hold, points_redeemed as points from web_order where ref = '2MG-OLD-1'`,
    );
    expect(web).toMatchObject({ hold: "44444444-4444-4444-8444-444444444444", points: 20 });
    expect(
      (await rows(db, sql`select 1 from medicine where web_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`)).length,
    ).toBe(1);
    expect(
      (await rows(db, sql`select 1 from web_retired_product where web_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'`)).length,
    ).toBe(1);

    const again = await importOldWebsite(db, old, true);
    expect(again).toMatchObject({ entries: 0, balanceCarried: 0, sessions: 0, ties: 0, holds: 0, orders: 0 });
    const [still] = await rows<{ balance: number }>(
      db,
      sql`select balance from points_account where phone_key = '9171234567'`,
    );
    expect(still?.balance).toBe(150);
  });
});
