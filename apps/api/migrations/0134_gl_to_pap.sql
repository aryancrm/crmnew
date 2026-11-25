-- PAP is a process, not a channel (Aryan, 22 Nov): a guarantee-letter case from any channel is
-- worked by the PAP person, and its sale counts where the patient came from. A case that came to
-- PAP from someone else keeps who that was: the Online agent whose case turned guarantee letter,
-- or the MedRep who handed their patient over. Null on a case the PAP person opened themselves.
alter table lead add column origin_person_id bigint references person (id);
--> statement-breakpoint
create index lead_origin on lead (origin_person_id) where origin_person_id is not null;
