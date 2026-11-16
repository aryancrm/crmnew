// Brings the old CRM's enquiries into this CRM: the case, its Messenger chat (on a page connected
// here) and the notes staff typed. Used by scripts/import-old-crm.ts (reads the old database) and
// by the Admin's import call (the same rows sent in batches). A case keeps the old record's id
// (legacy_id), so running again adds only what is missing.

import { sql } from "drizzle-orm";
import { phoneKey } from "../customers/service";
import { type Database, rows } from "../db/index";
import { keepFile } from "../files/store";

export type OldLead = {
  id: string;
  created_at: Date | string;
  updated_at: Date | string;
  name: string;
  email: string | null;
  phone: string | null;
  message: string | null;
  interest: string | null;
  source: string | null;
  assigned_email: string | null;
  state: string;
  note: string | null;
  quote: string | null;
  city: string | null;
  address: string | null;
  assistance: string | null;
  agency: string | null;
  first_contact: Date | string | null;
  relation: string | null;
  patient_name: string | null;
  patient: string | null;
  messenger_psid: string | null;
  messenger_page_id: string | null;
  lost_reason: string | null;
  last_message: string | null;
  last_message_at: Date | string | null;
};
export type OldMessage = {
  id: string;
  record_id: string;
  body: string;
  data: { mid?: string; files?: unknown[] } | null;
  created_at: Date | string;
};

const SOURCE: Record<string, string> = {
  messenger: "messenger",
  facebook: "facebook",
  "2MG website": "website_2mg",
  "2mg website": "website_2mg",
  "Caps & Pills website": "website_capsandpills",
  capsandpills: "website_capsandpills",
  phone: "phone",
  walk_in: "walk_in",
  referral: "referral",
  email: "email",
};
const ROAD: Record<string, string> = { none: "regular", senior: "senior", pwd: "pwd", gl: "gl" };
const AGENCIES = new Set(["dswd", "pcso", "ovp", "op"]);
const RELATIONS = new Set(["self", "spouse", "child", "parent", "sibling", "caregiver", "other"]);


export type LegacyImportResult = {
  leads: number;
  made: number;
  joinedChat: number;
  alreadyHere: number;
  chatMessages: number;
  notes: number;
  pageNotConnected: number;
  photosLeftBehind: number;
};

