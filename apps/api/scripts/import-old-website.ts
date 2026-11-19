// Brings the old CRM's link to the websites over (online/legacy-website.ts): the ids the 2MG
// website knows each medicine by, every points wallet with its history, the points sign-ins (same
// passwords, same open sessions), website accounts tied to a wallet, points held at checkouts, and
// the website orders still open. The old database is only read (a read-only transaction). Dry run
// by default; --apply writes. Safe to run again. Run it before switching the stock link on.
//
//   OLD_ENV=~/Projects/crm/.env  (its DATABASE_URL is the old database)
//   TEST_PGLITE_DIR=<a local database> npx tsx scripts/import-old-website.ts [--apply]
//   (the live database only with --live and Aryan's word)

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { importOldWebsite, type OldWebsite } from "../src/online/legacy-website";
import { openTarget } from "./zoho-files";

const apply = process.argv.includes("--apply");
if (!process.env.TEST_PGLITE_DIR && !process.argv.includes("--live")) {
  console.log("Give TEST_PGLITE_DIR (a local database). The live one only with --live, on Aryan's word.");
  process.exit(1);
}

function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
      }),
  );
}
const oldUrl = envFile(process.env.OLD_ENV ?? join(homedir(), "Projects/crm/.env")).DATABASE_URL;
if (!oldUrl) {
  console.log("No old DATABASE_URL (OLD_ENV).");
  process.exit(1);
}

const old = postgres(oldUrl, { prepare: false, max: 1 });
const data = (await old.begin("read only", async (tx) => ({
  // Every medicine the website may link to (archived ones too), not services.
  products: await tx`select id::text, nullif(nullif(trim(code), ''), '-') as code, name, strength from products.product
    where coalesce(type, 'goods') <> 'service'`,
  wallets: await tx`select id::text, name, phone, balance from rewards.account where active`,
  entries: await tx`select e.id::text, e.account_id::text, e.kind, e.points, e.reference, e.note, e.created_at
    from rewards.entry e join rewards.account a on a.id = e.account_id where e.active and a.active order by e.created_at, e.id`,
  logins: await tx`select id::text, phone, name, password_hash, account_id::text from rewards.credential where active`,
  sessions: await tx`select credential_id::text, token_hash, expires_at from rewards.session where active and expires_at > now()`,
  ties: await tx`select c.site, c.account_ref, c.phone, c.rewards_account_id::text, o.ref as order_ref, c.bound_at
    from store.customer_account c left join store."order" o on o.id = c.order_id where c.active`,
  holds: await tx`select id::text, account_id::text, reference, points, restored, state, site, request_key, created_at
    from rewards.redemption where active`,
  orders: await tx`select site, ref, status, customer_name, phone, email, address, items, subtotal, relief, discount, delivery_fee,
      total, benefit, assistance, is_b2b, lead_id::text, placed_at, source_updated_at, account_ref, account_phone, payment_method,
      files, callback_url, redemption_id::text, admin_url, card_error
    from store."order" where active`,
}))) as unknown as OldWebsite;
await old.end();

const target = await openTarget(false);
if (!target) process.exit(1);
console.log(`${apply ? "Writing to" : "Dry run on"} ${target.where}.`);
const said = await importOldWebsite(target.db, data, apply);
console.log(apply ? "Brought over:" : "Would bring over (nothing written; add --apply):", said);
process.exit(0);
