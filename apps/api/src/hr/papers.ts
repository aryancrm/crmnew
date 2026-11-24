// Each person's papers on their HR record (docs/HR-PLAN.md, step 1): the contract, government IDs,
// certificates, clearance, medical papers. HR and the Admin add and take off; HR, the CEO, the
// Admin and the person themselves read. Nothing is deleted: a paper taken off is archived with who
// did it and why, and HR's trail writes both down.

import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { bytesOf, keepFile } from "../files/store";
import { allow, Refusal } from "../http";
import { addDays, todayManila } from "../inventory/rules";
import { clean } from "../inventory/service";
import type { HrPaperKind, HrPapers, Me } from "../types";
import { hrEvent } from "./events";
import { HR_ROLES, HR_WRITE_ROLES } from "./people";

export const PAPER_KINDS: Record<HrPaperKind, string> = {
  contract: "Contract",
  government_id: "Government ID",
  certificate: "Certificate",
  clearance: "Clearance",
  medical: "Medical",
  other: "Other",
};
export const PAPER_MAX_BYTES = 10 * 1024 * 1024;
const PAPER_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type PaperFile = { name: string; mime: string; bytes: Uint8Array };

/** HR, the CEO, the Admin, and the person their own. */
function mayRead(me: Me, personId: number): void {
  if (!HR_ROLES.includes(me.role) && me.id !== personId)
    throw new Refusal(403, "not_allowed", "Only HR sees other people's papers.");
}

async function personExists(db: Database, personId: number): Promise<string> {
  const [found] = await rows<{ name: string }>(
    db,
    sql`select p.name from person p join employee e on e.person_id = p.id where p.id = ${personId}`,
  );
  if (!found) throw new Refusal(404, "not_found", "No such person.");
  return found.name;
}

const AT = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

export async function hrPapers(db: Database, me: Me, personId: number): Promise<HrPapers> {
  mayRead(me, personId);
  await personExists(db, personId);
  const today = todayManila();
  const soon = addDays(today, 30);
  const lines = await rows<{
    id: number;
    kind: HrPaperKind;
    title: string;
    expiresOn: string | null;
    fileName: string;
    fileMime: string;
    fileSize: number;
    addedBy: string;
    addedAt: string;
    archivedAt: string | null;
    archivedBy: string | null;
    archivedReason: string | null;
  }>(
    db,
    sql`select h.id::int as id, h.kind, h.title, to_char(h.expires_on, 'YYYY-MM-DD') as "expiresOn",
        h.file_name as "fileName", h.file_mime as "fileMime", h.file_size as "fileSize",
        a.name as "addedBy", ${AT("h.added_at")} as "addedAt",
        ${AT("h.archived_at")} as "archivedAt", r.name as "archivedBy", h.archived_reason as "archivedReason"
      from hr_paper h join person a on a.id = h.added_by left join person r on r.id = h.archived_by
      where h.person_id = ${personId}
      order by h.archived_at is not null, h.added_at desc, h.id desc`,
  );
  const works = HR_WRITE_ROLES.includes(me.role);
  return {
    kinds: (Object.entries(PAPER_KINDS) as [HrPaperKind, string][]).map(([key, label]) => ({ key, label })),
    papers: lines.map((one) => ({
      id: one.id,
      kind: one.kind,
      kindLabel: PAPER_KINDS[one.kind],
      title: one.title,
      expiresOn: one.expiresOn,
      expiry:
        one.archivedAt || !one.expiresOn
          ? null
          : one.expiresOn < today
            ? "expired"
            : one.expiresOn <= soon
              ? "soon"
              : null,
      fileName: one.fileName,
      fileMime: one.fileMime,
      fileSize: one.fileSize,
      addedBy: one.addedBy,
      addedAt: one.addedAt,
      archived:
        one.archivedAt && one.archivedBy && one.archivedReason
          ? { at: one.archivedAt, by: one.archivedBy, reason: one.archivedReason }
          : null,
    })),
    can: { add: works, archive: works },
  };
}

