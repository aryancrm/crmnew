// An order's timeline: every change writes one line, with who did it and, when it reaches a
// stage of the line, which stage.

import { sql } from "drizzle-orm";
import type { Runner } from "../inventory/service";
import type { Me, OrderStage } from "../types";

export async function logEvent(
  tx: Runner,
  orderId: number,
  me: Me,
  kind: string,
  message: string,
  stage: OrderStage | null = null,
) {
  await tx.execute(
    sql`insert into order_event (order_id, kind, stage, message, by_person) values (${orderId}, ${kind}, ${stage}, ${message}, ${me.id})`,
  );
}

export const peso = (centavos: number) =>
  `₱${(centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
