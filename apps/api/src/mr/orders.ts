// An order booked in the MR App (SEFMED's Add Order / POB): at a visit (after I'm here) or from a
// firm's page. Each medicine with its MRP (the patient's price) and this client's rate from the
// CRM's price book, quantities in packs, a photo of the client's PO. Booked business, not sales;
// it stays in the app until the app is tied to the CRM's orders (later).

import { type SQL, sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { bytesOf, type IncomingFile, keepFile } from "../files/store";
import { Refusal } from "../http";
import { todayManila } from "../inventory/rules";
import { clean, iso, type Runner } from "../inventory/service";
import type { Me } from "../types";
import { accessOf, ids, mustSee, mustWork } from "./access";
import type { ClientKind, OrderForm, OrderLine, OrderRow } from "./words";

const FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];
export const ORDER_FILE_MAX = 10 * 1024 * 1024;

/** The CRM price a client of each kind pays (a firm by its type). */
const rateKindOf = (kind: ClientKind, firmType: string | null): string =>
  kind === "doctor" ? "doctor" : kind === "hospital" ? "hospital" : firmType === "stockist" || firmType === "retailer" ? "drugstore" : "distributor";

async function clientOf(db: Runner, clientId: number) {
  const [client] = await rows<{ id: number; name: string; kind: ClientKind; firmType: string | null }>(
    db,
    sql`select id::int as id, name, kind, firm_type as "firmType" from mr_client where id = ${clientId} and active`,
  );
  if (!client) throw new Refusal(400, "invalid", "Pick a doctor, hospital or firm from the list.", "clientId");
  return client;
}

/** Add Order's list for this client. */
export async function orderForm(db: Database, me: Me, clientId: number): Promise<OrderForm> {
  await mustWork(db, me);
  const client = await clientOf(db, clientId);
  const rateKind = rateKindOf(client.kind, client.firmType);
  const medicines = await rows<OrderForm["medicines"][number]>(
    db,
    sql`select m.id::int as id, m.name, m.strength, m.unit, m.pack_size::int as "packSize", m.vat,
        (select p.amount from medicine_price p where p.medicine_id = m.id and p.buyer_type = 'patient')::int as mrp,
        (select p.amount from medicine_price p where p.medicine_id = m.id and p.buyer_type = ${rateKind})::int as rate,
        (select p.pack_amount from medicine_price p where p.medicine_id = m.id and p.buyer_type = ${rateKind})::int as "packRate"
      from medicine m where m.active order by m.name`,
  );
  return { client: { id: client.id, name: client.name, kind: client.kind }, rateKind, medicines };
}

type OrderSql = Omit<OrderRow, "lines"> & { lines: Omit<OrderLine, "name">[] };

/** Booked orders matching a condition on `o`, newest first (or as asked), with medicine names. */
export async function orderRows(db: Runner, where: SQL, limit = 300, order?: SQL): Promise<OrderRow[]> {
  const found = await rows<OrderSql>(
    db,
    sql`select o.id::int as id, o.code, o.visit_id::int as "visitId",
        json_build_object('id', c.id::int, 'name', c.name, 'kind', c.kind) as client,
        json_build_object('id', p.id::int, 'name', p.name) as person, o.lines, o.amount::float8 as amount, o.note,
        (o.file_data is not null or o.file_key is not null) as "hasFile", o.status, ${iso("o.made_at")} as "madeAt",
        o.cancel_note as "cancelNote"
      from mr_order o join mr_client c on c.id = o.client_id join person p on p.id = o.person_id
      where ${where} order by ${order ?? sql`o.made_at desc, o.id desc`} limit ${limit}`,
  );
  const medicineIds = [...new Set(found.flatMap((one) => one.lines.map((line) => line.medicineId)))];
  const names = medicineIds.length
    ? await rows<{ id: number; name: string }>(db, sql`select id::int as id, name from medicine where id in (${ids(medicineIds)})`)
    : [];
  const byId = new Map(names.map((one) => [one.id, one.name]));
  return found.map((one) => ({ ...one, lines: one.lines.map((line) => ({ ...line, name: byId.get(line.medicineId) ?? "" })) }));
}

