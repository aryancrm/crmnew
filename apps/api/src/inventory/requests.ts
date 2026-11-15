// "Medicine not available": anyone outside Inventory (Management, a MedRep, the Online desk) says
// a customer wants a medicine we don't have in stock or don't list. One open request per name and
// strength gathers every ask under it (who, for which customer, how many), so Inventory sees how
// often and for whom it is wanted, and answers it once: ordered from a supplier, added to the
// list, or can't be had. Whoever asked sees the answer beside their ask.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { Refusal } from "../http";
import { notify, peopleIn } from "../notify/service";
import type { Role } from "../people/roles";
import type { Me, MedicineRequest, MedicineRequestInput, MedicineRequests } from "../types";
import { clean, iso } from "./service";

/** Who answers the requests: they see every request and every ask. */
export const REQUEST_ANSWER_ROLES: readonly Role[] = ["inventory", "admin", "ceo"];

export async function askForMedicine(
  db: Database,
  me: Me,
  input: MedicineRequestInput,
): Promise<number> {
  const name = clean(input.name);
  if (!name) throw new Refusal(400, "invalid", "Write the medicine's name.", "name");
  const strength = clean(input.strength);
  const qty = Math.max(0, Math.floor(input.qty ?? 0));
  if (input.customerId) {
    const [customer] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from customer where id = ${input.customerId} and active`,
    );
    if (!customer) throw new Refusal(400, "invalid", "Pick the customer again.", "customerId");
  }
  return db.transaction(async (tx) => {
    // One open request per medicine: a second ask (even at the same moment) adds to it.
    const [request] = await rows<{ id: number }>(
      tx,
      sql`insert into medicine_request (medicine_id, name, strength, qty, asked_by)
          values (${input.medicineId ?? null}, ${name}, ${strength}, ${qty}, ${me.id})
        on conflict (lower(name), lower(coalesce(strength, ''))) where status = 'open'
        do update set times = medicine_request.times + 1, qty = medicine_request.qty + excluded.qty,
          last_asked_at = now(), medicine_id = coalesce(medicine_request.medicine_id, excluded.medicine_id)
        returning id::int as id`,
    );
    const id = request?.id as number;
    await tx.execute(
      sql`update medicine_request set code = 'MRQ-' || lpad(id::text, 5, '0') where id = ${id} and code is null`,
    );
    const [ask] = await rows<{ id: number; times: number }>(
      tx,
      sql`insert into medicine_request_ask (request_id, person_id, customer_id, qty, note)
          values (${id}, ${me.id}, ${input.customerId ?? null}, ${qty || null}, ${clean(input.note)})
        returning id::int as id, (select times from medicine_request where id = ${id})::int as times`,
    );
    // Inventory hears of every ask (a third ask for the same medicine says so).
    await notify(tx, {
      to: await peopleIn(
        tx,
        [...REQUEST_ANSWER_ROLES].filter((role) => role === "inventory"),
      ),
      kind: "medicine_request",
      title: `Medicine asked for: ${name}${strength ? ` ${strength}` : ""}${(ask?.times ?? 1) > 1 ? ` (${ask?.times} times now)` : ""}`,
      body: `${me.name}${qty ? ` · ${qty} pcs` : ""}${clean(input.note) ? ` · ${clean(input.note)}` : ""}`,
      link: "/inventory/requests",
      key: `medicine_request:${ask?.id}`,
    });
    return id;
  });
}

export async function medicineRequests(
  db: Database,
  me: Me,
  filter: { show?: string },
): Promise<MedicineRequests> {
  const answers = REQUEST_ANSWER_ROLES.includes(me.role);
  const show = filter.show === "answered" ? "answered" : "open";
  // Inventory sees every request; anyone else only the ones they asked for.
  const mine = answers
    ? sql`true`
    : sql`exists (select 1 from medicine_request_ask k where k.request_id = r.id and k.person_id = ${me.id})`;
  const [found, asks, counts] = await Promise.all([
    rows<Omit<MedicineRequest, "asks">>(
      db,
      sql`select r.id::int as id, r.code, r.medicine_id::int as "medicineId", r.name, r.strength, r.times::int as times,
          r.qty::int as qty, r.status, ${iso("r.asked_at")} as "askedAt", ${iso("r.last_asked_at")} as "lastAskedAt",
          r.answer, p.name as "answeredBy", ${iso("r.answered_at")} as "answeredAt",
          coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
            where b.medicine_id = r.medicine_id and b.expires_on >= (now() at time zone 'Asia/Manila')::date), 0)::int as "inStock"
        from medicine_request r left join person p on p.id = r.answered_by
        where ${mine} and ${show === "open" ? sql`r.status = 'open'` : sql`r.status <> 'open'`}
        order by ${show === "open" ? sql`r.times desc, r.last_asked_at desc` : sql`r.answered_at desc`}, r.id desc
        limit 200`,
    ),
    rows<MedicineRequest["asks"][number] & { requestId: number }>(
      db,
      sql`select k.request_id::int as "requestId", k.id::int as id, p.name as by, c.name as customer, c.id::int as "customerId",
          k.qty::int as qty, k.note, ${iso("k.at")} as at
        from medicine_request_ask k join person p on p.id = k.person_id left join customer c on c.id = k.customer_id
        join medicine_request r on r.id = k.request_id
        where ${mine} and ${show === "open" ? sql`r.status = 'open'` : sql`r.status <> 'open'`}
          ${answers ? sql`` : sql`and k.person_id = ${me.id}`}
        order by k.at desc`,
    ),
    rows<{ open: number; answered: number }>(
      db,
      sql`select count(*) filter (where r.status = 'open')::int as open, count(*) filter (where r.status <> 'open')::int as answered
        from medicine_request r where ${mine}`,
    ),
  ]);
  return {
    show,
    can: { answer: answers },
    counts: counts[0] ?? { open: 0, answered: 0 },
    rows: found.map((row) => ({
      ...row,
      asks: asks.filter((ask) => ask.requestId === row.id).map(({ requestId: _r, ...ask }) => ask),
    })),
  };
}

export async function answerRequest(
  db: Database,
  me: Me,
  id: number,
  input: { status: "ordered" | "added" | "declined"; answer?: string | null },
): Promise<void> {
  const answer = clean(input.answer);
  if (input.status === "declined" && !answer)
    throw new Refusal(
      400,
      "invalid",
      "Say why it can't be had, so whoever asked can tell the customer.",
      "answer",
    );
  const [done] = await rows<{ id: number }>(
    db,
    sql`update medicine_request set status = ${input.status}, answer = ${answer}, answered_by = ${me.id}, answered_at = now()
      where id = ${id} and status = 'open' returning id::int as id`,
  );
  if (!done) throw new Refusal(409, "not_now", "That request was already answered. Reload it.");
  // Everyone who asked hears the answer.
  const [request] = await rows<{ name: string; strength: string | null }>(
    db,
    sql`select name, strength from medicine_request where id = ${id}`,
  );
  const askers = await rows<{ id: number }>(
    db,
    sql`select distinct person_id::int as id from medicine_request_ask where request_id = ${id}`,
  );
  const word = { ordered: "Ordered", added: "Added to the list", declined: "Can't be had" }[
    input.status
  ];
  await notify(db, {
    to: askers.map((one) => one.id).filter((one) => one !== me.id),
    kind: "request_answered",
    title: `${word}: ${request?.name ?? "the medicine you asked for"}${request?.strength ? ` ${request.strength}` : ""}`,
    body: `${me.name}${answer ? `: ${answer}` : ""}`,
    link: "/medicines",
    key: `request_answered:${id}`,
  });
}
