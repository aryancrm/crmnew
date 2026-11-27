// A customer's files in one place (docs/ERP-PLAN.md phase 4): their licence papers, every paper on
// their orders (PO, proof of payment, prescription, signed receipt…), their online cases' files and
// the doctor's signed acknowledgements of samples. Each opens through its own page's door, which
// checks who may see it; this only lists them.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import type { CustomerFiles, Me } from "../types";
import { customerDetail } from "./service";

export async function customerFiles(db: Database, me: Me, id: number): Promise<CustomerFiles> {
  // Whoever may open the customer may see the list (the same check as the customer's page).
  await customerDetail(db, me, id);
  const files = await rows<CustomerFiles["files"][number]>(
    db,
    sql`select * from (
        select 'customer'::text as source, f.kind, f.name, f.mime, f.at::text as at, p.name as by, o.code as record,
          '/orders/' || o.id as link, '/api/customer-papers/' || f.id as url
        from customer_file f join person p on p.id = f.by_person
        left join order_file x on x.id = f.order_file_id left join sales_order o on o.id = x.order_id
        where f.customer_id = ${id} and f.active
        union all
        -- An order's paper kept on the customer too shows once, as theirs, with its order.
        select 'order', f.kind, f.name, f.mime, f.at::text, p.name, o.code, '/orders/' || o.id, '/api/papers/' || f.id
        from order_file f join sales_order o on o.id = f.order_id join person p on p.id = f.by_person
        where o.customer_id = ${id} and f.active
          and not exists (select 1 from customer_file c where c.order_file_id = f.id and c.active)
        union all
        select 'case', f.kind, f.name, f.mime, f.at::text, p.name, coalesce(l.code, 'Case ' || l.id), '/leads/' || l.id, '/api/lead-files/' || f.id
        from lead_file f join lead l on l.id = f.lead_id join person p on p.id = f.by_person
        where l.customer_id = ${id} and f.active
        union all
        select 'sample', 'sample_ack', min(x.ack_name), min(x.ack_mime), min(x.at)::text, min(p.name), null, null, '/api/samples/given/' || min(x.id) || '/ack'
        from sample_move x join person p on p.id = x.person_id
        where x.customer_id = ${id} and x.what = 'given' and x.ack_name is not null
        group by x.visit_id
      ) f order by f.at desc`,
  );
  return { files };
}
