-- A manual journal's number is Zoho's "Journal Number" as it stands ("MA445"); the first import
-- put its prefix and suffix on it again ("RENT13711371").
update book_doc set number = fields->>'Journal Number'
where kind = 'journal' and coalesce(fields->>'Journal Number', '') <> '' and number <> fields->>'Journal Number';