/** The orders booked over a month: a member's own, or (the lead, the viewers) anyone's or all. */
export async function orderList(
  db: Database,
  me: Me,
  asked: { month?: string | null; person?: string | null },
): Promise<{ month: string; rows: OrderRow[]; total: number; people: { id: number; name: string }[] }> {
  const access = await accessOf(db, me);
  if (!access) throw new Refusal(403, "not_allowed", "The MR App is for its MRs and their team lead.");
  const today = todayManila();
  const month = asked.month && /^\d{4}-\d{2}$/.test(asked.month) ? asked.month : today.slice(0, 7);
  const everyone = access !== "mr" && (asked.person === "all" || !asked.person);
  const personId = everyone ? null : Number(asked.person) || me.id;
  if (personId !== null) await mustSee(db, me, personId);
  const found = await orderRows(
    db,
    sql`${personId === null ? sql`true` : sql`o.person_id = ${personId}`}
      and o.made_at >= (${`${month}-01`}::date at time zone 'Asia/Manila')
      and o.made_at < ((${`${month}-01`}::date + interval '1 month') at time zone 'Asia/Manila')`,
  );
  const people =
    access === "mr"
      ? []
      : await rows<{ id: number; name: string }>(
          db,
          sql`select p.id::int as id, p.name from mr_member m join person p on p.id = m.person_id where m.active order by p.name`,
        );
  return {
    month,
    rows: found,
    total: found.filter((one) => one.status === "booked").reduce((sum, one) => sum + one.amount, 0),
    people,
  };
}

