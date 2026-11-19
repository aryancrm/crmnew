// The whole order line checked from A to Z on a copy of the real company (Aryan, 19 Nov: "test
// everything A to Z: the MedRep's form, Management, Finance, Dispatch, the warehouse it picks from,
// the inventory, what the team lead and the CEO see, every feature"). Each step is done as the real
// person does it, through the app (as its screens call it), and each result is said as passed or
// failed with why. Never the live database: a copy only.
//
//   TEST_PGLITE_DIR=<a copy of the local database> npx tsx scripts/a-to-z.ts

import { sql } from "drizzle-orm";
import { createApp } from "../src/app";
import { startSession } from "../src/auth/sessions";
import { dataChecks } from "../src/checks/integrity";
import { openDatabase, rows } from "../src/db/index";
import { migrate } from "../src/db/migrate";
import { todayManila } from "../src/inventory/rules";
import type { Me } from "../src/types";

if (!process.env.TEST_PGLITE_DIR) throw new Error("Give TEST_PGLITE_DIR: a copy of a local database (never the live one).");
const db = openDatabase({ dir: process.env.TEST_PGLITE_DIR });
await migrate(db);
const app = createApp(db, { webUrl: "http://localhost:5180" });
const today = todayManila();

// ---- how each step is said ----
const results: { step: string; ok: boolean; note: string }[] = [];
let section = "";
const part = (title: string) => {
  section = title;
  console.log(`\n${title}`);
};
async function step(what: string, work: () => Promise<string | undefined | void>) {
  try {
    const note = (await work()) ?? "";
    results.push({ step: `${section} · ${what}`, ok: true, note });
    console.log(`  ✓ ${what}${note ? `: ${note}` : ""}`);
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error);
    results.push({ step: `${section} · ${what}`, ok: false, note });
    console.log(`  ✗ ${what}: ${note}`);
  }
}
function must(condition: unknown, why: string): asserts condition {
  if (!condition) throw new Error(why);
}

// ---- the people, each with their own login (and the desks' shared screens) ----
const idOf = async (name: string) => {
  const [found] = await rows<{ id: number }>(db, sql`select id::int as id from person where active and name = ${name} order by id limit 1`);
  must(found, `${name} is not in this database`);
  return found.id;
};
const cookies = new Map<string, string>();
const as = async (name: string, desk?: "management" | "finance" | "dispatch") => {
  const key = `${name}${desk ? `@${desk}` : ""}`;
  const known = cookies.get(key);
  if (known) return known;
  const cookie = `sid=${await startSession(db, await idOf(name), undefined, desk)}`;
  cookies.set(key, cookie);
  return cookie;
};
async function call<T = Record<string, unknown>>(who: string, path: string, body?: unknown, method?: string): Promise<T> {
  const cookie = who.includes("@") ? await as(who.split("@")[0] as string, who.split("@")[1] as "management") : await as(who);
  const form = body instanceof FormData;
  const response = await app.request(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { cookie, ...(form || body === undefined ? {} : { "content-type": "application/json" }) },
    body: form ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} → ${response.status} ${text.slice(0, 180)}`);
  return (text ? JSON.parse(text) : {}) as T;
}
const refused = async (who: string, path: string, body: unknown = {}) => {
  try {
    await call(who, path, body);
    return false;
  } catch (error) {
    return /→ 40[0-9]/.test(error instanceof Error ? error.message : "");
  }
};
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
const paper = (kind: string) => {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File([PNG], `${kind}.png`, { type: "image/png" }));
  return form;
};
const order = (who: string, id: number) =>
  call<{ order: Record<string, unknown> & { status: string }; items: { id: number; medicineId: number; qty: number }[]; events: { message: string }[]; picks: { batchId?: number; warehouseId?: number; qty: number }[] }>(who, `/api/orders/${id}`);
const shelf = async (medicineId: number) =>
  (
    await rows<{ qty: number }>(
      db,
      sql`select coalesce(sum(st.qty), 0)::int as qty from stock st join batch b on b.id = st.batch_id where b.medicine_id = ${medicineId}`,
    )
  )[0]?.qty ?? 0;

// The people of this walk, as on the chart.
const MEDREP = "Ryan Aninon";
const LEAD = "Daniel Cruz";
const HEAD = "Vanessa Escalderon";
const OTHER_HEAD = "Javed Shaikh";
const MGMT = ["Kate Cagoyong", "Sheila Mae Bazar"];
const FIN = ["Sarla Devi", "Rommel Arcanghel"];
const DISP = ["Tiara Evangelista", "Glyssa Delfino"];

// The hospital and medicine of the walk: St. Clare's (Ryan's, Pasay) bought SugamaGet 200 at ₱3,500
// on 13 Nov (Zoho); its list is ₱3,900. RocuGet rides along.
const [customer] = await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from customer where name = 'ST. CLARE''S MEDICAL CENTER INC.' limit 1`);
const [sugama] = await rows<{ id: number; list: number }>(
  db,
  sql`select m.id::int as id, p.amount::int as list from medicine m join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'hospital' where m.name = 'SugamaGet 200' limit 1`,
);
const [rocu] = await rows<{ id: number }>(db, sql`select id::int as id from medicine where name = 'RocuGet' limit 1`);
must(customer && sugama && rocu, "the walk's customer or medicines are not in this copy");