export async function importOldLeads(
  db: Database,
  leads: OldLead[],
  messages: OldMessage[],
  apply: boolean,
): Promise<LegacyImportResult> {
  const [admin] = await rows<{ id: number }>(
    db,
    sql`select id::int as id from person where role = 'admin' and active order by id limit 1`,
  );
  if (!admin) throw new Error("No admin in this CRM.");
  const people = await rows<{ id: number; email: string }>(
    db,
    sql`select id::int as id, lower(email) as email from person where active and email is not null`,
  );
  const personOf = new Map(people.map((one) => [one.email, one.id]));
  const pages = await rows<{ id: number; key: string }>(
    db,
    sql`select id::int as id, key from channel_account where kind = 'messenger' and active`,
  );
  const pageOf = new Map(pages.map((one) => [one.key, one.id]));

  const byLead = new Map<string, OldMessage[]>();
  for (const message of messages) {
    const list = byLead.get(message.record_id) ?? [];
    list.push(message);
    byLead.set(message.record_id, list);
  }

  const said = {
    leads: leads.length,
    made: 0,
    joinedChat: 0,
    alreadyHere: 0,
    chatMessages: 0,
    notes: 0,
    pageNotConnected: 0,
    photosLeftBehind: 0,
  };

  const clip = (text: string | null | undefined, max: number) => {
    const clean = (text ?? "").trim();
    return clean ? clean.slice(0, max) : null;
  };
  const at = (value: Date | string | null | undefined, fallback: Date) => {
    const time = value ? new Date(value) : null;
    return time && !Number.isNaN(time.getTime()) ? time : fallback;
  };

  for (const lead of leads) {
    const accountId = lead.messenger_page_id ? pageOf.get(String(lead.messenger_page_id)) : undefined;
    const chat = lead.messenger_psid && accountId ? { accountId, key: String(lead.messenger_psid) } : null;
    if (lead.messenger_psid && !accountId) said.pageNotConnected += 1;
    const first = at(lead.first_contact, new Date(lead.created_at));
    const fields = {
      source: SOURCE[lead.source ?? ""] ?? (lead.messenger_psid ? "messenger" : "other"),
      name: clip(lead.name, 120) ?? "Unknown",
      relation: lead.relation && RELATIONS.has(lead.relation) ? lead.relation : null,
      patientName: clip(lead.patient_name ?? lead.patient, 120),
      phone: clip(lead.phone, 40),
      phoneKey: phoneKey(lead.phone),
      email: clip(lead.email, 120),
      city: clip(lead.city, 80),
      address: clip(lead.address, 300),
      assignedTo: lead.assigned_email ? (personOf.get(lead.assigned_email.toLowerCase()) ?? null) : null,
      road: ROAD[lead.assistance ?? "none"] ?? "regular",
      agency: lead.agency && AGENCIES.has(lead.agency.toLowerCase()) ? lead.agency.toLowerCase() : null,
      request: clip(lead.interest ?? lead.message, 1000),
      state: lead.state === "lost" ? "lost" : "open",
      lostReason: clip(lead.lost_reason, 300),
      first,
      lastActivity: at(lead.last_message_at, new Date(lead.updated_at)),
    };

    // Already brought over (a run before), else the same chat the page's sync opened, else new.
    const [byLegacy] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from lead where legacy_id = ${lead.id}`,
    );
    let leadId = byLegacy?.id ?? null;
    let fresh = false;
    if (leadId) said.alreadyHere += 1;
    if (!leadId && chat) {
      const [open] = await rows<{ id: number }>(
        db,
        sql`select id::int as id from lead where chat_account_id = ${chat.accountId} and chat_key = ${chat.key} and legacy_id is null order by id limit 1`,
      );
      if (open) {
        leadId = open.id;
        fresh = true;
        said.joinedChat += 1;
        if (apply)
          await db.execute(
            sql`update lead set legacy_id = ${lead.id},
              name = case when name in ('Facebook user', '') then ${fields.name} else name end,
              relation = coalesce(relation, ${fields.relation}), patient_name = coalesce(patient_name, ${fields.patientName}),
              phone = coalesce(phone, ${fields.phone}), phone_key = coalesce(phone_key, ${fields.phoneKey}),
              email = coalesce(email, ${fields.email}), city = coalesce(city, ${fields.city}), address = coalesce(address, ${fields.address}),
              assigned_to = coalesce(assigned_to, ${fields.assignedTo}),
              road = case when road = 'regular' then ${fields.road} else road end, agency = coalesce(agency, ${fields.agency}),
              request = coalesce(request, ${fields.request}),
              first_contact_at = least(first_contact_at, ${fields.first.toISOString()}::timestamptz)
            where id = ${leadId}`,
          );
      }
    }
    if (!leadId) {
      said.made += 1;
      fresh = true;
      if (apply) {
        const [made] = await rows<{ id: number }>(
          db,
          sql`insert into lead (source, name, relation, patient_name, phone, phone_key, email, city, address, assigned_to,
              road, agency, request, state, lost_reason, first_contact_at, last_activity_at, created_by, created_at,
              chat_channel, chat_account_id, chat_key, legacy_id, opened_at)
            values (${fields.source}, ${fields.name}, ${fields.relation}, ${fields.patientName}, ${fields.phone}, ${fields.phoneKey},
              ${fields.email}, ${fields.city}, ${fields.address}, ${fields.assignedTo}, ${fields.road}, ${fields.agency},
              ${fields.request}, ${fields.state}, ${fields.lostReason}, ${fields.first.toISOString()}::timestamptz,
              ${fields.lastActivity.toISOString()}::timestamptz, ${admin.id}, ${new Date(lead.created_at).toISOString()}::timestamptz,
              ${chat ? "messenger" : null}, ${chat?.accountId ?? null}, ${chat?.key ?? null}, ${lead.id},
              ${lead.state === "new" ? null : new Date(lead.updated_at).toISOString()}::timestamptz)
            returning id::int as id`,
        );
        leadId = made?.id as number;
        await db.execute(
          sql`with next as (update counter set value = value + 1 where name = 'lead' returning value)
            update lead set code = 'ENQ-' || lpad(next.value::text, 5, '0') from next where lead.id = ${leadId}`,
        );
      }
    } else if (apply && chat) {
      // A page connected since the last run: the case joins its chat.
      await db.execute(
        sql`update lead set chat_channel = 'messenger', chat_account_id = ${chat.accountId}, chat_key = ${chat.key}
          where id = ${leadId} and chat_account_id is null`,
      );
    }

    const history = byLead.get(lead.id) ?? [];
    let latest: { text: string; at: Date } | null = null;
    for (const message of history) {
      const chatLine = /^Messenger ([←→]) ?([\s\S]*)$/.exec(message.body);
      if (chatLine) {
        const files = Array.isArray(message.data?.files) ? message.data.files.length : 0;
        said.photosLeftBehind += files;
        if (!chat) continue;
        said.chatMessages += 1;
        const text = (chatLine[2] ?? "").trim() || (files ? "A photo or file (in the old CRM)" : "");
        latest = { text, at: new Date(message.created_at) };
        if (apply && leadId)
          await db.execute(
            sql`insert into lead_message (lead_id, channel, account_id, direction, external_id, text, files, at)
              values (${leadId}, 'messenger', ${chat.accountId}, ${chatLine[1] === "←" ? "in" : "out"},
                ${message.data?.mid ?? `legacy:${message.id}`}, ${text.slice(0, 20_000)}, '[]'::jsonb,
                ${new Date(message.created_at).toISOString()}::timestamptz)
              on conflict do nothing`,
          );
        continue;
      }
      if (!fresh || /^(Lead created|Created)$/i.test(message.body.trim())) continue;
      said.notes += 1;
      if (apply && leadId)
        await db.execute(
          sql`insert into lead_event (lead_id, kind, message, by_person, at)
            values (${leadId}, 'note', ${`From the old CRM: ${message.body.slice(0, 4000)}`}, null,
              ${new Date(message.created_at).toISOString()}::timestamptz)`,
        );
    }
    if (apply && leadId && fresh) {
      const extra = [lead.quote && `Quotation in the old CRM: ${lead.quote}`, lead.note && `Note in the old CRM: ${lead.note}`]
        .filter(Boolean)
        .map((text) => String(text).slice(0, 4000));
      for (const text of extra) {
        said.notes += 1;
        await db.execute(
          sql`insert into lead_event (lead_id, kind, message, by_person, at) values (${leadId}, 'note', ${text}, null, ${new Date(lead.updated_at).toISOString()}::timestamptz)`,
        );
      }
      if (latest)
        await db.execute(
          sql`update lead set last_message = ${latest.text.slice(0, 140)}, last_message_at = greatest(coalesce(last_message_at, ${latest.at.toISOString()}::timestamptz), ${latest.at.toISOString()}::timestamptz)
            where id = ${leadId}`,
        );
    }
  }

  return said;
}

// ---------------------------------------------------------------- the old CRM's photos

/** One photo of an old enquiry, with a short-lived link to its bytes in the old storage. */
export type OldFile = {
  id: string;
  leadId: string;
  name: string;
  mime: string;
  kind: string | null;
  status: string | null;
  at: string;
  url: string;
};

const FILE_KINDS: Record<string, string> = {
  prescription: "rx",
  osca_id: "osca_id",
  pwd_id: "pwd_id",
  booklet: "pwd_booklet",
  id: "valid_id",
  med_cert: "med_cert",
  gl: "gl_letter",
};

/** The paper the new CRM files an old photo as; unfiled or refused ones wait as unsorted. */
export function fileKindOf(file: Pick<OldFile, "kind" | "status">): string {
  if (!file.kind || file.status === "rejected") return "unsorted";
  return FILE_KINDS[file.kind] ?? "other";
}

/** Brings the old enquiries' photos over, once each (their old id is kept). */
export async function importOldFiles(db: Database, files: OldFile[], apply: boolean) {
  const said = { files: files.length, brought: 0, alreadyHere: 0, noCase: 0, failed: [] as string[] };
  for (const file of files) {
    const [here] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from lead_file where legacy_id = ${file.id}`,
    );
    if (here) {
      said.alreadyHere += 1;
      continue;
    }
    const [lead] = await rows<{ id: number }>(
      db,
      sql`select id::int as id from lead where legacy_id = ${file.leadId}`,
    );
    if (!lead) {
      said.noCase += 1;
      continue;
    }
    if (!apply) {
      said.brought += 1;
      continue;
    }
    try {
      const res = await fetch(file.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`old storage answered ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.byteLength) throw new Error("empty file");
      const kept = await keepFile("cases", {
        name: file.name.slice(0, 120) || "photo",
        mime: file.mime || "application/octet-stream",
        bytes,
      });
      await db.execute(
        sql`insert into lead_file (lead_id, kind, name, mime, size, data, store_key, by_person, at, legacy_id)
          values (${lead.id}, ${fileKindOf(file)}, ${kept.name}, ${kept.mime}, ${kept.size}, ${kept.data}, ${kept.key}, null, ${file.at}, ${file.id})
          on conflict (legacy_id) where legacy_id is not null do nothing`,
      );
      said.brought += 1;
    } catch (error) {
      said.failed.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return said;
}
