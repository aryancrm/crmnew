// Asking up for an exception (Aryan, 17 Nov, question 9): beside the automatic price check,
// Management asks the MedRep's Team Lead, or the Business Mentor (the head of the division the
// MedRep is in), on the order with what it is asking. That person sees it on their screen
// (Messages, Needs you, and a band on the order) and answers Yes or No with a word; the answer
// comes back to Management, which decides. Kept on the order with who, when and what.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import { clean, iso, type Runner } from "../inventory/service";
import { notify } from "../notify/service";
import type { Me, OrderAsk, OrderAskUp } from "../types";
import { logEvent } from "./events";
import { ORDER_MANAGE_ROLES } from "./rules";

const WHO: Record<OrderAsk["asWho"], string> = {
  team_lead: "Team Lead",
  business_mentor: "Business Mentor",
};

/** The leads up the MedRep's line: the first is their Team Lead, the last (the top lead under the
 *  CEO) the division's Business Mentor; one person when the MedRep reports to the head. */
export async function leadsUp(db: Runner, medrepId: number): Promise<OrderAskUp> {
  const up = await rows<{ id: number; name: string; title: string | null }>(
    db,
    sql`with recursive up as (
        select p.reports_to as id, 1 as depth from person p where p.id = ${medrepId}
        union all select p.reports_to, u.depth + 1 from person p join up u on p.id = u.id where u.depth < 12
      )
      select q.id::int as id, q.name, q.title from up join person q on q.id = up.id
      where q.active and q.role in ('team_lead', 'manager') order by up.depth`,
  );
  const first = up[0] ?? null;
  const last = up.at(-1) ?? null;
  return {
    teamLead: first,
    mentor: last && last.id !== first?.id ? last : null,
  };
}

/** An order's asks, oldest first; `mine` when it waits on this person's answer. */
export async function asksOf(db: Runner, me: Me, orderId: number): Promise<OrderAsk[]> {
  const found = await rows<Omit<OrderAsk, "asWhoLabel" | "mine"> & { askedToId: number }>(
    db,
    sql`select a.id::int as id, a.as_who as "asWho", by.name as "askedBy", tp.name as "askedTo", a.asked_to::int as "askedToId",
        a.question, ${iso("a.asked_at")} as "askedAt", a.answer, a.answer_note as "answerNote", ${iso("a.answered_at")} as "answeredAt"
      from order_ask a join person by on by.id = a.asked_by join person tp on tp.id = a.asked_to
      where a.order_id = ${orderId} and a.withdrawn_at is null order by a.asked_at, a.id`,
  );
  return found.map(({ askedToId, ...ask }) => ({
    ...ask,
    asWhoLabel: WHO[ask.asWho],
    mine: askedToId === me.id && ask.answer === null,
  }));
}

/** Management asks the Team Lead or the Business Mentor of the order's MedRep. */
export async function askUp(
  db: Database,
  me: Me,
  orderId: number,
  input: { to: OrderAsk["asWho"]; question: string },
): Promise<number> {
  allow(me, ORDER_MANAGE_ROLES, "ask a team lead or a Business Mentor");
  const question = clean(input.question);
  if (!question) throw new Refusal(400, "invalid", "Say what you are asking.", "question");
  return db.transaction(async (tx) => {
    const [order] = await rows<{ code: string; status: string; medrepId: number; customer: string }>(
      tx,
      sql`select o.code, o.status, o.medrep_id::int as "medrepId", c.name as customer
        from sales_order o join customer c on c.id = o.customer_id where o.id = ${orderId} for update of o`,
    );
    if (!order) throw new Refusal(404, "not_found", "That order doesn't exist.");
    if (["cancelled", "completed"].includes(order.status))
      throw new Refusal(409, "not_now", `${order.code} is done: there is nothing to ask on it.`);
    const leads = await leadsUp(tx, order.medrepId);
    const to = input.to === "team_lead" ? leads.teamLead : leads.mentor;
    if (!to)
      throw new Refusal(
        400,
        "invalid",
        input.to === "team_lead"
          ? "This MedRep has no team lead above them."
          : "This MedRep's team lead is the head of the division: ask them as Team Lead.",
        "to",
      );
    if (to.id === me.id) throw new Refusal(400, "invalid", "You can't ask yourself.", "to");
    const [open] = await rows(
      tx,
      sql`select 1 from order_ask where order_id = ${orderId} and asked_to = ${to.id} and answer is null and withdrawn_at is null limit 1`,
    );
    if (open)
      throw new Refusal(409, "not_now", `${to.name} hasn't answered your last question on it yet.`);
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into order_ask (order_id, asked_by, asked_to, as_who, question)
        values (${orderId}, ${me.id}, ${to.id}, ${input.to}, ${question}) returning id::int as id`,
    );
    await logEvent(tx, orderId, me, "note", `${me.name} asked ${to.name} (${WHO[input.to]}): ${question}`);
    await notify(tx, {
      to: [to.id],
      kind: "ask_up",
      title: `${me.name} asks you (${WHO[input.to]}): ${order.code} · ${order.customer}`,
      body: question,
      link: `/orders/${orderId}`,
      orderId,
      key: `ask:${made?.id}`,
    });
    return made?.id as number;
  });
}

/** The one asked answers Yes or No, with a word (a No says why). */
export async function answerAsk(
  db: Database,
  me: Me,
  askId: number,
  input: { yes: boolean; note?: string | null },
): Promise<void> {
  const note = clean(input.note);
  if (!input.yes && !note) throw new Refusal(400, "invalid", "Say why not.", "note");
  await db.transaction(async (tx) => {
    const [ask] = await rows<{
      orderId: number;
      askedTo: number;
      askedBy: number;
      asWho: OrderAsk["asWho"];
      answered: boolean;
      withdrawn: boolean;
      code: string;
      customer: string;
    }>(
      tx,
      sql`select a.order_id::int as "orderId", a.asked_to::int as "askedTo", a.asked_by::int as "askedBy", a.as_who as "asWho",
          a.answer is not null as answered, a.withdrawn_at is not null as withdrawn, o.code, c.name as customer
        from order_ask a join sales_order o on o.id = a.order_id join customer c on c.id = o.customer_id
        where a.id = ${askId} for update of a`,
    );
    if (!ask) throw new Refusal(404, "not_found", "That question doesn't exist.");
    if (ask.askedTo !== me.id)
      throw new Refusal(403, "forbidden", "Only the one asked answers it.");
    if (ask.answered || ask.withdrawn)
      throw new Refusal(409, "not_now", "That question is already answered.");
    await tx.execute(
      sql`update order_ask set answer = ${input.yes}, answer_note = ${note}, answered_at = now() where id = ${askId}`,
    );
    const said = `${input.yes ? "Yes" : "No"}${note ? `: ${note}` : ""}`;
    await logEvent(tx, ask.orderId, me, "note", `${me.name} (${WHO[ask.asWho]}) answered ${said}`);
    await notify(tx, {
      to: [ask.askedBy],
      kind: "ask_answered",
      title: `${me.name} answered ${input.yes ? "Yes" : "No"}: ${ask.code} · ${ask.customer}`,
      body: note,
      link: `/orders/${ask.orderId}`,
      orderId: ask.orderId,
      key: `ask:${askId}:answered`,
    });
  });
}