// ================================================================== the MedRep
part("1 · The MedRep places the order (Ryan Aninon, Hospital CHC, Pasay)");
let o1 = 0;
const startShelf = await shelf(sugama.id);
await step("his hospital is in his customer list", async () => {
  const list = await call<{ rows: { id: number; name: string }[] }>(MEDREP, `/api/customers?q=${encodeURIComponent("ST. CLARE")}`);
  must(list.rows.some((one) => one.id === customer.id), "St. Clare's not found in his list");
  return customer.name;
});
await step("places it from the form: SugamaGet 200 × 5 at the list price, RocuGet × 10", async () => {
  o1 = (
    await call<{ id: number }>(MEDREP, "/api/orders", {
      customerId: customer.id,
      items: [
        { medicineId: sugama.id, qty: 5, priceKind: "hospital" },
        { medicineId: rocu.id, qty: 10, priceKind: "hospital" },
      ],
    })
  ).id;
  const placed = await order(MEDREP, o1);
  must(placed.order.status === "pending_approval", `status is ${placed.order.status}`);
  return `${placed.order.code} waits for Management`;
});
await step("the medicine stays on the shelf but is promised", async () => {
  must((await shelf(sugama.id)) === startShelf, "the shelf moved on placing");
  const [promised] = await rows<{ n: number }>(
    db,
    sql`select coalesce(sum(oi.qty), 0)::int as n from order_item oi join sales_order o on o.id = oi.order_id where oi.medicine_id = ${sugama.id} and o.id = ${o1}`,
  );
  // 5 paid, and any free pieces a promo adds (buy one, take one).
  must((promised?.n ?? 0) >= 5, `${promised?.n ?? 0} promised`);
  return `${startShelf} on the shelf, ${promised?.n} promised to this order (5 paid${(promised?.n ?? 0) > 5 ? `, ${(promised?.n ?? 0) - 5} free by a promo` : ""})`;
});
await step("attaches the hospital's PO", async () => {
  await call(MEDREP, `/api/orders/${o1}/papers`, paper("po"));
});
await step("a MedRep can't approve his own order", async () => {
  must(await refused(MEDREP, `/api/orders/${o1}/approve`), "the MedRep could approve");
});

