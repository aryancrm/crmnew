// Demo orders for a developer's computer, placed and moved the way people would: some waiting
// for Management, some approved, one on hold, one sent back, a few further down the line so
// the dashboard has something in every tile. Runs once.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { Me, OrderItemInput } from "../types";
import { actOnOrder, placeOrder } from "./service";

export async function seedDemoOrders(db: Database): Promise<boolean> {
  const [counted] = await rows<{ count: number }>(
    db,
    sql`select count(*)::int as count from sales_order`,
  );
  if ((counted?.count ?? 0) > 0) return false;
  const people = await rows<{
    id: number;
    name: string;
    role: string;
    areaId: number | null;
    areaName: string | null;
    cities: string[] | null;
  }>(
    db,
    sql`select p.id::int as id, p.name, p.role, p.area_id::int as "areaId", a.name as "areaName", a.cities
      from person p left join area a on a.id = p.area_id where p.role in ('management', 'medrep')`,
  );
  const as = (role: string): Me | null => {
    const person = people.find((row) => row.role === role);
    if (!person) return null;
    return {
      id: person.id,
      name: person.name,
      role,
      area: person.areaId
        ? { id: person.areaId, name: person.areaName ?? "", cities: person.cities ?? [] }
        : null,
    } as Me;
  };
  const sarla = as("management");
  const ryan = as("medrep");
  if (!sarla || !ryan) return false;

  const customers = await rows<{ id: number; name: string }>(
    db,
    sql`select id::int as id, name from customer where active`,
  );
  const customer = (name: string) => customers.find((row) => row.name.startsWith(name))?.id;
  const medicines = await rows<{ id: number; name: string; kind: string; amount: number }>(
    db,
    sql`select m.id::int as id, m.name, p.buyer_type as kind, p.amount::int as amount
      from medicine m join medicine_price p on p.medicine_id = m.id where m.active`,
  );
  const item = (
    name: string,
    kind: string,
    qty: number,
    less = 0,
    reason?: string,
  ): OrderItemInput | null => {
    const price = medicines.find((row) => row.name.startsWith(name) && row.kind === kind);
    return price
      ? {
          medicineId: price.id,
          qty,
          priceKind: kind,
          unitPrice: less ? price.amount - less : null,
          reason,
        }
      : null;
  };
  const place = async (
    who: Me,
    customerName: string,
    items: (OrderItemInput | null)[],
    note?: string,
  ) => {
    const customerId = customer(customerName);
    const lines = items.filter((line): line is OrderItemInput => line !== null);
    if (!customerId || lines.length === 0) return null;
    return placeOrder(db, who, { customerId, items: lines, note });
  };
  /** Demo only: stands an order where a later step (not built yet) would have left it. */
  const move = (id: number | null, status: string, hoursAgo = 0) =>
    id === null
      ? Promise.resolve()
      : db.execute(
          sql`update sales_order set status = ${status}, updated_at = now() - make_interval(hours => ${hoursAgo}),
              created_at = created_at - make_interval(hours => ${hoursAgo}), submitted_at = submitted_at - make_interval(hours => ${hoursAgo + 6})
            where id = ${id}`,
        );

  // Waiting for Management.
  await place(
    ryan,
    "San Juan",
    [item("Letrozole", "hospital", 300)],
    "Deliver before noon. Handle with care.",
  );
  await place(ryan, "Olivarez", [
    item("Anastrozole", "hospital", 600, 200, "Matched the price of their last order"),
    item("Capecitabine", "hospital", 240),
  ]);
  await place(ryan, "Las Piñas", [item("Abiraterone", "hospital", 120)]);
  // Approved, at different points down the line.
  for (const [name, medicine, qty, status, hours] of [
    ["San Juan", "Imatinib", 90, null, 0],
    ["Olivarez", "Letrozole", 150, "ready_for_dispatch", 5],
    ["Las Piñas", "Capecitabine", 360, "packing", 20],
    ["San Juan", "Bortezomib", 10, "shipped", 30],
    ["Olivarez", "Imatinib", 60, "completed", 80],
    ["San Juan", "Capecitabine", 120, "ready_for_dispatch", 60],
  ] as const) {
    const id = await place(ryan, name, [item(medicine, "hospital", qty)]);
    if (id) await actOnOrder(db, sarla, id, "approve", {});
    if (status) await move(id, status, hours);
  }
  // On hold, and one sent back to the MedRep.
  const held = await place(ryan, "Las Piñas", [
    item("Letrozole", "hospital", 900, 300, "Customer asked for a bulk price"),
  ]);
  if (held)
    await actOnOrder(db, sarla, held, "reject", {
      reason: "Major price difference: needs approval from Ms. Van",
    });
  const back = await place(ryan, "Olivarez", [item("Bortezomib", "hospital", 4)]);
  if (back)
    await actOnOrder(db, sarla, back, "send_back", {
      reason: "Wrong delivery address on the order",
    });
  return true;
}