/** HR adds a paper to a person's record. */
export async function addPaper(
  db: Database,
  me: Me,
  personId: number,
  input: { kind: string; title: string; expiresOn?: string | null },
  file: PaperFile | null,
): Promise<{ id: number }> {
  allow(me, HR_WRITE_ROLES, "add papers to people's records");
  if (!(input.kind in PAPER_KINDS)) throw new Refusal(400, "invalid", "Pick what kind of paper it is.", "kind");
  const title = clean(input.title)?.slice(0, 120);
  if (!title) throw new Refusal(400, "invalid", "Name the paper (e.g. Employment contract 2026).", "title");
  const expiresOn = clean(input.expiresOn) ?? null;
  if (expiresOn && !DAY.test(expiresOn)) throw new Refusal(400, "invalid", "Pick the day it expires.", "expiresOn");
  if (!file) throw new Refusal(400, "invalid", "Attach the paper.", "file");
  if (!PAPER_TYPES.includes(file.mime))
    throw new Refusal(400, "invalid", "Attach a PDF, a photo or a Word file.", "file");
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > PAPER_MAX_BYTES)
    throw new Refusal(400, "invalid", "That file is empty or over 10 MB.", "file");
  await personExists(db, personId);
  // The bytes are kept before the transaction (a bucket can't roll back).
  const kept = await keepFile("hr-papers", { ...file, name: file.name.trim().slice(0, 120) || "paper" });
  return db.transaction(async (tx) => {
    const [made] = await rows<{ id: number }>(
      tx,
      sql`insert into hr_paper (person_id, kind, title, expires_on, file_name, file_mime, file_size, file_data, file_key, added_by)
        values (${personId}, ${input.kind}, ${title}, ${expiresOn}::date, ${kept.name}, ${kept.mime}, ${kept.size},
          ${kept.data}, ${kept.key}, ${me.id})
        returning id::int as id`,
    );
    await hrEvent(
      tx,
      personId,
      me.id,
      "paper",
      `Paper added: ${title} (${PAPER_KINDS[input.kind as HrPaperKind]})`,
    );
    return { id: made?.id as number };
  });
}

/** HR takes a paper off the record: archived with the reason, never deleted. */
export async function archivePaper(
  db: Database,
  me: Me,
  paperId: number,
  input: { reason?: string | null },
): Promise<void> {
  allow(me, HR_WRITE_ROLES, "take papers off people's records");
  const reason = clean(input.reason)?.slice(0, 300);
  if (!reason) throw new Refusal(400, "invalid", "Say why it comes off (replaced, expired, wrong person…).", "reason");
  await db.transaction(async (tx) => {
    const [paper] = await rows<{ personId: number; title: string }>(
      tx,
      sql`update hr_paper set archived_at = now(), archived_by = ${me.id}, archived_reason = ${reason}
        where id = ${paperId} and archived_at is null
        returning person_id::int as "personId", title`,
    );
    if (!paper) throw new Refusal(404, "not_found", "That paper isn't on the record (taken off already?).");
    await hrEvent(tx, paper.personId, me.id, "paper", `Paper taken off: ${paper.title}: ${reason}`);
  });
}

/** The paper's bytes, for whoever may read the person's papers (archived ones too). */
export async function paperFile(db: Database, me: Me, paperId: number): Promise<PaperFile> {
  const [paper] = await rows<{
    personId: number;
    name: string;
    mime: string;
    data: Uint8Array | null;
    key: string | null;
  }>(
    db,
    sql`select person_id::int as "personId", file_name as name, file_mime as mime, file_data as data, file_key as key
      from hr_paper where id = ${paperId}`,
  );
  if (!paper) throw new Refusal(404, "not_found", "No such paper.");
  mayRead(me, paper.personId);
  return { name: paper.name, mime: paper.mime, bytes: await bytesOf(paper) };
}