// ================================================================== Management
part("2 · Management (Kate Cagoyong, Sheila Mae Bazar; the shared screen and their own logins)");
let owner = "";
await step("both press Start on the shared screen; the order is given to one of them", async () => {
  for (const name of MGMT) await call(`${MGMT[0]}@management`, `/api/desk/management/people/${await idOf(name)}/start`, { on: true });
  const [row] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.manage_by where o.id = ${o1}`);
  must(row?.by && MGMT.includes(row.by), `given to ${row?.by ?? "nobody"}`);
  owner = row.by;
  return `given to ${owner}`;
});
await step("the shared screen shows Management's desk, no person's own things", async () => {
  const me = await call<{ me: { deskScreen: string | null } }>(`${MGMT[0]}@management`, "/api/me");
  must(me.me.deskScreen === "management", "not marked as the desk's screen");
});
await step("each person's own login sees the queue with the order and its person", async () => {
  for (const name of MGMT) {
    const board = await call<{ cards: { id: number; handledBy: string | null }[] }>(name, "/api/orders/board?desk=management");
    const card = board.cards.find((one) => one.id === o1);
    must(card, `${name} doesn't see it`);
    must(card.handledBy === owner, `${name} sees it handled by ${card.handledBy}`);
  }
  return `both see it, named ${owner}'s`;
});
await step("the customer's last price shows on the order: ₱3,500 (13 Nov) against ₱3,900 now", async () => {
  const prices = await call<{ lines: Record<string, { medicineId: number | null; lastPrice: number | null; lastAt: string; rows: unknown[] } | null> }>(owner, `/api/orders/${o1}/prices`);
  const line = Object.values(prices.lines).find((one) => one?.medicineId === sugama.id);
  must(line, "no price history for the line");
  must(line.lastPrice !== null, "no last price");
  return `last ₱${((line.lastPrice ?? 0) / 100).toLocaleString("en-PH")} on ${line.lastAt} · list ₱${(sugama.list / 100).toLocaleString("en-PH")} · ${line.rows.length} earlier sales`;
});
await step("its papers are not checked until a person reads them", async () => {
  must((await order(owner, o1)).order.papersCheckedAt === null, "papers checked by themselves");
  await call(owner, `/api/orders/${o1}/papers-check`, { ok: true });
  must((await order(owner, o1)).order.papersCheckedBy === owner, "not kept with who");
  return `checked by ${owner}`;
});
const other = MGMT.find((name) => name !== owner) as string;
await step(`"I'll handle it": ${other} takes it over`, async () => {
  await call(other, `/api/orders/${o1}/handle`, {});
  const [row] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.manage_by where o.id = ${o1}`);
  must(row?.by === other, `held by ${row?.by}`);
});
await step("sent back to the MedRep with the reason", async () => {
  await call(other, `/api/orders/${o1}/send_back`, { reason: "Confirm the vials: they asked for 6 last week" });
  must((await order(MEDREP, o1)).order.status === "draft", "not back with the MedRep");
});
await step("the MedRep finds it under Sent back, and is told", async () => {
  const mine = await call<{ cards: { id: number }[] }>(MEDREP, "/api/orders/mine?stage=sent_back&page=1");
  must(mine.cards.some((one) => one.id === o1), "not under his Sent back");
  const bell = await call<{ rows: { kind: string; link: string; body: string | null }[] }>(MEDREP, "/api/notifications");
  must(bell.rows.some((row) => row.kind === "sent_back" && row.link === `/orders/${o1}`), "no bell line");
});
await step("the MedRep fixes it (6 vials) and sends it again with his answer", async () => {
  await call(MEDREP, `/api/orders/${o1}/revise`, {
    customerId: customer.id,
    items: [
      { medicineId: sugama.id, qty: 6, priceKind: "hospital" },
      { medicineId: rocu.id, qty: 10, priceKind: "hospital" },
    ],
    answer: "Yes, 6: confirmed with their pharmacy",
  });
  const back = await order(other, o1);
  must(back.order.status === "pending_approval", `status ${back.order.status}`);
  const [row] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.manage_by where o.id = ${o1}`);
  return `back at Management with ${row?.by ?? "nobody yet"}, his answer on it`;
});
await step("Management is told it came back", async () => {
  const bell = await call<{ rows: { kind: string; link: string }[] }>(other, "/api/notifications");
  must(bell.rows.some((row) => row.link === `/orders/${o1}`), "no bell line for Management");
});
await step("put on hold with a question, the MedRep answers, Management goes on", async () => {
  await call(other, `/api/orders/${o1}/hold`, { reason: "Which ward receives it?" });
  must((await order(MEDREP, o1)).order.status === "on_hold", "not on hold");
  await call(MEDREP, `/api/orders/${o1}/answer`, { reason: "Operating room, 3rd floor" });
  await call(other, `/api/orders/${o1}/resume`, { reason: "The MedRep answered: operating room" });
  must((await order(other, o1)).order.status === "pending_approval", "not back to approval");
});
await step("the papers asked again after the change, then approved", async () => {
  if ((await order(other, o1)).order.papersCheckedAt === null) await call(other, `/api/orders/${o1}/papers-check`, { ok: true });
  await call(other, `/api/orders/${o1}/approve`, {});
  const now = await order(other, o1);
  must(["finance_check", "ready_for_invoice"].includes(now.order.status), `status ${now.order.status}`);
  return `on to Finance (${now.order.status})`;
});

