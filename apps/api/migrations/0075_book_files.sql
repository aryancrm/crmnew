-- Files attached to the books' documents (docs/PLAN.md 17): the ones Zoho kept on invoices and bills
-- still open when Zoho was closed (scans of the vendor's bill, the signed invoice, a slip), and any
-- added here later. Bytes through src/files/store.ts (in the row on this computer, the bucket online).
create table book_file (
  id bigint generated always as identity primary key,
  doc_id bigint not null references book_doc (id),
  zoho_id text unique,
  name text not null,
  mime text not null,
  size integer not null,
  data bytea,
  key text,
  uploaded_by text,
  uploaded_on text,
  added_at timestamptz not null default now()
);
--> statement-breakpoint
create index book_file_doc on book_file (doc_id);
