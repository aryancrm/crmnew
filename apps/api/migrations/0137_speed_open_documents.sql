-- Speed only: no data and no figure changes.
-- What is still owed (customers' unpaid invoices, suppliers' unpaid bills) is asked on almost
-- every Home and money page, and each time every document of the kind was read to find the few
-- with a balance. This index holds only the ones with a balance.
create index if not exists book_doc_open on book_doc (kind, customer_id, due_date) where balance > 0;