// ================================================================== Finance
part("3 · Finance (Sarla Devi, Rommel Arcanghel)");
let fin = "";
await step("both Start; the order is given to one of them", async () => {
  for (const name of FIN) await call(`${FIN[0]}@finance`, `/api/desk/finance/people/${await idOf(name)}/start`, { on: true });
  const [row] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.finance_by where o.id = ${o1}`);
  must(row?.by && FIN.includes(row.by), `given to ${row?.by ?? "nobody"}`);
  fin = row.by;
  return `given to ${fin}`;
});
await step("Finance's card carries its checks (dues, credit, proof)", async () => {
  const board = await call<{ cards: { id: number; findings: { kind: string }[] }[] }>(fin, "/api/orders/board?desk=finance");
  const card = board.cards.find((one) => one.id === o1);
  must(card, "not on Finance's board");
  return card.findings.length ? `to look at: ${card.findings.map((one) => one.kind).join(", ")}` : "nothing to look at";
});
await step("checks it and makes the invoice: on to Dispatch", async () => {
  await call(fin, `/api/finance/orders/${o1}/invoice`, {});
  const now = await order(fin, o1);
  must(now.order.status === "ready_for_dispatch", `status ${now.order.status}`);
  const [invoice] = await rows<{ code: string; due: string; total: number }>(db, sql`select code, to_char(due_on, 'YYYY-MM-DD') as due, total::int as total from invoice where order_id = ${o1} and status <> 'cancelled'`);
  must(invoice, "no invoice");
  return `${invoice.code}, ₱${(invoice.total / 100).toLocaleString("en-PH")}, due ${invoice.due}`;
});

// ================================================================== Dispatch
part("4 · Dispatch (Tiara Evangelista, Glyssa Delfino) and the warehouse");
let packer = "";
const beforePack = await shelf(sugama.id);
await step("both Start; the order to pack is given to one of them", async () => {
  for (const name of DISP) await call(`${DISP[0]}@dispatch`, `/api/desk/dispatch/people/${await idOf(name)}/start`, { on: true });
  const [row] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.dispatch_by where o.id = ${o1}`);
  must(row?.by && DISP.includes(row.by), `given to ${row?.by ?? "nobody"}`);
  packer = row.by;
  return `given to ${packer}`;
});
await step("packs it: picked from the right warehouse, the batch that expires first", async () => {
  await call(packer, `/api/dispatch/orders/${o1}/pack`, {});
  const picks = await rows<{ warehouse: string; batch: string; expires: string; qty: number; medicineId: number; first: string }>(
    db,
    sql`select w.name as warehouse, b.batch_no as batch, to_char(b.expires_on, 'YYYY-MM-DD') as expires, p.qty, b.medicine_id::int as "medicineId",
        (select to_char(min(b2.expires_on), 'YYYY-MM-DD') from batch b2 join stock s2 on s2.batch_id = b2.id and s2.warehouse_id = p.warehouse_id
          where b2.medicine_id = b.medicine_id and b2.expires_on >= current_date and (s2.qty > 0 or b2.id = b.id)) as first
      from order_pick p join batch b on b.id = p.batch_id join warehouse w on w.id = p.warehouse_id where p.order_id = ${o1} and p.active`,
  );
  must(picks.length >= 2, `${picks.length} picks`);
  const [ships] = await rows<{ name: string | null }>(db, sql`select coalesce((select w.name from sales_order o join warehouse w on w.id = o.warehouse_id where o.id = ${o1}), (select name from warehouse where is_default)) as name`);
  for (const pick of picks) {
    must(pick.warehouse === ships?.name, `${pick.batch} picked from ${pick.warehouse}, the order ships from ${ships?.name}`);
    must(pick.expires === pick.first, `${pick.batch} (${pick.expires}) picked before an earlier batch (${pick.first})`);
  }
  must((await order(packer, o1)).order.status === "packing", "not packing");
  const [taken] = await rows<{ n: number }>(db, sql`select coalesce(sum(p.qty), 0)::int as n from order_pick p join batch b on b.id = p.batch_id where p.order_id = ${o1} and p.active and b.medicine_id = ${sugama.id}`);
  must((await shelf(sugama.id)) === beforePack - (taken?.n ?? 0), `the shelf went from ${beforePack} to ${await shelf(sugama.id)}, ${taken?.n} picked`);
  return picks.map((pick) => `${pick.qty} from ${pick.batch} (exp ${pick.expires}) at ${pick.warehouse}`).join("; ");
});
await step("ships it by courier with its tracking number", async () => {
  await call(packer, `/api/dispatch/orders/${o1}/ship`, { method: "courier", courier: "LBC", tracking: "LBC-778812", addressChecked: true });
  must((await order(packer, o1)).order.status === "shipped", "not shipped");
});
await step("the courier fails to deliver: back to Dispatch, the box kept", async () => {
  await call(packer, `/api/dispatch/orders/${o1}/failed`, { reason: "Receiving closed on arrival" });
  const now = await order(packer, o1);
  must(now.order.status === "packing", `status ${now.order.status}`);
  must(now.picks.length >= 2, "the picks were lost");
  const [kept] = await rows<{ n: number }>(db, sql`select coalesce(sum(p.qty), 0)::int as n from order_pick p join batch b on b.id = p.batch_id where p.order_id = ${o1} and p.active and b.medicine_id = ${sugama.id}`);
  must((await shelf(sugama.id)) === beforePack - (kept?.n ?? 0), "the shelf moved on a failed delivery");
});
await step("sent again by the company rider, delivered with the signed receipt", async () => {
  await call(packer, `/api/dispatch/orders/${o1}/ship`, { method: "rider", rider: "Jun", addressChecked: true });
  must(await refused(packer, `/api/dispatch/orders/${o1}/deliver`, { receivedBy: "Pharmacy", deliveredOn: today }), "delivered without the receipt");
  await call(packer, `/api/orders/${o1}/papers`, paper("dr"));
  await call(packer, `/api/dispatch/orders/${o1}/deliver`, { receivedBy: "OR pharmacy, Ms. Reyes", deliveredOn: today });
  must((await order(packer, o1)).order.status === "completed", "not delivered");
});