/** Books an order: at the visit (checked in, or closed today) or from the client's page. */
export async function bookOrder(
  db: Database,
  me: Me,
  input: { clientId: number; visitId?: number | null; lines: { medicineId: number; packs: number }[]; note?: string | null },
  file: IncomingFile | null,
): Promise<{ id: number; code: string }> {
  await mustWork(db, me);
  if (!input.lines?.length) throw new Refusal(400, "invalid", "Type the quantity of at least one medicine.", "lines");
  if (input.lines.length > 60) throw new Refusal(400, "invalid", "Sixty medicines at most.", "lines");
  const wanted = new Set<number>();
  for (const line of input.lines) {
    if (!Number.isInteger(line.medicineId) || line.medicineId <= 0) throw new Refusal(400, "invalid", "Pick medicines from the list.", "lines");
    if (!Number.isInteger(line.packs) || line.packs <= 0 || line.packs > 100_000)
      throw new Refusal(400, "invalid", "Type each quantity as a whole number.", "lines");
    if (wanted.has(line.medicineId)) throw new Refusal(400, "invalid", "Each medicine once.", "lines");
    wanted.add(line.medicineId);
  }
  if (file) {
    if (!FILE_TYPES.includes(file.mime)) throw new Refusal(400, "invalid", "Attach a photo or a PDF.", "file");
    if (file.bytes.byteLength === 0 || file.bytes.byteLength > ORDER_FILE_MAX)
      throw new Refusal(400, "invalid", "That file is empty or over 10 MB.", "file");
  }
  const client = await clientOf(db, input.clientId);
  const rateKind = rateKindOf(client.kind, client.firmType);
  const kept = file ? await keepFile("mr-orders", { ...file, name: file.name.trim().slice(0, 120) || "po" }) : null;
  const today = todayManila();
  return db.transaction(async (tx) => {
    if (input.visitId) {
      const [visit] = await rows<{ personId: number; clientId: number; day: string; status: string; checkedIn: boolean }>(
        tx,
        sql`select person_id::int as "personId", client_id::int as "clientId", to_char(day, 'YYYY-MM-DD') as day, status,
            checked_in_at is not null as "checkedIn" from mr_visit where id = ${input.visitId} for update`,
      );
      if (!visit || visit.personId !== me.id || visit.clientId !== client.id)
        throw new Refusal(400, "invalid", "That visit isn't yours with this client.", "visitId");
      if (visit.day !== today || !(visit.checkedIn || visit.status === "done"))
        throw new Refusal(409, "invalid", "Book the order at today's call, after I'm here.", "visitId");
      const [open] = await rows<{ id: number }>(
        tx,
        sql`select id::int as id from mr_order where visit_id = ${input.visitId} and status = 'booked'`,
      );
      if (open) throw new Refusal(409, "taken", "An order is booked at this visit already.", "visitId");
    }
    const prices = await rows<{ id: number; packSize: number; rate: number | null; packRate: number | null }>(
      tx,
      sql`select m.id::int as id, m.pack_size::int as "packSize", p.amount::int as rate, p.pack_amount::int as "packRate"
        from medicine m left join medicine_price p on p.medicine_id = m.id and p.buyer_type = ${rateKind}
        where m.active and m.id in (${ids([...wanted])})`,
    );
    if (prices.length !== wanted.size) throw new Refusal(400, "invalid", "Pick medicines from the list.", "lines");
    const byId = new Map(prices.map((one) => [one.id, one]));
    const lines = input.lines.map((line) => {
      const known = byId.get(line.medicineId) as (typeof prices)[number];
      const qty = line.packs * known.packSize;
      // A whole pack's own price when it has one, else the piece's; a medicine with no price books at nothing.
      const amount = known.packRate !== null ? line.packs * known.packRate : known.rate !== null ? qty * known.rate : 0;
      return { medicineId: line.medicineId, packs: line.packs, qty, price: known.rate ?? 0, amount };
    });
    const amount = lines.reduce((sum, one) => sum + one.amount, 0);
    const [counter] = await rows<{ value: number }>(
      tx,
      sql`update counter set value = value + 1 where name = 'mr_order' returning value::int as value`,
    );
    const code = `POB-${String(counter?.value ?? 1).padStart(5, "0")}`;
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into mr_order (code, person_id, client_id, visit_id, lines, amount, note, file_name, file_mime, file_size, file_data, file_key)
        values (${code}, ${me.id}, ${client.id}, ${input.visitId ?? null}, ${JSON.stringify(lines)}::jsonb, ${amount},
          ${clean(input.note) ?? null}, ${kept?.name ?? null}, ${kept?.mime ?? null}, ${kept?.size ?? null}, ${kept?.data ?? null}, ${kept?.key ?? null})
        returning id::int as id`,
    );
    return { id: made?.id as number, code };
  });
}

/** The MR cancels an order booked by mistake (kept, with why). */
export async function cancelOrder(db: Database, me: Me, id: number, note: string): Promise<void> {
  await mustWork(db, me);
  const why = clean(note);
  if (!why) throw new Refusal(400, "invalid", "Say why it is cancelled.", "note");
  const changed = await rows<{ id: number }>(
    db,
    sql`update mr_order set status = 'cancelled', cancelled_at = now(), cancel_note = ${why}
      where id = ${id} and person_id = ${me.id} and status = 'booked' returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(409, "invalid", "Only your own booked order is cancelled.");
}

export async function orderFile(db: Database, me: Me, id: number) {
  const [file] = await rows<{ name: string; mime: string; data: Uint8Array | null; key: string | null; personId: number }>(
    db,
    sql`select file_name as name, file_mime as mime, file_data as data, file_key as key, person_id::int as "personId"
      from mr_order where id = ${id} and file_name is not null`,
  );
  if (!file) throw new Refusal(404, "not_found", "No such file.");
  await mustSee(db, me, file.personId);
  return { name: file.name, mime: file.mime, bytes: await bytesOf(file) };
}
