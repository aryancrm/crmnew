-- Cold-chain boxes (Aryan, 17 Nov): the styro box is an item in stock like a medicine (batches,
-- packed from the shelf, as Zoho kept it), and Management types what the cold chain costs on each
-- order. Marked here so an order with a cold medicine and no box is pointed out to Management, and
-- the box price typed on the order is not taken for a price below or above the list.
alter table medicine add column cold_box boolean not null default false;