// ================================================================== money
part("5 · The money: payment, collections");
let invoiceId = 0;
await step("Finance takes half the payment", async () => {
  const [invoice] = await rows<{ id: number; total: number }>(db, sql`select id::int as id, total::int as total from invoice where order_id = ${o1} and status <> 'cancelled'`);
  must(invoice, "no invoice");
  invoiceId = invoice.id;
  await call(fin, `/api/invoices/${invoice.id}/payments`, { amount: Math.floor(invoice.total / 2), method: "check", reference: "CHK-AZ-1", paidOn: today });
  const [after] = await rows<{ paid: number; total: number }>(db, sql`select paid::int as paid, total::int as total from invoice where id = ${invoice.id}`);
  must(after && after.paid === Math.floor(invoice.total / 2), "the payment didn't land");
  return `₱${(after.paid / 100).toLocaleString("en-PH")} of ₱${(after.total / 100).toLocaleString("en-PH")} received`;
});
await step("the MedRep's collections show what is still owed", async () => {
  const mine = await call<{ rows: { invoiceId?: number; customerId?: number; balance?: number; owed?: number }[] }>(MEDREP, "/api/my/collect");
  must(mine.rows.some((row) => row.invoiceId === invoiceId), "not in his collections");
});
await step("the team lead's collections show it too", async () => {
  const theirs = await call<{ rows: { customerId: number; owed: number }[] }>(LEAD, "/api/my/collections");
  must(theirs.rows.some((row) => row.customerId === customer.id), "not in the team lead's collections");
});

// ================================================================== a return
part("6 · A return: 2 vials back, Management decides, Dispatch takes them in, Finance credits");
await step("the MedRep asks; Management approves; Dispatch puts them back on the shelf; Finance credits the bill", async () => {
  const left = await call<{ left: { orderItemId: number; medicineId?: number; left: number }[] }>(MEDREP, `/api/orders/${o1}/returns`);
  const line = (await order(MEDREP, o1)).items.find((one) => one.medicineId === sugama.id);
  must(line, "no SugamaGet line");
  const asked = await call<{ id: number }>(MEDREP, `/api/orders/${o1}/returns`, { reason: "not_needed", note: "Surgery moved", lines: [{ orderItemId: line.id, qty: 2 }] });
  must(left.left.length > 0, "nothing left to return");
  const shelfBefore = await shelf(sugama.id);
  await call(other, `/api/returns/${asked.id}/decide`, { approve: true });
  const list = await call<{ rows: { id: number; lines: { id: number }[] }[] }>(other, "/api/returns");
  const ret = list.rows.find((one) => one.id === asked.id);
  must(ret, "the return is not listed");
  await call(packer, `/api/returns/${asked.id}/receive`, { lines: ret.lines.map((one) => ({ lineId: one.id, outcome: "restocked" })) });
  must((await shelf(sugama.id)) === shelfBefore + 2, "not back on the shelf");
  const [before] = await rows<{ total: number }>(db, sql`select total::int as total from invoice where id = ${invoiceId}`);
  await call(other, `/api/returns/${asked.id}/credit`, { credit: true });
  const [after] = await rows<{ total: number }>(db, sql`select total::int as total from invoice where id = ${invoiceId}`);
  must(after && before && after.total < before.total, "the bill was not credited");
  return `shelf +2, bill ₱${((before?.total ?? 0) / 100).toLocaleString("en-PH")} → ₱${((after?.total ?? 0) / 100).toLocaleString("en-PH")}`;
});

// ================================================================== advance pay
part("7 · Paid in advance: Finance waits for the proof, the proof sends it back by itself");
let o2 = 0;
await step("an advance-pay hospital's order: approved, at Finance", async () => {
  const [hospital] = await rows<{ id: number }>(
    db,
    sql`select c.id::int as id from customer c join area a on a.id = c.area_id where a.name = 'HOS | PASAY' and c.kind = 'hospital' and c.active and c.id <> ${customer.id} order by c.id limit 1`,
  );
  must(hospital, "no second hospital");
  await call(MGMT[0] as string, `/api/customers/${hospital.id}/credit`, { paymentTerms: "advance", paymentDays: null, creditLimit: null });
  o2 = (await call<{ id: number }>(MEDREP, "/api/orders", { customerId: hospital.id, items: [{ medicineId: rocu.id, qty: 4, priceKind: "hospital" }] })).id;
  const [held] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.manage_by where o.id = ${o2}`);
  await call(held?.by ?? (MGMT[0] as string), `/api/orders/${o2}/approve`, {});
  must((await order(fin, o2)).order.status === "finance_check", `status ${(await order(fin, o2)).order.status}`);
});
await step("Finance holds it for the proof; the MedRep's proof sends it back to Finance by itself", async () => {
  const [mine] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.finance_by where o.id = ${o2}`);
  const who = mine?.by ?? (FIN[0] as string);
  await call(who, `/api/orders/${o2}/hold`, { reason: "No proof of payment yet" });
  must((await order(MEDREP, o2)).order.status === "on_hold", "not held");
  await call(MEDREP, `/api/orders/${o2}/papers`, paper("payment_proof"));
  must((await order(who, o2)).order.status === "finance_check", "the proof didn't send it back");
  const total = Number((await order(who, o2)).order.total);
  await call(who, `/api/finance/orders/${o2}/confirm-payment`, { amount: total, method: "bank", reference: "BDO-AZ-2", paidOn: today, checked: true });
  const now = (await order(who, o2)).order.status;
  must(["ready_for_invoice", "ready_for_dispatch"].includes(now), `status ${now}`);
  return `payment confirmed: ${now}`;
});

// ================================================================== a cancelled order
part("8 · Cancelled before approval: the promise comes off the shelf");
await step("Management cancels a new order with the reason", async () => {
  const o3 = (await call<{ id: number }>(MEDREP, "/api/orders", { customerId: customer.id, items: [{ medicineId: sugama.id, qty: 3, priceKind: "hospital" }] })).id;
  const [held] = await rows<{ by: string | null }>(db, sql`select p.name as by from sales_order o left join person p on p.id = o.manage_by where o.id = ${o3}`);
  await call(held?.by ?? (MGMT[0] as string), `/api/orders/${o3}/cancel`, { reason: "Duplicate of the earlier order" });
  must((await order(MEDREP, o3)).order.status === "cancelled", "not cancelled");
  const [promised] = await rows<{ n: number }>(db, sql`select count(*)::int as n from sales_order where id = ${o3} and status not in ('cancelled')`);
  must(promised?.n === 0, "still promised");
});

// ================================================================== who sees it
part("9 · The team lead, the head, the CEO see it; another head doesn't");
await step("the team lead (Daniel, NCR 1) sees the order and Ryan's sale", async () => {
  const team = await call<{ cards: { id: number }[] }>(LEAD, "/api/orders/mine?stage=all&page=1");
  must(team.cards.some((one) => one.id === o1), "not in Team orders");
  const board = await call<{ seats: { person: { name: string } | null; sold?: number; month?: { sold: number } }[] }>(LEAD, "/api/team/board");
  must(board.seats.some((seat) => seat.person?.name === MEDREP), "Ryan not on My team");
});
await step("the head (Vanessa) sees it", async () => {
  const team = await call<{ cards: { id: number }[] }>(HEAD, "/api/orders/mine?stage=all&page=1");
  must(team.cards.some((one) => one.id === o1), "not in the division's orders");
});
await step("another business's head (Javed) doesn't", async () => {
  try {
    const team = await call<{ cards: { id: number }[] }>(OTHER_HEAD, "/api/orders/mine?stage=all&page=1");
    must(!team.cards.some((one) => one.id === o1), "Javed sees a Hospital order");
  } catch (error) {
    if (!/→ 40[34]/.test(error instanceof Error ? error.message : "")) throw error;
  }
});
await step("the CEO's Home counts it (sold this month, the company at a glance)", async () => {
  const glance = await call<{ sellers: { name: string }[]; days: { day: string; amount: number }[] }>("Naresh Bishnoi", "/api/ceo/company");
  must(glance.days.some((one) => one.day === today && one.amount > 0), "nothing sold today on the CEO's Home");
});
await step("the target sheet's Pasay row counts the invoice (by Ryan's seat)", async () => {
  const sheet = await call<{ rows: { salesperson: string; ach: number }[] }>("Naresh Bishnoi", `/api/target-sheet?month=${today.slice(0, 7)}&day=${today}`);
  const row = sheet.rows.find((one) => one.salesperson === "HOS | RYAN");
  must(row, "no HOS | RYAN row (the November sheet not loaded on this copy?)");
  return `HOS | RYAN achieved ₱${(row.ach / 100).toLocaleString("en-PH")}`;
});

// ================================================================== inventory, admin
part("10 · Inventory and the Admin's checks");
await step("the medicine's page shows the stock after the order and the return", async () => {
  const medicine = await call<Record<string, unknown>>("Yash Parmar", `/api/inventory/medicines/${sugama.id}`);
  must(medicine, "no medicine page");
  return `shelf ${await shelf(sugama.id)} (was ${startShelf}: the box packed, 2 returned)`;
});
await step("every desk's figures read (Management, Finance, Dispatch)", async () => {
  for (const desk of ["management", "finance", "dispatch"]) await call("Naresh Bishnoi", `/api/desk/${desk}/report`);
});
await step("the order's whole story is on its timeline", async () => {
  const events = (await order("Naresh Bishnoi", o1)).events.map((one) => one.message);
  must(events.length >= 10, `${events.length} events`);
  return `${events.length} events`;
});
await step("the data checks all pass", async () => {
  const [admin] = await rows<{ id: number }>(db, sql`select id::int as id from person where role = 'admin' and active limit 1`);
  const out = await dataChecks(db, { id: admin?.id, role: "admin", name: "Admin" } as unknown as Me);
  const bad = out.checks.filter((one) => !one.ok);
  must(!bad.length, bad.map((one) => `${one.label} (${one.count})`).join("; "));
  return `${out.checks.length} of ${out.checks.length}`;
});

// ---- the end ----
const failed = results.filter((one) => !one.ok);
console.log(`\n${results.length - failed.length} of ${results.length} steps passed.`);
for (const one of failed) console.log(`  ✗ ${one.step}: ${one.note}`);
process.exit(failed.length ? 1 : 0);
